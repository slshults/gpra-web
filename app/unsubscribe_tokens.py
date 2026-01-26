"""
Unsubscribe token generation and validation for inactivity emails.

Uses itsdangerous for cryptographically signed tokens that allow users
to unsubscribe without logging in.
"""
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from flask import current_app
import logging

logger = logging.getLogger(__name__)

# Token expiry: 30 days (2592000 seconds) - generous window for email links
DEFAULT_TOKEN_EXPIRY = 30 * 24 * 60 * 60


def generate_unsubscribe_token(user_id: int) -> str:
    """
    Generate a signed token for unsubscribing from inactivity emails.

    Args:
        user_id: The user's database ID

    Returns:
        A cryptographically signed URL-safe token string

    Example:
        >>> token = generate_unsubscribe_token(42)
        >>> # Token can be used in: /unsubscribe/inactivity/{token}
    """
    serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])

    payload = {
        'user_id': user_id,
        'type': 'inactivity_unsubscribe'
    }

    token = serializer.dumps(payload, salt='inactivity-unsubscribe-salt')
    logger.info(f"Generated inactivity unsubscribe token for user_id={user_id}")

    return token


def validate_unsubscribe_token(token: str, max_age: int = None) -> dict:
    """
    Validate and decode an unsubscribe token.

    Args:
        token: The token string to validate
        max_age: Maximum age in seconds (default: 30 days)

    Returns:
        Dictionary with 'user_id' and 'type' if valid

    Raises:
        SignatureExpired: Token is too old
        BadSignature: Token has been tampered with or is invalid

    Example:
        >>> try:
        ...     data = validate_unsubscribe_token(token)
        ...     user_id = data['user_id']
        ... except SignatureExpired:
        ...     print("Token expired")
        ... except BadSignature:
        ...     print("Invalid token")
    """
    serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])

    if max_age is None:
        max_age = DEFAULT_TOKEN_EXPIRY

    try:
        payload = serializer.loads(
            token,
            salt='inactivity-unsubscribe-salt',
            max_age=max_age
        )

        # Verify this is the correct token type
        if payload.get('type') != 'inactivity_unsubscribe':
            logger.warning(f"Invalid token type: {payload.get('type')}")
            raise BadSignature("Invalid token type")

        logger.info(f"Validated inactivity unsubscribe token for user_id={payload['user_id']}")
        return payload

    except SignatureExpired:
        logger.warning(f"Inactivity unsubscribe token expired: {token[:20]}...")
        raise

    except BadSignature:
        logger.warning(f"Invalid inactivity unsubscribe token: {token[:20]}...")
        raise
