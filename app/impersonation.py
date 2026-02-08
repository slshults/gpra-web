"""
Admin impersonation token generation and validation.

Uses itsdangerous for short-lived, cryptographically signed tokens that allow
admin users to impersonate other users for debugging and support purposes.
"""
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from flask import current_app
import logging

logger = logging.getLogger(__name__)

# Token expiry: 60 seconds - short-lived for security
DEFAULT_TOKEN_EXPIRY = 60


def generate_impersonation_token(admin_user_id: int, target_user_id: int) -> str:
    """
    Generate a signed token for admin impersonation.

    Args:
        admin_user_id: The admin user's database ID
        target_user_id: The target user's database ID to impersonate

    Returns:
        A cryptographically signed URL-safe token string

    Example:
        >>> token = generate_impersonation_token(1, 42)
        >>> # Token can be used in: /admin/impersonate/activate/{token}
    """
    serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])

    payload = {
        'admin_user_id': admin_user_id,
        'target_user_id': target_user_id,
        'type': 'admin_impersonation'
    }

    token = serializer.dumps(payload, salt='admin-impersonation-salt')
    logger.info(f"Generated impersonation token: admin_user_id={admin_user_id} -> target_user_id={target_user_id}")

    return token


def validate_impersonation_token(token: str, max_age: int = None) -> dict:
    """
    Validate and decode an impersonation token.

    Args:
        token: The token string to validate
        max_age: Maximum age in seconds (default: 60 seconds)

    Returns:
        Dictionary with 'admin_user_id', 'target_user_id', and 'type' if valid

    Raises:
        SignatureExpired: Token is too old
        BadSignature: Token has been tampered with or is invalid

    Example:
        >>> try:
        ...     data = validate_impersonation_token(token)
        ...     admin_id = data['admin_user_id']
        ...     target_id = data['target_user_id']
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
            salt='admin-impersonation-salt',
            max_age=max_age
        )

        # Verify this is the correct token type
        if payload.get('type') != 'admin_impersonation':
            logger.warning(f"Invalid token type: {payload.get('type')}")
            raise BadSignature("Invalid token type")

        logger.info(f"Validated impersonation token: admin_user_id={payload['admin_user_id']} -> target_user_id={payload['target_user_id']}")
        return payload

    except SignatureExpired:
        logger.warning(f"Impersonation token expired: {token[:20]}...")
        raise

    except BadSignature:
        logger.warning(f"Invalid impersonation token: {token[:20]}...")
        raise
