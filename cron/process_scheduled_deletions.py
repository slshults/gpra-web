#!/usr/bin/env python3
"""
Process Scheduled Account Deletions Cron Job

This script runs daily to process accounts scheduled for deletion.
It should be configured to run via cron on the production server.

Example crontab entry (runs daily at 2 AM):
0 2 * * * /path/to/venv/bin/python3 /path/to/gprweb/cron/process_scheduled_deletions.py
"""

import os
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.utils.email_templates import final_deletion_scheduled_email
from app.utils.account_deletion import delete_user_account
from sqlalchemy import text
import stripe
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/deletion_cron.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


def process_scheduled_deletions():
    """
    Process all accounts scheduled for deletion today or earlier.

    For each account:
    1. Process Stripe refund
    2. Delete all user data (items, routines, chord charts, practice events)
    3. Delete subscription record
    4. Delete user account
    5. Send farewell email
    """
    logger.info("Starting scheduled deletion processing...")

    # Initialize Stripe
    stripe.api_key = os.getenv('STRIPE_SECRET_KEY')

    db = SessionLocal()
    try:
        # Find all subscriptions scheduled for deletion
        result = db.execute(text("""
            SELECT
                s.user_id,
                s.deletion_scheduled_for,
                s.deletion_type,
                s.prorated_refund_amount,
                s.stripe_customer_id,
                u.email,
                u.username
            FROM subscriptions s
            JOIN ab_user u ON s.user_id = u.id
            WHERE s.deletion_scheduled_for IS NOT NULL
                AND s.deletion_scheduled_for <= NOW()
                AND s.deletion_type = 'scheduled'
        """))

        deletions = result.fetchall()
        logger.info(f"Found {len(deletions)} accounts to delete")

        for deletion in deletions:
            user_id, deletion_date, deletion_type, refund_amount, stripe_customer_id, email, username = deletion

            logger.info(f"Processing deletion for user {user_id} ({username})")

            try:
                # Step 1: Process Stripe refund (if applicable)
                if stripe_customer_id and refund_amount and refund_amount > 0:
                    logger.info(f"Processing refund of ${refund_amount} for user {user_id}")
                    try:
                        # Create refund for the customer
                        # Note: This creates a refund for the most recent charge
                        charges = stripe.Charge.list(customer=stripe_customer_id, limit=1)
                        if charges.data:
                            latest_charge = charges.data[0]
                            refund = stripe.Refund.create(
                                charge=latest_charge.id,
                                amount=int(refund_amount * 100),  # Convert dollars to cents
                                reason='requested_by_customer'
                            )
                            logger.info(f"Refund created: {refund.id}")
                    except Exception as e:
                        logger.error(f"Error processing refund for user {user_id}: {e}")
                        # Continue with deletion even if refund fails

                # Step 2: Delete all user data using centralized deletion utility
                # This handles:
                # - All database records (items, routines, chord charts, events, subscription, user)
                # - PostHog person profile deletion (GDPR compliance)
                logger.info(f"Deleting account for user {user_id} using delete_user_account() utility")

                deletion_success = delete_user_account(db, user_id, email)

                if not deletion_success:
                    raise Exception(f"Account deletion failed for user {user_id}")

                logger.info(f"Successfully deleted all data for user {user_id}")

                # Step 3: Send farewell email
                try:
                    final_deletion_scheduled_email(
                        to_email=email,
                        username=username,
                        deletion_date=deletion_date.strftime("%B %d, %Y"),
                        refund_amount=refund_amount or 0
                    )
                    logger.info(f"Farewell email sent to {email}")
                except Exception as e:
                    logger.error(f"Error sending farewell email to {email}: {e}")

            except Exception as e:
                logger.error(f"Error processing deletion for user {user_id}: {e}")
                db.rollback()
                # Continue to next deletion

        logger.info("Scheduled deletion processing complete")

    except Exception as e:
        logger.error(f"Error in scheduled deletion processing: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == '__main__':
    process_scheduled_deletions()
