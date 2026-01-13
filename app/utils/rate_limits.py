"""
Rate limiting utilities for Anthropic API autocreate feature.

Implements tier-based rate limits:
- thegoods: 25/day, 10/hour
- moregoods: 50/day, 20/hour
- themost: 100/day, 40/hour
- complimentary: unlimited daily, 40/hour burst limit
- byoClaude (users with own API key): unlimited
"""

from datetime import datetime, timezone, timedelta
from typing import Tuple, Optional
import logging

logger = logging.getLogger(__name__)

# Rate limits by tier: (daily_limit, hourly_limit)
# None means unlimited
AUTOCREATE_RATE_LIMITS = {
    'free': (0, 0),  # No access without byoClaude key
    'basic': (0, 0),  # No access without byoClaude key
    'thegoods': (25, 10),
    'moregoods': (50, 20),
    'themost': (100, 40),
    'complimentary': (None, 40),  # Unlimited daily, 40/hour burst
}


def get_tier_rate_limits(tier: str, is_complimentary: bool = False) -> Tuple[Optional[int], Optional[int]]:
    """
    Get rate limits for a subscription tier.

    Args:
        tier: Subscription tier name
        is_complimentary: Whether this is a complimentary account

    Returns:
        Tuple of (daily_limit, hourly_limit). None means unlimited.
    """
    if is_complimentary:
        return AUTOCREATE_RATE_LIMITS['complimentary']

    return AUTOCREATE_RATE_LIMITS.get(tier, (0, 0))


def check_autocreate_rate_limit(
    user_id: int,
    tier: str,
    is_complimentary: bool = False,
    is_using_own_key: bool = False
) -> Tuple[bool, str, int, int, Optional[str], Optional[str]]:
    """
    Check if a user can make an autocreate API call.

    Args:
        user_id: User's ID
        tier: User's subscription tier
        is_complimentary: Whether this is a complimentary account
        is_using_own_key: Whether the user is using their own API key (byoClaude)

    Returns:
        Tuple of:
        - allowed: bool - Whether the call is allowed
        - reason: str - Reason if not allowed, or "OK" if allowed
        - remaining_daily: int - Remaining daily calls (-1 if unlimited)
        - remaining_hourly: int - Remaining hourly calls (-1 if unlimited)
        - daily_resets_at: str - ISO timestamp of next daily reset (or None)
        - hourly_resets_at: str - ISO timestamp of next hourly reset (or None)
    """
    # byoClaude users have unlimited access
    if is_using_own_key:
        logger.info(f"[RATE LIMIT] User {user_id} using own API key - no limits applied")
        return (True, "OK", -1, -1, None, None)

    # Get tier limits
    daily_limit, hourly_limit = get_tier_rate_limits(tier, is_complimentary)

    # Tiers without access (free/basic without byoClaude)
    if daily_limit == 0 and hourly_limit == 0:
        return (
            False,
            "Autocreate requires a subscription tier that includes this feature, or your own Anthropic API key.",
            0, 0, None, None
        )

    # Get current usage from database
    from app.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT
                autocreate_calls_today,
                autocreate_calls_this_hour,
                autocreate_daily_reset_at,
                autocreate_hourly_reset_at
            FROM subscriptions
            WHERE user_id = :user_id
            AND status = 'active'
        """), {'user_id': user_id}).fetchone()

        if not result:
            return (
                False,
                "No active subscription found.",
                0, 0, None, None
            )

        calls_today = result[0] or 0
        calls_this_hour = result[1] or 0
        daily_reset_at = result[2]
        hourly_reset_at = result[3]

        now = datetime.now(timezone.utc)

        # Check and reset daily counter if needed
        if daily_reset_at is None or now >= daily_reset_at:
            calls_today = 0
            # Calculate next midnight UTC
            tomorrow = now.date() + timedelta(days=1)
            daily_reset_at = datetime(
                tomorrow.year, tomorrow.month, tomorrow.day,
                0, 0, 0, tzinfo=timezone.utc
            )
            # Update in database
            db.execute(text("""
                UPDATE subscriptions
                SET autocreate_calls_today = 0,
                    autocreate_daily_reset_at = :reset_at
                WHERE user_id = :user_id
            """), {'user_id': user_id, 'reset_at': daily_reset_at})
            db.commit()
            logger.info(f"[RATE LIMIT] Reset daily counter for user {user_id}")

        # Check and reset hourly counter if needed
        if hourly_reset_at is None or now >= hourly_reset_at:
            calls_this_hour = 0
            # Calculate next hour boundary
            hourly_reset_at = (now + timedelta(hours=1)).replace(
                minute=0, second=0, microsecond=0
            )
            # Update in database
            db.execute(text("""
                UPDATE subscriptions
                SET autocreate_calls_this_hour = 0,
                    autocreate_hourly_reset_at = :reset_at
                WHERE user_id = :user_id
            """), {'user_id': user_id, 'reset_at': hourly_reset_at})
            db.commit()
            logger.info(f"[RATE LIMIT] Reset hourly counter for user {user_id}")

        # Calculate remaining
        remaining_daily = (daily_limit - calls_today) if daily_limit is not None else -1
        remaining_hourly = (hourly_limit - calls_this_hour) if hourly_limit is not None else -1

        # Format reset times
        daily_reset_str = daily_reset_at.isoformat() if daily_reset_at else None
        hourly_reset_str = hourly_reset_at.isoformat() if hourly_reset_at else None

        # Check daily limit (if not unlimited)
        if daily_limit is not None and calls_today >= daily_limit:
            tier_display = "complimentary" if is_complimentary else tier
            return (
                False,
                f"You've reached your daily autocreate limit ({daily_limit}/day for {tier_display} tier). Resets at midnight UTC.",
                remaining_daily,
                remaining_hourly,
                daily_reset_str,
                hourly_reset_str
            )

        # Check hourly limit (burst protection)
        if hourly_limit is not None and calls_this_hour >= hourly_limit:
            tier_display = "complimentary" if is_complimentary else tier
            return (
                False,
                f"You've reached your hourly autocreate limit ({hourly_limit}/hour for {tier_display} tier). Resets at the top of the hour.",
                remaining_daily,
                remaining_hourly,
                daily_reset_str,
                hourly_reset_str
            )

        logger.info(f"[RATE LIMIT] User {user_id} allowed: {remaining_daily} daily, {remaining_hourly} hourly remaining")
        return (True, "OK", remaining_daily, remaining_hourly, daily_reset_str, hourly_reset_str)

    except Exception as e:
        logger.error(f"[RATE LIMIT] Error checking rate limit for user {user_id}: {e}")
        # On error, allow the call but log the issue
        return (True, "OK (rate limit check failed)", -1, -1, None, None)
    finally:
        db.close()


def increment_autocreate_usage(user_id: int) -> bool:
    """
    Increment autocreate usage counters after a successful API call.

    Args:
        user_id: User's ID

    Returns:
        True if update succeeded, False otherwise
    """
    from app.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        # Get current reset times to ensure counters are initialized
        result = db.execute(text("""
            SELECT autocreate_daily_reset_at, autocreate_hourly_reset_at
            FROM subscriptions
            WHERE user_id = :user_id
        """), {'user_id': user_id}).fetchone()

        if not result:
            logger.error(f"[RATE LIMIT] No subscription found for user {user_id}")
            return False

        daily_reset_at = result[0]
        hourly_reset_at = result[1]

        # Initialize reset times if not set
        update_fields = ["autocreate_calls_today = autocreate_calls_today + 1",
                         "autocreate_calls_this_hour = autocreate_calls_this_hour + 1"]
        params = {'user_id': user_id}

        if daily_reset_at is None:
            tomorrow = now.date() + timedelta(days=1)
            daily_reset_at = datetime(
                tomorrow.year, tomorrow.month, tomorrow.day,
                0, 0, 0, tzinfo=timezone.utc
            )
            update_fields.append("autocreate_daily_reset_at = :daily_reset")
            params['daily_reset'] = daily_reset_at

        if hourly_reset_at is None:
            hourly_reset_at = (now + timedelta(hours=1)).replace(
                minute=0, second=0, microsecond=0
            )
            update_fields.append("autocreate_hourly_reset_at = :hourly_reset")
            params['hourly_reset'] = hourly_reset_at

        query = f"""
            UPDATE subscriptions
            SET {', '.join(update_fields)}
            WHERE user_id = :user_id
        """

        db.execute(text(query), params)
        db.commit()

        logger.info(f"[RATE LIMIT] Incremented usage counters for user {user_id}")
        return True

    except Exception as e:
        logger.error(f"[RATE LIMIT] Error incrementing usage for user {user_id}: {e}")
        db.rollback()
        return False
    finally:
        db.close()


def get_autocreate_usage_info(user_id: int, tier: str, is_complimentary: bool = False) -> dict:
    """
    Get current autocreate usage information for display to the user.

    Args:
        user_id: User's ID
        tier: User's subscription tier
        is_complimentary: Whether this is a complimentary account

    Returns:
        Dictionary with usage information
    """
    daily_limit, hourly_limit = get_tier_rate_limits(tier, is_complimentary)

    from app.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT
                autocreate_calls_today,
                autocreate_calls_this_hour,
                autocreate_daily_reset_at,
                autocreate_hourly_reset_at
            FROM subscriptions
            WHERE user_id = :user_id
        """), {'user_id': user_id}).fetchone()

        if not result:
            return {
                'daily_used': 0,
                'daily_limit': daily_limit,
                'hourly_used': 0,
                'hourly_limit': hourly_limit,
                'daily_resets_at': None,
                'hourly_resets_at': None,
            }

        return {
            'daily_used': result[0] or 0,
            'daily_limit': daily_limit,
            'hourly_used': result[1] or 0,
            'hourly_limit': hourly_limit,
            'daily_resets_at': result[2].isoformat() if result[2] else None,
            'hourly_resets_at': result[3].isoformat() if result[3] else None,
        }

    except Exception as e:
        logger.error(f"[RATE LIMIT] Error getting usage info for user {user_id}: {e}")
        return {
            'daily_used': 0,
            'daily_limit': daily_limit,
            'hourly_used': 0,
            'hourly_limit': hourly_limit,
            'daily_resets_at': None,
            'hourly_resets_at': None,
        }
    finally:
        db.close()
