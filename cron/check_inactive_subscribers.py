#!/usr/bin/env python3
"""
Check Inactive Subscribers Cron Job

This script runs daily to:
1. Find paying subscribers who haven't used GPRA in 90+ days
2. Send them a friendly reminder email (with opt-out link)
3. Update tracking fields to avoid duplicate emails

Also runs monthly to refresh stripe_period_end from Stripe API.

Example crontab entry (runs daily at 10 AM):
0 10 * * * /path/to/venv/bin/python3 /path/to/gprweb/cron/check_inactive_subscribers.py
"""

import argparse
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load environment variables from .env file if present
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from app.database import SessionLocal
from app.billing import subscription_period
from app.utils.email_templates import inactivity_notification_email
from app.utils.posthog_client import posthog_client, shutdown as posthog_shutdown
from sqlalchemy import text
from itsdangerous import URLSafeTimedSerializer
import stripe
import logging

# Configure logging
log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

# basicConfig is a no-op here: something in the `import app` chain configures
# the root logger before this module runs, so a later basicConfig is ignored
# and the FileHandler would be built but never attached, leaving the log file
# empty. Configure our own logger instead, as post_chord_of_day.py does.
#
# FileHandler only, also matching post_chord_of_day: without a redirect in the
# crontab entry a StreamHandler would mail the whole INFO transcript daily,
# whether or not anything failed, which trains the reader to ignore it.
# Uncaught tracebacks still reach stderr, and PostHog is the alert path.
logger = logging.getLogger('inactivity_cron')
logger.setLevel(logging.INFO)
logger.propagate = False
_file_handler = logging.FileHandler(log_dir / 'inactivity_cron.log')
_file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger.addHandler(_file_handler)


def _report_failure(exc: Exception) -> None:
    """Report a task failure to PostHog; the log file alone alerts nobody."""
    if not posthog_client:
        return
    try:
        posthog_client.capture_exception(exc, distinct_id='cron_check_inactive_subscribers')
    except Exception:
        logger.exception("Failed to report cron failure to PostHog")


def generate_unsubscribe_token(user_id: int) -> str:
    """
    Generate a signed token for one-click unsubscribe from inactivity emails.

    Uses itsdangerous (same as Flask's session signing) for secure tokens
    that can be validated without database lookup.
    """
    secret_key = os.getenv('SECRET_KEY')
    if not secret_key:
        raise ValueError("SECRET_KEY environment variable not set")

    serializer = URLSafeTimedSerializer(secret_key)
    payload = {
        'user_id': user_id,
        'type': 'inactivity_unsubscribe'
    }
    return serializer.dumps(payload, salt='inactivity-unsubscribe-salt')


def check_inactive_subscribers(dry_run: bool = False):
    """
    Find paying subscribers who:
    1. Have tier != 'free' AND status = 'active'
    2. Have last_activity older than 90 days
    3. Have NOT opted out (inactivity_emails_opted_out = FALSE)
    4. Either never received an inactivity email, OR it's 2 days before their next
       renewal and they were not emailed in the last 7 days

    Send them an inactivity notification email and update tracking fields.
    With dry_run, log who would be emailed and change nothing.
    """
    logger.info("Starting inactive subscriber check%s...", " (dry run)" if dry_run else "")

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        ninety_days_ago = now - timedelta(days=90)
        two_days_from_now = now + timedelta(days=2)
        # Assumes no billing period is shorter than the cutoff: on a weekly
        # plan this would suppress legitimate renewal reminders.
        resend_cutoff = now - timedelta(days=7)

        # Find inactive paying subscribers who need notification
        # Conditions:
        # - Paying tier (not free)
        # - Active subscription status
        # - Last activity more than 90 days ago (or never recorded)
        # - Not opted out of inactivity emails
        # - Either: never sent an email, OR current_period_end is within 2 days
        #   and the last email is older than the resend cutoff
        result = db.execute(text("""
            SELECT
                s.user_id,
                s.tier,
                s.current_period_end,
                s.last_activity,
                s.last_inactivity_email_sent,
                u.email,
                u.username
            FROM subscriptions s
            JOIN ab_user u ON s.user_id = u.id
            WHERE s.tier != 'free'
                AND s.status = 'active'
                AND COALESCE(s.is_complimentary, FALSE) = FALSE
                AND COALESCE(s.inactivity_emails_opted_out, FALSE) = FALSE
                AND (s.last_activity IS NULL OR s.last_activity < :ninety_days_ago)
                AND (
                    s.last_inactivity_email_sent IS NULL
                    OR (
                        s.current_period_end IS NOT NULL
                        AND s.current_period_end <= :two_days_from_now
                        AND s.current_period_end > :now
                        AND s.last_inactivity_email_sent < :resend_cutoff
                    )
                )
        """), {
            'ninety_days_ago': ninety_days_ago,
            'two_days_from_now': two_days_from_now,
            'now': now,
            'resend_cutoff': resend_cutoff
        })

        inactive_subscribers = result.fetchall()
        logger.info(f"Found {len(inactive_subscribers)} inactive subscribers to notify")
        send_failures = 0
        attempted = 0

        for subscriber in inactive_subscribers:
            user_id, tier, period_end, last_activity, last_email_sent, email, username = subscriber

            # Skip placeholder Tidal emails (they won't receive emails anyway)
            if email and 'no_email_provided_by_tidal.com' in email:
                logger.info(f"Skipping Tidal user {user_id} with placeholder email")
                continue

            # Identify recipients by user_id only: this log is now written to
            # disk on every run, and emails would accumulate there unrotated.
            logger.info(f"Processing inactive user {user_id} - tier: {tier}, last_activity: {last_activity}")

            if dry_run:
                logger.info(f"Dry run: would send inactivity email to user {user_id}")
                continue

            attempted += 1

            try:
                # Generate unsubscribe token
                unsubscribe_token = generate_unsubscribe_token(user_id)

                # Send notification email
                success = inactivity_notification_email(
                    to_email=email,
                    username=username,
                    unsubscribe_token=unsubscribe_token
                )

                if success:
                    # Update tracking field
                    db.execute(text("""
                        UPDATE subscriptions
                        SET last_inactivity_email_sent = :now
                        WHERE user_id = :user_id
                    """), {'now': now, 'user_id': user_id})
                    db.commit()
                    logger.info(f"Sent inactivity email to user {user_id}")
                else:
                    send_failures += 1
                    logger.error(f"Failed to send inactivity email to user {user_id}")

            except Exception as e:
                send_failures += 1
                logger.error(f"Error processing user {user_id}: {e}")
                db.rollback()
                # Continue to next subscriber

        logger.info("Inactive subscriber check complete")

        # A batch that failed entirely is an outage and must not look like a
        # success. Partial failures are usually undeliverable addresses; those
        # get reported but must not raise, because a failed send never records
        # last_inactivity_email_sent, so the same address re-matches tomorrow
        # and would keep this job permanently red.
        if send_failures:
            message = f"{send_failures} of {attempted} inactivity emails failed to send"
            if send_failures == attempted:
                raise RuntimeError(message)
            logger.error(message)
            _report_failure(RuntimeError(message))

    except Exception as e:
        logger.exception("Error in inactive subscriber check")
        _report_failure(e)
        db.rollback()
        raise
    finally:
        db.close()


def refresh_stripe_period_end(dry_run: bool = False, force: bool = False):
    """
    Once per month, refresh current_period_end from Stripe for all paying subscribers.

    This ensures our local data stays in sync with Stripe's actual subscription dates.
    Only runs on the 1st of each month unless force=True (`--refresh-now` on the CLI).
    With dry_run, log the updates and write nothing.
    """
    # A dry run ignores the monthly window so the path can be inspected on any
    # day; it performs Stripe reads only.
    if datetime.utcnow().day != 1 and not dry_run and not force:
        logger.info("Skipping Stripe period refresh (not the 1st of the month)")
        return

    logger.info("Starting monthly Stripe period_end refresh...")

    # Initialize Stripe
    stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
    if not stripe.api_key:
        logger.error("STRIPE_SECRET_KEY not configured")
        return

    db = SessionLocal()
    try:
        # Find all paying subscribers with a Stripe subscription ID
        result = db.execute(text("""
            SELECT user_id, stripe_subscription_id
            FROM subscriptions
            WHERE tier != 'free'
                AND status = 'active'
                AND stripe_subscription_id IS NOT NULL
        """))

        subscribers = result.fetchall()
        logger.info(f"Refreshing period_end for {len(subscribers)} paying subscribers")

        updated_count = 0
        for user_id, stripe_sub_id in subscribers:
            try:
                # Fetch subscription from Stripe
                stripe_sub = stripe.Subscription.retrieve(stripe_sub_id)

                # Update local database with Stripe's billing period
                # Also update stripe_period_end for backward compatibility
                period_start, period_end = subscription_period(stripe_sub)
                if period_end is None:
                    logger.warning(f"Stripe subscription {stripe_sub_id} for user {user_id} has no current_period_end; skipping")
                    continue

                if dry_run:
                    logger.info(f"Dry run: would set period_start={period_start} period_end={period_end} for user {user_id}")
                    updated_count += 1
                    continue

                db.execute(text("""
                    UPDATE subscriptions
                    SET current_period_start = :period_start,
                        current_period_end = :period_end,
                        stripe_period_end = :period_end
                    WHERE user_id = :user_id
                """), {'period_start': period_start, 'period_end': period_end, 'user_id': user_id})

                updated_count += 1

            except stripe.InvalidRequestError as e:
                # Subscription might be canceled/deleted in Stripe
                logger.warning(f"Could not fetch Stripe subscription {stripe_sub_id} for user {user_id}: {e}")
            except Exception as e:
                logger.error(f"Error refreshing period_end for user {user_id}: {e}")

        if not dry_run:
            db.commit()
        verb = 'Would refresh' if dry_run else 'Refreshed'
        logger.info(f"{verb} period_end for {updated_count} subscribers")

    except Exception as e:
        logger.exception("Error in Stripe period refresh")
        _report_failure(e)
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Notify inactive paying subscribers.')
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Log what would be sent or updated without emailing anyone or writing to the database'
    )
    parser.add_argument(
        '--refresh-now',
        action='store_true',
        help='Run only the Stripe billing-period refresh, outside its monthly window; skips the email sweep'
    )
    args = parser.parse_args()

    # Exit code is for a supervisor or a wrapper that checks it. Cron itself
    # mails on output, not on status, so PostHog reporting is the alert path.
    exit_code = 0

    # `--refresh-now` exists to backfill the billing period right after a fix
    # to the refresh itself, without re-running the email sweep the daily cron
    # has already done.
    if not args.refresh_now:
        try:
            check_inactive_subscribers(dry_run=args.dry_run)
        except Exception:
            exit_code = 1

    try:
        refresh_stripe_period_end(dry_run=args.dry_run, force=args.refresh_now)
    except Exception:
        exit_code = 1

    posthog_shutdown()
    sys.exit(exit_code)
