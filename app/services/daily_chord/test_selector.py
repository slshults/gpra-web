"""Integration tests for the Chord of the Day selector.

Runs against the real Postgres dev DB but always rolls back so it doesn't
mutate any rows. Requires DATABASE_URL in the env.

Run:
  python3 -m unittest app.services.daily_chord.test_selector
"""
import unittest

from sqlalchemy import text

from app.database import SessionLocal
from app.services.daily_chord.selector import (
    already_posted_today,
    current_cycle_id,
    pick_chord_for_today,
    pool_remaining_in_cycle,
)


class SelectorTests(unittest.TestCase):
    """Each test runs in its own transaction and rolls back at teardown."""

    def setUp(self):
        self.session = SessionLocal()
        # Sanity: chord_pool must have rows for any meaningful test
        count = self.session.execute(text("SELECT COUNT(*) FROM chord_pool")).scalar()
        self.assertGreater(count, 0, "chord_pool is empty — run alembic seed migration first")

    def tearDown(self):
        # Roll back ALL changes from this test so the DB stays pristine
        self.session.rollback()
        self.session.close()

    # ---- already_posted_today ----

    def test_already_posted_today_false_when_empty(self):
        # Clear any rows that might exist from a previous unfinished run
        self.session.execute(text("DELETE FROM posted_chords"))
        self.assertFalse(already_posted_today(self.session))

    def test_already_posted_today_true_for_posted_today(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        pool_id = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 1")
        ).scalar()
        self.session.execute(
            text("""
                INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                VALUES (:pid, NOW(), 'posted', 1)
            """),
            {"pid": pool_id}
        )
        self.assertTrue(already_posted_today(self.session))

    def test_already_posted_today_true_for_partial_today(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        pool_id = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 1")
        ).scalar()
        self.session.execute(
            text("""
                INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                VALUES (:pid, NOW(), 'partial', 1)
            """),
            {"pid": pool_id}
        )
        self.assertTrue(already_posted_today(self.session),
                        "partial-success today should block another post attempt")

    def test_already_posted_today_false_for_failed_today(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        pool_id = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 1")
        ).scalar()
        self.session.execute(
            text("""
                INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                VALUES (:pid, NOW(), 'failed', 1)
            """),
            {"pid": pool_id}
        )
        self.assertFalse(already_posted_today(self.session),
                         "failed posts should NOT block a same-day retry")

    def test_already_posted_today_false_for_yesterday(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        pool_id = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 1")
        ).scalar()
        self.session.execute(
            text("""
                INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                VALUES (:pid, NOW() - INTERVAL '2 days', 'posted', 1)
            """),
            {"pid": pool_id}
        )
        self.assertFalse(already_posted_today(self.session))

    # ---- current_cycle_id ----

    def test_current_cycle_defaults_to_1(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        self.assertEqual(current_cycle_id(self.session), 1)

    def test_current_cycle_reads_max_posted_cycle(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        pool_id = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 1")
        ).scalar()
        self.session.execute(
            text("""
                INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                VALUES (:pid, NOW() - INTERVAL '5 days', 'posted', 7)
            """),
            {"pid": pool_id}
        )
        self.assertEqual(current_cycle_id(self.session), 7)

    def test_current_cycle_ignores_failed_rows(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        pool_id = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 1")
        ).scalar()
        self.session.execute(
            text("""
                INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                VALUES (:pid, NOW() - INTERVAL '5 days', 'failed', 7)
            """),
            {"pid": pool_id}
        )
        self.assertEqual(current_cycle_id(self.session), 1,
                         "failed rows shouldn't determine the cycle")

    # ---- pool_remaining_in_cycle ----

    def test_pool_remaining_full_when_no_posts(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        total = self.session.execute(text("SELECT COUNT(*) FROM chord_pool")).scalar()
        self.assertEqual(pool_remaining_in_cycle(self.session, 1), total)

    def test_pool_remaining_decrements_with_posts(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        total = self.session.execute(text("SELECT COUNT(*) FROM chord_pool")).scalar()
        ids = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 3")
        ).fetchall()
        for (pid,) in ids:
            self.session.execute(
                text("""
                    INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                    VALUES (:pid, NOW() - INTERVAL '5 days', 'posted', 1)
                """),
                {"pid": pid}
            )
        self.assertEqual(pool_remaining_in_cycle(self.session, 1), total - 3)

    # ---- pick_chord_for_today ----

    def test_pick_returns_none_when_already_posted_today(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        pool_id = self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id LIMIT 1")
        ).scalar()
        self.session.execute(
            text("""
                INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                VALUES (:pid, NOW(), 'posted', 1)
            """),
            {"pid": pool_id}
        )
        self.assertIsNone(pick_chord_for_today(self.session))

    def test_pick_returns_a_chord_when_eligible(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        result = pick_chord_for_today(self.session)
        self.assertIsNotNone(result)
        self.assertGreater(result.chord_pool_id, 0)
        self.assertTrue(result.chord_name)
        self.assertEqual(result.cycle_id, 1)

    def test_pick_skips_already_posted_in_same_cycle(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        # Post all but one chord_pool row in cycle 1, dated yesterday so the
        # already_posted_today check doesn't short-circuit
        all_ids = [r[0] for r in self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id")
        ).fetchall()]
        keep = all_ids[-1]  # the only one not yet posted
        for pid in all_ids[:-1]:
            self.session.execute(
                text("""
                    INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                    VALUES (:pid, NOW() - INTERVAL '5 days', 'posted', 1)
                """),
                {"pid": pid}
            )
        result = pick_chord_for_today(self.session)
        self.assertIsNotNone(result)
        self.assertEqual(result.chord_pool_id, keep,
                         "should pick the one chord not yet posted in this cycle")
        self.assertEqual(result.cycle_id, 1)

    def test_pick_bumps_cycle_when_pool_exhausted(self):
        self.session.execute(text("DELETE FROM posted_chords"))
        # Post EVERY chord_pool row in cycle 1, dated yesterday
        all_ids = [r[0] for r in self.session.execute(
            text("SELECT id FROM chord_pool ORDER BY id")
        ).fetchall()]
        for pid in all_ids:
            self.session.execute(
                text("""
                    INSERT INTO posted_chords (chord_pool_id, posted_at, status, cycle_id)
                    VALUES (:pid, NOW() - INTERVAL '5 days', 'posted', 1)
                """),
                {"pid": pid}
            )
        result = pick_chord_for_today(self.session)
        self.assertIsNotNone(result)
        self.assertEqual(result.cycle_id, 2,
                         "exhausted cycle 1 should yield cycle 2")
        self.assertIn(result.chord_pool_id, all_ids,
                      "cycle 2 picks should be from the same chord_pool")


if __name__ == '__main__':
    unittest.main()
