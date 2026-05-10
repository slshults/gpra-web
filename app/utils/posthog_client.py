"""
PostHog Python SDK client wrapper for GPRA.

Provides:
- Auto-enrichment of events with subscription tier
- Helper functions for event tracking
- Anthropic client wrapping for LLM auto-instrumentation
"""

import hmac
import hashlib
import os
import logging
from typing import Dict, Any, Optional
from posthog import Posthog

logger = logging.getLogger(__name__)

# Initialize PostHog client (singleton)
posthog_api_key = os.getenv('POSTHOG_API_KEY')
posthog_secret_api_token = os.getenv('POSTHOG_SECRET_API_TOKEN')
posthog_host = 'https://tacet.guitarpracticeroutine.com'  # Managed reverse proxy

if posthog_api_key:
    posthog_client = Posthog(
        project_api_key=posthog_api_key,
        host=posthog_host,
        enable_exception_autocapture=True,
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


def get_posthog_identity_hash(distinct_id: str) -> Optional[str]:
    """
    Compute HMAC-SHA256 of distinct_id using the team's secret API token,
    for the PostHog support widget's identity verification mode.

    Returns None when no secret is configured — callers should treat that as
    "verification not active" and the widget falls back to session-based access.
    """
    if not posthog_secret_api_token or not distinct_id:
        return None
    return hmac.new(
        posthog_secret_api_token.encode('utf-8'),
        distinct_id.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()


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


def get_client_ip() -> Optional[str]:
    """Get client IP from Flask request context for PostHog GeoIP."""
    try:
        from flask import has_request_context, request
        if has_request_context():
            forwarded = request.headers.get('X-Forwarded-For')
            if forwarded:
                return forwarded.split(',')[0].strip()
            return request.remote_addr
    except Exception:
        pass
    return None


def track_event(
    user_id: Optional[int],
    event_name: str,
    properties: Optional[Dict[str, Any]] = None,
    distinct_id: Optional[str] = None,
    ip: Optional[str] = None
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
        ip: Client IP address for GeoIP enrichment. Use get_client_ip() for request-context calls.
            Pass None for non-request contexts (webhooks, background tasks).
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
    props = dict(properties) if properties else {}

    # Auto-enrich with subscription tier if user_id provided
    if user_id:
        tier = _get_user_subscription_tier(user_id)
        if tier:
            props['subscription_tier'] = tier

    # Always include user_id for filtering
    if user_id:
        props['user_id'] = user_id

    if ip:
        props['$ip'] = ip

    # Auto-enrich with request context properties (user-agent, URL, referrer, session ID)
    # Skip for Stripe webhooks — their UA/IP/referrer are Stripe's, not the user's
    try:
        from flask import has_request_context, request
        if has_request_context() and not request.path.startswith('/api/webhooks/'):
            ua = request.headers.get('User-Agent', '')
            if ua:
                props['$raw_user_agent'] = ua
            props['$current_url'] = request.url
            if request.referrer:
                props['$referrer'] = request.referrer
            # Forward PostHog session ID from frontend JS SDK so backend events
            # appear in the same session recording timeline
            session_id = request.headers.get('X-PostHog-Session-Id')
            if session_id:
                props['$session_id'] = session_id
    except Exception:
        pass

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


def call_posthog_endpoint(endpoint_name: str, variables: Dict[str, Any]) -> Optional[list]:
    """
    Call a PostHog SQL Endpoint and return results as a list of dicts.

    PostHog Endpoints are pre-defined SQL queries with variables, executed via
    the PostHog API. Each returns columnar data that we reshape into rows.

    Args:
        endpoint_name: The endpoint slug (e.g. 'user_practice_summary')
        variables: Dict of variable names/values to pass to the endpoint

    Returns:
        List of dicts (one per result row), or None on any failure.
        For a single-row endpoint, returns a list with one dict.
    """
    import requests

    api_key = os.getenv('POSTHOG_PERSONAL_API_KEY')
    project_id = os.getenv('POSTHOG_PROJECT_ID')

    if not api_key or not project_id:
        logger.error("PostHog Endpoints not configured: missing POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID")
        return None

    url = f"https://us.posthog.com/api/projects/{project_id}/endpoints/{endpoint_name}/run/"

    try:
        resp = requests.post(
            url,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={'variables': variables, 'refresh': 'cache'},
            timeout=10,
        )
        resp.raise_for_status()

        data = resp.json()
        columns = data.get('columns', [])
        results = data.get('results', [])

        # Reshape array-of-arrays into list of dicts
        return [dict(zip(columns, row)) for row in results]

    except requests.exceptions.Timeout:
        logger.warning(f"PostHog Endpoint '{endpoint_name}' timed out")
        return None
    except requests.exceptions.ConnectionError:
        logger.warning(f"PostHog Endpoint '{endpoint_name}' connection failed")
        return None
    except requests.exceptions.HTTPError as e:
        logger.error(f"PostHog Endpoint '{endpoint_name}' HTTP error: {e.response.status_code} - {e.response.text[:200]}")
        return None
    except Exception as e:
        logger.error(f"PostHog Endpoint '{endpoint_name}' unexpected error: {str(e)}")
        return None


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
