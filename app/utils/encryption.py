"""
Encryption utilities for sensitive data like API keys.

Uses Fernet (symmetric encryption) from the cryptography library.
The encryption key is derived from SECRET_KEY in the environment.
"""
import os
import base64
import hashlib
from cryptography.fernet import Fernet
from typing import Optional
import logging

logger = logging.getLogger(__name__)


def _get_fernet_key() -> bytes:
    """
    Derive a Fernet-compatible key from SECRET_KEY.

    Fernet requires a 32-byte base64-encoded key.
    We use SHA256 to hash the SECRET_KEY and base64-encode it.

    Returns:
        bytes: Base64-encoded 32-byte key suitable for Fernet
    """
    secret = os.getenv('SECRET_KEY')
    if not secret:
        raise ValueError("SECRET_KEY not set in environment")

    # Hash the secret key to get exactly 32 bytes
    hashed = hashlib.sha256(secret.encode()).digest()

    # Base64 encode for Fernet compatibility
    return base64.urlsafe_b64encode(hashed)


def encrypt_api_key(api_key: str) -> bytes:
    """
    Encrypt an API key for secure storage.

    Args:
        api_key: Plain text API key

    Returns:
        bytes: Encrypted API key (can be stored in LargeBinary column)

    Raises:
        ValueError: If api_key is empty or SECRET_KEY not set
    """
    if not api_key:
        raise ValueError("API key cannot be empty")

    try:
        fernet = Fernet(_get_fernet_key())
        encrypted = fernet.encrypt(api_key.encode())
        logger.debug("API key encrypted successfully")
        return encrypted
    except Exception as e:
        logger.error(f"Failed to encrypt API key: {e}")
        raise


def decrypt_api_key(encrypted_key: bytes) -> Optional[str]:
    """
    Decrypt an API key for use.

    Args:
        encrypted_key: Encrypted API key from database

    Returns:
        str: Plain text API key, or None if decryption fails
    """
    if not encrypted_key:
        return None

    try:
        # Convert memoryview or other binary types to bytes
        if isinstance(encrypted_key, memoryview):
            encrypted_key = bytes(encrypted_key)
        elif not isinstance(encrypted_key, (bytes, str)):
            # Handle other types by converting to bytes
            encrypted_key = bytes(encrypted_key)

        fernet = Fernet(_get_fernet_key())
        decrypted = fernet.decrypt(encrypted_key)
        return decrypted.decode()
    except Exception as e:
        logger.error(f"Failed to decrypt API key: {e}")
        return None


def validate_anthropic_api_key(api_key: str) -> tuple[bool, str]:
    """
    Validate an Anthropic API key by making a test API call.

    Args:
        api_key: Plain text API key to validate

    Returns:
        tuple[bool, str]: (is_valid, error_message)
            - (True, "") if valid
            - (False, "error message") if invalid
    """
    if not api_key:
        return False, "API key is required"

    # Basic format validation
    if not api_key.startswith('sk-ant-'):
        return False, "Invalid API key format (must start with 'sk-ant-')"

    if len(api_key) < 40:
        return False, "API key is too short"

    # Test the key with a minimal API call
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

        # Make a minimal test call (very cheap, just validates auth)
        # Use the messages.count_tokens endpoint which doesn't consume credits
        try:
            # Try to list models - this requires valid auth but doesn't consume credits
            # Note: Anthropic doesn't have a models endpoint, so we'll do a minimal message instead
            response = client.messages.create(
                model="claude-3-haiku-20240307",  # Cheapest model
                max_tokens=1,  # Minimum tokens
                messages=[{"role": "user", "content": "test"}]
            )

            # If we got here, the key is valid
            logger.info("API key validation successful")
            return True, ""

        except anthropic.AuthenticationError as e:
            logger.warning(f"API key authentication failed: {e}")
            return False, "Invalid API key - authentication failed"
        except anthropic.PermissionDeniedError as e:
            logger.warning(f"API key permission denied: {e}")
            return False, "API key does not have required permissions"
        except anthropic.RateLimitError as e:
            # Rate limit means the key is valid, just throttled
            logger.info("API key valid but rate limited during validation")
            return True, ""
        except Exception as e:
            logger.error(f"Unexpected error validating API key: {e}")
            return False, f"Error validating API key: {str(e)}"

    except ImportError:
        logger.error("anthropic package not installed")
        return False, "Server configuration error (anthropic package missing)"
    except Exception as e:
        logger.error(f"Error during API key validation: {e}")
        return False, f"Error validating API key: {str(e)}"
