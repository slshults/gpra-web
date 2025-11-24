"""Account deletion utilities for GPRA"""
import os
import logging
import requests
from sqlalchemy import text
from datetime import datetime

logger = logging.getLogger(__name__)


def delete_posthog_person_profile(user_id, email):
    """
    Delete a user's PostHog person profile and all associated events.

    Args:
        user_id: User's database ID
        email: User's email address (used as distinct_id in PostHog)

    Returns:
        bool: True if successful, False otherwise
    """
    posthog_api_key = os.getenv('POSTHOG_API_KEY')
    if not posthog_api_key:
        logger.warning("PostHog API key not configured, skipping person deletion")
        return False

    try:
        # PostHog person deletion API
        # https://posthog.com/docs/api/persons#delete-persons-data
        url = "https://app.posthog.com/api/person/"
        headers = {
            "Authorization": f"Bearer {posthog_api_key}",
            "Content-Type": "application/json"
        }

        # Try deleting by distinct_id (email)
        params = {
            "distinct_id": email
        }

        response = requests.delete(url, headers=headers, params=params, timeout=10)

        if response.status_code == 204:
            logger.info(f"Successfully deleted PostHog person profile for user {user_id} ({email})")
            return True
        elif response.status_code == 404:
            logger.info(f"No PostHog person profile found for user {user_id} ({email})")
            return True  # Consider this success - profile doesn't exist
        else:
            logger.error(f"Failed to delete PostHog person profile: {response.status_code} - {response.text}")
            return False

    except Exception as e:
        logger.error(f"Error deleting PostHog person profile for user {user_id}: {e}")
        return False


def delete_user_account(db, user_id, email):
    """
    Permanently delete a user account and all associated data.

    This is called for immediate deletion or after scheduled deletion date.
    Deletes:
    - User record from ab_user
    - Subscription record
    - All practice items
    - All routines and routine_items
    - All chord charts
    - All practice events
    - User preferences
    - PostHog person profile

    Args:
        db: Database session
        user_id: User's database ID
        email: User's email address

    Returns:
        bool: True if successful, False otherwise
    """
    try:
        logger.info(f"Starting account deletion for user {user_id} ({email})")

        # Delete PostHog person profile first (while we still have user_id/email)
        delete_posthog_person_profile(user_id, email)

        # Delete in reverse order of foreign key dependencies
        # (child tables first, parent tables last)

        # 1. Delete practice events
        result = db.execute(text("""
            DELETE FROM practice_events WHERE user_id = :user_id
        """), {"user_id": user_id})
        logger.info(f"Deleted {result.rowcount} practice events for user {user_id}")

        # 2. Delete user preferences
        result = db.execute(text("""
            DELETE FROM user_preferences WHERE user_id = :user_id
        """), {"user_id": user_id})
        logger.info(f"Deleted user preferences for user {user_id}")

        # 3. Delete chord charts
        result = db.execute(text("""
            DELETE FROM chord_charts WHERE user_id = :user_id
        """), {"user_id": user_id})
        logger.info(f"Deleted {result.rowcount} chord charts for user {user_id}")

        # 4. Delete routine_items (junction table)
        # First get routine IDs for this user
        routine_ids = db.execute(text("""
            SELECT id FROM routines WHERE user_id = :user_id
        """), {"user_id": user_id}).fetchall()

        if routine_ids:
            routine_id_list = [r[0] for r in routine_ids]
            placeholders = ','.join([f':id_{i}' for i in range(len(routine_id_list))])
            params = {f'id_{i}': rid for i, rid in enumerate(routine_id_list)}

            result = db.execute(text(f"""
                DELETE FROM routine_items WHERE routine_id IN ({placeholders})
            """), params)
            logger.info(f"Deleted {result.rowcount} routine items for user {user_id}")

        # 5. Delete routines
        result = db.execute(text("""
            DELETE FROM routines WHERE user_id = :user_id
        """), {"user_id": user_id})
        logger.info(f"Deleted {result.rowcount} routines for user {user_id}")

        # 6. Delete items
        result = db.execute(text("""
            DELETE FROM items WHERE user_id = :user_id
        """), {"user_id": user_id})
        logger.info(f"Deleted {result.rowcount} items for user {user_id}")

        # 7. Delete subscription
        result = db.execute(text("""
            DELETE FROM subscriptions WHERE user_id = :user_id
        """), {"user_id": user_id})
        logger.info(f"Deleted subscription for user {user_id}")

        # 8. Finally, delete user from ab_user
        result = db.execute(text("""
            DELETE FROM ab_user WHERE id = :user_id
        """), {"user_id": user_id})
        logger.info(f"Deleted ab_user record for user {user_id}")

        db.commit()
        logger.info(f"Successfully completed account deletion for user {user_id}")
        return True

    except Exception as e:
        db.rollback()
        logger.error(f"Error during account deletion for user {user_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False
