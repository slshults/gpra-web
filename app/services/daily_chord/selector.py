"""Pick the chord to post for today's Chord of the Day.

The selector is pure-ish: it reads from the DB but doesn't write. The caller
(scheduler) is responsible for inserting the resulting `posted_chords` row.

Selection rules:
  - Random pick from chord_pool, excluding rows already posted in the current cycle.
  - "Current cycle" is the highest cycle_id with at least one 'posted' row, default 1.
  - When the current cycle exhausts (every chord_pool row has been posted), the
    selector returns a row from a fresh cycle (cycle_id + 1). The audit trail
    in posted_chords preserves the previous cycle's history.
  - Per-day uniqueness is enforced separately (see `already_posted_today`) so the
    scheduler can short-circuit before doing any work.
"""
from typing import NamedTuple, Optional

from sqlalchemy import text


class SelectionResult(NamedTuple):
    chord_pool_id: int
    chord_name: str
    common_chord_id: Optional[int]
    cycle_id: int  # cycle to record this post under


def already_posted_today(db_session) -> bool:
    """Return True if a 'posted' or 'partial' row was created today (UTC).

    Includes 'partial' so a partial-success run (e.g., BlueSky succeeded, FB
    failed) doesn't trigger a same-day re-attempt that would duplicate the
    BlueSky post. Failed posts (status='failed') are NOT counted — those are
    safe to retry.
    """
    # Trailing `AT TIME ZONE 'UTC'` re-anchors the truncated timestamp back into
    # timestamptz space at UTC, so the `posted_at >= <ts>` comparison doesn't
    # depend on the DB session's timezone setting (prod is UTC, but a developer
    # running tests on a PT-local Postgres at evening would otherwise mis-compute
    # "today" once UTC has rolled over to the next day).
    row = db_session.execute(
        text("""
            SELECT 1 FROM posted_chords
            WHERE status IN ('posted', 'partial')
              AND posted_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            LIMIT 1
        """)
    ).fetchone()
    return row is not None


def current_cycle_id(db_session) -> int:
    """Highest cycle_id with at least one posted-or-partial row. Returns 1 if none.

    Includes 'partial' rows because a partial post still landed on at least one
    platform — the chord is "spent" for this cycle even if one side failed.
    """
    row = db_session.execute(
        text("""
            SELECT COALESCE(MAX(cycle_id), 1) FROM posted_chords
            WHERE status IN ('posted', 'partial')
        """)
    ).fetchone()
    return int(row[0])


def pool_remaining_in_cycle(db_session, cycle_id: int) -> int:
    """Count of chord_pool rows not yet posted-or-partial-posted in the given cycle."""
    row = db_session.execute(
        text("""
            SELECT COUNT(*) FROM chord_pool
            WHERE id NOT IN (
                SELECT chord_pool_id FROM posted_chords
                WHERE status IN ('posted', 'partial') AND cycle_id = :cycle_id
            )
        """),
        {"cycle_id": cycle_id}
    ).fetchone()
    return int(row[0])


def pick_chord_for_today(db_session) -> Optional[SelectionResult]:
    """Return the chord to post today, or None if not eligible.

    Returns None when:
      - already_posted_today() is True (don't double-post)
      - chord_pool is empty (nothing to pick from)

    Excludes both 'posted' and 'partial' rows from the pool — a partial post
    means the chord already landed on one platform; re-picking it would
    duplicate that side. 'failed' rows do NOT block: the post never landed
    anywhere, so the chord is fair game.

    Auto-bumps cycle_id when the current cycle is exhausted.
    """
    if already_posted_today(db_session):
        return None

    cycle = current_cycle_id(db_session)
    if pool_remaining_in_cycle(db_session, cycle) == 0:
        # Cycle exhausted. New posts go into the next cycle. The cycle "archive"
        # is implicit — old posted_chords rows keep their cycle_id, the new ones
        # get cycle + 1. The caller may emit a `chord_of_day_pool_exhausted`
        # PostHog event when it observes cycle has bumped.
        cycle = cycle + 1

    row = db_session.execute(
        text("""
            SELECT id, chord_name, common_chord_id FROM chord_pool
            WHERE id NOT IN (
                SELECT chord_pool_id FROM posted_chords
                WHERE status IN ('posted', 'partial') AND cycle_id = :cycle_id
            )
            ORDER BY RANDOM()
            LIMIT 1
        """),
        {"cycle_id": cycle}
    ).fetchone()

    if not row:
        return None  # truly empty chord_pool

    return SelectionResult(
        chord_pool_id=int(row[0]),
        chord_name=row[1],
        common_chord_id=int(row[2]) if row[2] is not None else None,
        cycle_id=cycle,
    )
