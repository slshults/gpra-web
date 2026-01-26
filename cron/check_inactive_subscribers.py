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
from app.utils.email_templates import inactivity_notification_email
from sqlalchemy import text
from itsdangerous import URLSafeTimedSerializer
import stripe
import logging

# Configure logging
log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_dir / 'inactivity_cron.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


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


def check_inactive_subscribers():
    """
    Find paying subscribers who:
    1. Have tier != 'free' AND status = 'active'
    2. Have last_activity older than 90 days
    3. Have NOT opted out (inactivity_emails_opted_out = FALSE)
    4. Either never received an inactivity email, OR it's 2 days before their next renewal

    Send them an inactivity notification email and update tracking fields.
    """
    logger.info("Starting inactive subscriber check...")

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        ninety_days_ago = now - timedelta(days=90)
        two_days_from_now = now + timedelta(days=2)

        # Find inactive paying subscribers who need notification
        # Conditions:
        # - Paying tier (not free)
        # - Active subscription status
        # - Last activity more than 90 days ago (or never recorded)
        # - Not opted out of inactivity emails
        # - Either: never sent an email, OR current_period_end is within 2 days
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
                AND COALESCE(s.inactivity_emails_opted_out, FALSE) = FALSE
                AND (s.last_activity IS NULL OR s.last_activity < :ninety_days_ago)
                AND (
                    s.last_inactivity_email_sent IS NULL
                    OR (
                        s.current_period_end IS NOT NULL
                        AND s.current_period_end <= :two_days_from_now
                        AND s.current_period_end > :now
                    )
                )
        """), {
            'ninety_days_ago': ninety_days_ago,
            'two_days_from_now': two_days_from_now,
            'now': now
        })

        inactive_subscribers = result.fetchall()
        logger.info(f"Found {len(inactive_subscribers)} inactive subscribers to notify")

        for subscriber in inactive_subscribers:
            user_id, tier, period_end, last_activity, last_email_sent, email, username = subscriber

            # Skip placeholder Tidal emails (they won't receive emails anyway)
            if email and 'no_email_provided_by_tidal.com' in email:
                logger.info(f"Skipping Tidal user {user_id} with placeholder email")
                continue

            logger.info(f"Processing inactive user {user_id} ({username}) - tier: {tier}, last_activity: {last_activity}")

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
                    logger.info(f"Sent inactivity email to {email}")
                else:
                    logger.error(f"Failed to send inactivity email to {email}")

            except Exception as e:
                logger.error(f"Error processing user {user_id}: {e}")
                db.rollback()
                # Continue to next subscriber

        logger.info("Inactive subscriber check complete")

    except Exception as e:
        logger.error(f"Error in inactive subscriber check: {e}")
        db.rollback()
    finally:
        db.close()


def refresh_stripe_period_end():
    """
    Once per month, refresh current_period_end from Stripe for all paying subscribers.

    This ensures our local data stays in sync with Stripe's actual subscription dates.
    Only runs on the 1st of each month.
    """
    # Only run on the 1st of the month
    if datetime.utcnow().day != 1:
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

                # Update local database with Stripe's current_period_end
                # Also update stripe_period_end for backward compatibility
                period_end = datetime.utcfromtimestamp(stripe_sub.current_period_end)

                db.execute(text("""
                    UPDATE subscriptions
                    SET current_period_end = :period_end,
                        stripe_period_end = :period_end
                    WHERE user_id = :user_id
                """), {'period_end': period_end, 'user_id': user_id})

                updated_count += 1

            except stripe.error.InvalidRequestError as e:
                # Subscription might be canceled/deleted in Stripe
                logger.warning(f"Could not fetch Stripe subscription {stripe_sub_id} for user {user_id}: {e}")
            except Exception as e:
                logger.error(f"Error refreshing period_end for user {user_id}: {e}")

        db.commit()
        logger.info(f"Refreshed period_end for {updated_count} subscribers")

    except Exception as e:
        logger.error(f"Error in Stripe period refresh: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == '__main__':
    # Run both tasks
    check_inactive_subscribers()
    refresh_stripe_period_end()
