"""
PostHog Python SDK client wrapper for GPRA.

Provides:
- Auto-enrichment of events with subscription tier
- Helper functions for event tracking
- Anthropic client wrapping for LLM auto-instrumentation
"""

import os
import logging
from typing import Dict, Any, Optional
from posthog import Posthog

logger = logging.getLogger(__name__)

# Initialize PostHog client (singleton)
posthog_api_key = os.getenv('POSTHOG_API_KEY')
posthog_host = 'https://tacet.guitarpracticeroutine.com'  # Managed reverse proxy

if posthog_api_key:
    posthog_client = Posthog(
        project_api_key=posthog_api_key,
        host=posthog_host,
        debug=os.getenv('FLASK_ENV') == 'development',
        on_error=lambda e, batch: logger.error(f"PostHog error: {e}")
    )
    logger.info("PostHog Python SDK initialized")
else:
    posthog_client = None
    logger.warning("PostHog API key not found. Event tracking disabled.")


def get_posthog_distinct_id(user_id: int, email: Optional[str] = None) -> str:
    """
    Get the PostHog distinct_id for a user.

    Uses email for regular users, tidalNNNNN format for Tidal OAuth users.

    Args:
        user_id: User's database ID
        email: User's email address (optional - will query if not provided)

    Returns:
        distinct_id string (email or tidalNNNNN)
    """
    # If email not provided, query it from database
    if email is None:
        email = _get_user_email(user_id)

    # Tidal OAuth users have placeholder emails like tidal_123@no_email_provided_by_tidal.com
    if email and email.startswith('tidal_') and '@no_email_provided_by_tidal.com' in email:
        # Extract user_id from email and format as tidalNNNNN
        return f"tidal{user_id:05d}"

    # Regular users: use email as distinct_id
    return email if email else str(user_id)


def _get_user_email(user_id: int) -> Optional[str]:
    """
    Get the email for a user.

    Args:
        user_id: User ID

    Returns:
        User email or None
    """
    try:
        from app.database import SessionLocal
        from sqlalchemy import text

        db = SessionLocal()
        try:
            result = db.execute(text("""
                SELECT email
                FROM ab_user
                WHERE id = :user_id
            """), {'user_id': user_id}).fetchone()

            return result[0] if result else None
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to get email for user {user_id}: {str(e)}")
        return None


def track_event(
    user_id: Optional[int],
    event_name: str,
    properties: Optional[Dict[str, Any]] = None,
    distinct_id: Optional[str] = None
) -> None:
    """
    Track an event with PostHog, auto-enriching with subscription tier.

    Args:
        user_id: User ID (CRITICAL for multi-tenant analytics).
                 For authenticated endpoints, this should ALWAYS be provided.
                 If None and no distinct_id provided, event is skipped.
        event_name: Event name (e.g., "chord_chart_created")
        properties: Additional event properties
        distinct_id: PostHog distinct_id (email or tidalNNNNN). If not provided, will auto-compute from user_id.
    """
    if not posthog_client:
        return

    # Auto-compute distinct_id from user_id if not provided
    if distinct_id is None:
        if user_id:
            distinct_id = get_posthog_distinct_id(user_id)
        else:
            # No user_id and no distinct_id - skip tracking
            # PostHog has built-in anonymous handling; we should never use hardcoded "anonymous"
            logger.warning(f"Event '{event_name}' has no user_id or distinct_id - skipping. If this is an authenticated endpoint, this is a bug.")
            return

    # Initialize properties dict
    props = properties or {}

    # Auto-enrich with subscription tier if user_id provided
    if user_id:
        tier = _get_user_subscription_tier(user_id)
        if tier:
            props['subscription_tier'] = tier

    # Always include user_id for filtering
    if user_id:
        props['user_id'] = user_id

    try:
        posthog_client.capture(
            distinct_id=distinct_id,
            event=event_name,
            properties=props
        )
        logger.debug(f"Tracked event: {event_name} for user: {distinct_id}")
    except Exception as e:
        logger.error(f"Failed to track event {event_name}: {str(e)}")


def identify_user(user_id: int, properties: Optional[Dict[str, Any]] = None, distinct_id: Optional[str] = None) -> None:
    """
    Identify a user in PostHog with their properties.

    Args:
        user_id: User ID
        properties: User properties (email, subscription_tier, etc.)
        distinct_id: PostHog distinct_id (email or tidalNNNNN). If not provided, will auto-compute from user_id.
    """
    if not posthog_client:
        return

    # Auto-compute distinct_id from user_id if not provided
    if distinct_id is None:
        distinct_id = get_posthog_distinct_id(user_id)

    try:
        posthog_client.identify(
            distinct_id=distinct_id,
            properties=properties or {}
        )
        logger.debug(f"Identified user: {distinct_id}")
    except Exception as e:
        logger.error(f"Failed to identify user {distinct_id}: {str(e)}")


def _get_user_subscription_tier(user_id: int) -> Optional[str]:
    """
    Get the current subscription tier for a user.

    Args:
        user_id: User ID

    Returns:
        Subscription tier string or None
    """
    try:
        from app.database import SessionLocal
        from sqlalchemy import text

        db = SessionLocal()
        try:
            result = db.execute(text("""
                SELECT s.tier
                FROM subscriptions s
                WHERE s.user_id = :user_id
                AND s.status = 'active'
            """), {'user_id': user_id}).fetchone()

            return result[0] if result else None
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to get subscription tier for user {user_id}: {str(e)}")
        return None


def create_instrumented_anthropic_client(api_key: str, user_id: Optional[int] = None):
    """
    Create an Anthropic client with PostHog LLM auto-instrumentation.

    This automatically captures $ai_generation events with:
    - Tokens (input/output)
    - Cost (calculated from model pricing)
    - Latency (response time)
    - Model name
    - Provider (anthropic)
    - Correct distinct_id (user email or tidalNNNNN)

    Args:
        api_key: Anthropic API key
        user_id: User ID for PostHog distinct_id (CRITICAL for multi-tenant analytics)

    Returns:
        Anthropic client with PostHog instrumentation (or standard client if PostHog unavailable)
    """
    # Calculate distinct_id for this user
    distinct_id = None
    if user_id:
        distinct_id = get_posthog_distinct_id(user_id)
        logger.debug(f"PostHog distinct_id for user {user_id}: {distinct_id}")

    if not posthog_client:
        logger.warning("PostHog not initialized, creating standard Anthropic client")
        import anthropic
        return anthropic.Anthropic(api_key=api_key)

    try:
        # Use PostHog's instrumented Anthropic client class
        # This automatically tracks all API calls as $ai_generation events
        from posthog.ai.anthropic import Anthropic

        # Create instrumented client with distinct_id for proper user attribution
        # The distinct_id is passed to all auto-captured events
        client = Anthropic(
            posthog_client=posthog_client,
            api_key=api_key,
            posthog_distinct_id=distinct_id  # CRITICAL: Use proper distinct_id for multi-tenant analytics
        )
        logger.info(f"Anthropic client created with PostHog LLM instrumentation (distinct_id: {distinct_id})")
        return client
    except ImportError as e:
        logger.warning(f"PostHog LLM instrumentation not available: {e}. Creating standard Anthropic client.")
        logger.info("Manual tracking via llm_analytics.py will still work.")
        import anthropic
        return anthropic.Anthropic(api_key=api_key)
    except TypeError as e:
        # posthog_distinct_id parameter might not be supported in older SDK versions
        logger.warning(f"PostHog LLM instrumentation doesn't support distinct_id parameter: {e}. Falling back.")
        logger.info("Manual tracking via llm_analytics.py will use correct distinct_id.")
        import anthropic
        return anthropic.Anthropic(api_key=api_key)
    except Exception as e:
        logger.error(f"Failed to create instrumented Anthropic client: {str(e)}")
        import anthropic
        return anthropic.Anthropic(api_key=api_key)


def shutdown():
    """
    Shutdown PostHog client (flush pending events).
    Call this on app shutdown.
    """
    if posthog_client:
        try:
            posthog_client.flush()
            logger.info("PostHog client flushed and shutdown")
        except Exception as e:
            logger.error(f"Error shutting down PostHog client: {str(e)}")
