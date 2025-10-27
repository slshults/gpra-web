"""
Password reset token generation and validation.

Uses itsdangerous for time-limited, cryptographically signed tokens.
"""
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from flask import current_app
import logging

logger = logging.getLogger(__name__)


def generate_password_reset_token(user_id: int, email: str) -> str:
    """
    Generate a time-limited password reset token.

    Args:
        user_id: The user's database ID
        email: The user's email address

    Returns:
        A cryptographically signed token string

    Example:
        >>> token = generate_password_reset_token(42, "user@example.com")
        >>> # Token can be sent in email reset link
    """
    serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])

    # Encode user_id and email together for validation
    payload = {
        'user_id': user_id,
        'email': email
    }

    token = serializer.dumps(payload, salt='password-reset-salt')
    logger.info(f"Generated password reset token for user_id={user_id}, email={email}")

    return token


def validate_password_reset_token(token: str, max_age: int = None) -> dict:
    """
    Validate and decode a password reset token.

    Args:
        token: The token string to validate
        max_age: Maximum age in seconds (default: from app config PASSWORD_RESET_TOKEN_EXPIRY)

    Returns:
        Dictionary with 'user_id' and 'email' if valid

    Raises:
        SignatureExpired: Token is too old
        BadSignature: Token has been tampered with or is invalid

    Example:
        >>> try:
        ...     data = validate_password_reset_token(token)
        ...     print(f"Valid for user {data['user_id']}")
        ... except SignatureExpired:
        ...     print("Token expired")
        ... except BadSignature:
        ...     print("Invalid token")
    """
    serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])

    # Use configured expiry if max_age not specified
    if max_age is None:
        max_age = current_app.config.get('PASSWORD_RESET_TOKEN_EXPIRY', 3600)

    try:
        payload = serializer.loads(
            token,
            salt='password-reset-salt',
            max_age=max_age
        )

        logger.info(f"Validated password reset token for user_id={payload['user_id']}")
        return payload

    except SignatureExpired:
        logger.warning(f"Password reset token expired: {token[:20]}...")
        raise

    except BadSignature:
        logger.warning(f"Invalid password reset token signature: {token[:20]}...")
        raise
