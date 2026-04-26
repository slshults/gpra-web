#!/usr/bin/env python3
"""
Chord of the Day Cron Job

Picks a curated chord, builds a post, sends it to BlueSky and Facebook, and
records the outcome in posted_chords + a PostHog event.

Selection rules (see app/services/daily_chord/selector.py for full detail):
  - Random pick from chord_pool, no-repeat-until-exhausted within a cycle
  - Per-day uniqueness: a 'posted' or 'partial' row for today short-circuits
    the run (so cron + manual triggers never double-post)
  - Cycle auto-bumps when the pool exhausts; old posts stay in their cycle

Failures from one platform don't block the other — `partial` status records
which platform succeeded so we don't re-attempt that side. PostHog events
fire for posted / partial / failed / pool-exhausted outcomes.

Set COTD_ENABLED=false in .env to deploy this script + crontab entry while
keeping the loop dormant (e.g., during smoke-testing).

Example crontab entry (runs daily at 14:00 UTC = 9:00 am US Eastern):
0 14 * * * /path/to/venv/bin/python3 /path/to/gprweb/cron/post_chord_of_day.py
"""

import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path so we can import app.*
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from sqlalchemy import text

from app.database import SessionLocal
from app.services.daily_chord.formatter import format_post
from app.services.daily_chord.selector import (
    current_cycle_id,
    pick_chord_for_today,
)
from app.services.social import bluesky, facebook
from app.utils.posthog_client import track_event


COTD_DISTINCT_ID = 'cotd-bot'

log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

# Configure our own logger explicitly. basicConfig is a no-op once Flask app
# init has already attached handlers to the root logger, so we set up our own.
logger = logging.getLogger('cotd_cron')
logger.setLevel(logging.INFO)
logger.propagate = False  # don't double-log via the root handler
_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
_file_handler = logging.FileHandler(log_dir / 'cotd_cron.log')
_file_handler.setFormatter(_formatter)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_formatter)
if not logger.handlers:
    logger.addHandler(_file_handler)
    logger.addHandler(_stream_handler)


def _record_outcome(
    db,
    chord_pool_id: int,
    cycle_id: int,
    bluesky_result: dict,
    facebook_result: dict,
) -> str:
    """Insert a posted_chords row reflecting the run outcome.

    Returns the status string ('posted' | 'partial' | 'failed').
    """
    bs_ok = bluesky_result.get('ok', False)
    fb_ok = facebook_result.get('ok', False)

    if bs_ok and fb_ok:
        status = 'posted'
    elif bs_ok or fb_ok:
        status = 'partial'
    else:
        status = 'failed'

    error_parts = []
    if not bs_ok:
        error_parts.append(f"bluesky: {bluesky_result.get('error', 'unknown')}")
    if not fb_ok:
        error_parts.append(f"facebook: {facebook_result.get('error', 'unknown')}")
    error_text = ' | '.join(error_parts) if error_parts else None

    db.execute(
        text("""
            INSERT INTO posted_chords (chord_pool_id, posted_at, status, bluesky_uri, facebook_post_id, error, cycle_id)
            VALUES (:chord_pool_id, NOW(), :status, :bluesky_uri, :facebook_post_id, :error, :cycle_id)
        """),
        {
            'chord_pool_id': chord_pool_id,
            'status': status,
            'bluesky_uri': bluesky_result.get('uri') if bs_ok else None,
            'facebook_post_id': facebook_result.get('post_id') if fb_ok else None,
            'error': error_text,
            'cycle_id': cycle_id,
        },
    )
    db.commit()
    return status


def _track_outcome(status: str, payload: dict, chord_pool_id: int, cycle_id: int,
                   bluesky_result: dict, facebook_result: dict) -> None:
    base_props = {
        'chord_name': payload['chord_name'],
        'chord_pool_id': chord_pool_id,
        'cycle_id': cycle_id,
    }
    if status == 'posted':
        track_event(
            user_id=None,
            event_name='chord_of_day_posted',
            properties={
                **base_props,
                'bluesky_uri': bluesky_result.get('uri'),
                'facebook_post_id': facebook_result.get('post_id'),
            },
            distinct_id=COTD_DISTINCT_ID,
        )
    elif status == 'partial':
        platform_succeeded = 'bluesky' if bluesky_result.get('ok') else 'facebook'
        platform_failed = 'facebook' if bluesky_result.get('ok') else 'bluesky'
        failed_result = facebook_result if bluesky_result.get('ok') else bluesky_result
        track_event(
            user_id=None,
            event_name='chord_of_day_partial',
            properties={
                **base_props,
                'platform_succeeded': platform_succeeded,
                'platform_failed': platform_failed,
                'error': failed_result.get('error', 'unknown'),
            },
            distinct_id=COTD_DISTINCT_ID,
        )
    else:  # failed
        track_event(
            user_id=None,
            event_name='chord_of_day_failed',
            properties={
                **base_props,
                'bluesky_error': bluesky_result.get('error', 'unknown'),
                'facebook_error': facebook_result.get('error', 'unknown'),
            },
            distinct_id=COTD_DISTINCT_ID,
        )


def post_chord_of_day() -> int:
    """Run one Chord of the Day attempt.

    Return code:
      0 = posted (or partial)
      1 = failed (both platforms)
      2 = skipped (already posted today, or pool empty, or COTD_ENABLED=false)
    """
    if os.getenv('COTD_ENABLED', 'true').lower() not in ('true', '1', 'yes'):
        logger.info("COTD_ENABLED is false; skipping run.")
        return 2

    logger.info("Starting Chord of the Day run...")

    db = SessionLocal()
    try:
        previous_cycle = current_cycle_id(db)

        result = pick_chord_for_today(db)
        if result is None:
            logger.info("No chord to post (already posted today, or pool empty). Exiting.")
            return 2

        if result.cycle_id > previous_cycle:
            logger.info(f"Pool exhausted in cycle {previous_cycle}; starting cycle {result.cycle_id}")
            track_event(
                user_id=None,
                event_name='chord_of_day_pool_exhausted',
                properties={
                    'previous_cycle_id': previous_cycle,
                    'new_cycle_id': result.cycle_id,
                },
                distinct_id=COTD_DISTINCT_ID,
            )

        payload = format_post(result.chord_name, result.common_chord_id)
        logger.info(f"Picked chord {result.chord_name} (chord_pool_id={result.chord_pool_id}, cycle={result.cycle_id})")
        logger.info(f"URL: {payload['url']}")

        # Post to each platform sequentially. Sequential (not parallel) keeps error
        # sanitization simple and reduces blast radius if one platform's client
        # mishandles the response.
        bluesky_result = bluesky.post(text=payload['text'], url=payload['url'])
        if bluesky_result.get('ok'):
            logger.info(f"BlueSky posted: {bluesky_result.get('uri')}")
        else:
            logger.warning(f"BlueSky failed: {bluesky_result.get('error')}")

        facebook_result = facebook.post(message=payload['text'], link=payload['url'])
        if facebook_result.get('ok'):
            logger.info(f"Facebook posted: {facebook_result.get('post_id')}")
        else:
            logger.warning(f"Facebook failed: {facebook_result.get('error')}")

        status = _record_outcome(
            db, result.chord_pool_id, result.cycle_id,
            bluesky_result, facebook_result,
        )
        logger.info(f"Recorded outcome: status={status}")

        _track_outcome(status, payload, result.chord_pool_id, result.cycle_id,
                       bluesky_result, facebook_result)

        return 0 if status in ('posted', 'partial') else 1

    except Exception as e:
        logger.error(f"Unhandled error in Chord of the Day run: {e}", exc_info=True)
        db.rollback()
        return 1
    finally:
        db.close()


if __name__ == '__main__':
    sys.exit(post_chord_of_day())
