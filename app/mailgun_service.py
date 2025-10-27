"""
Mailgun email service integration using REST API v3.

Sends transactional emails for password resets, notifications, etc.
"""
import requests
import logging
from flask import current_app

logger = logging.getLogger(__name__)


class MailgunService:
    """
    Mailgun REST API integration for sending emails.

    Uses Mailgun API v3 for reliable email delivery with proper error handling.
    """

    def __init__(self, api_key: str = None, domain: str = None, api_url: str = None):
        """
        Initialize Mailgun service with credentials.

        Args:
            api_key: Mailgun API key (defaults to app config)
            domain: Mailgun domain (defaults to app config)
            api_url: Mailgun API base URL (defaults to app config)
        """
        self.api_key = api_key or current_app.config.get('MAILGUN_API_KEY')
        self.domain = domain or current_app.config.get('MAILGUN_DOMAIN')
        self.api_url = api_url or current_app.config.get('MAILGUN_API_URL', 'https://api.mailgun.net/v3')

        if not self.api_key:
            logger.error("MAILGUN_API_KEY not configured")
            raise ValueError("MAILGUN_API_KEY is required")

        if not self.domain:
            logger.error("MAILGUN_DOMAIN not configured")
            raise ValueError("MAILGUN_DOMAIN is required")

    def send_password_reset_email(self, recipient_email: str, reset_token: str) -> bool:
        """
        Send password reset email with reset link.

        Args:
            recipient_email: Email address to send reset link to
            reset_token: Password reset token for the URL

        Returns:
            True if email sent successfully, False otherwise

        Example:
            >>> mailgun = MailgunService()
            >>> success = mailgun.send_password_reset_email("user@example.com", "abc123token")
        """
        # Build password reset URL
        # In production, this will be the actual domain (e.g., https://guitarpraccticeroutine.app)
        # In development, it will be http://localhost:5000
        from flask import request
        if current_app.config.get('PREFERRED_URL_SCHEME') == 'https':
            # Production - use request host
            base_url = f"https://{request.host}"
        else:
            # Development
            base_url = "http://localhost:5000"

        reset_url = f"{base_url}/reset-password?token={reset_token}"

        # Email subject
        subject = "Password Reset Request - Guitar Practice Routine App"

        # HTML email template with inline CSS for email client compatibility
        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #f3f4f6; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #111827;">
    <div style="background: #1f2937; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; border-bottom: 3px solid #ea580c;">
        <h1 style="color: #ea580c; margin: 0; font-size: 24px;">Guitar Practice Routine App 🎸</h1>
    </div>

    <div style="background: #1f2937; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #374151;">
        <h2 style="color: #f3f4f6; margin-top: 0;">Password Reset Request</h2>

        <p style="color: #d1d5db; font-size: 16px;">
            Lost your password, huh? Have you checked inside your favorite acoustic? Maybe it's in there with the picks.
        </p>

        <p style="color: #d1d5db; font-size: 16px;">
            Seriously though, we received a request to reset your password. Click the button below to create a new password:
        </p>

        <div style="text-align: center; margin: 30px 0;">
            <a href="{reset_url}" style="background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                Reset Password
            </a>
        </div>

        <p style="color: #9ca3af; font-size: 14px; margin-top: 30px;">
            If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="color: #ea580c; font-size: 14px; word-break: break-all;">
            {reset_url}
        </p>

        <div style="background: #451a03; border-left: 4px solid #ea580c; padding: 15px; margin-top: 30px; border-radius: 4px;">
            <p style="color: #fdba74; margin: 0; font-size: 14px;">
                <strong>Security Notice:</strong> This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email (please don't mark this as spam. if someone is using our form to annoy you, we'll cut them off after 10 attempts.)
            </p>
        </div>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #374151; color: #6b7280; font-size: 12px; text-align: center;">
            <p>Guitar Practice Routine App</p>
            <p>This is an automated message, replies will go into the cold void of cyberspace.</p>
        </div>
    </div>
</body>
</html>
"""

        # Plain text version for email clients that don't support HTML
        text_body = f"""
Password Reset Request - GPRA 🎸

Lost your password, huh? Have you checked inside your favorite acoustic? Maybe it's in there with the picks.

Seriously though, we received a request to reset your password.

To reset your password, visit this link:
{reset_url}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.

---
Guitar Practice Routine App
This is an automated message, replies will go into the cold void of cyberspace.
"""

        # Mailgun API endpoint
        endpoint = f"{self.api_url}/{self.domain}/messages"

        # Email data
        data = {
            'from': f"GPRA <{current_app.config.get('MAILGUN_FROM_EMAIL')}>",
            'to': recipient_email,
            'subject': subject,
            'text': text_body,
            'html': html_body
        }

        try:
            # Send via Mailgun REST API
            response = requests.post(
                endpoint,
                auth=('api', self.api_key),
                data=data,
                timeout=10
            )

            # Check response
            if response.status_code == 200:
                logger.info(f"Password reset email sent successfully to {recipient_email}")
                logger.debug(f"Mailgun response: {response.json()}")
                return True
            else:
                logger.error(f"Failed to send password reset email. Status: {response.status_code}, Response: {response.text}")
                return False

        except requests.exceptions.RequestException as e:
            logger.error(f"Error sending password reset email to {recipient_email}: {e}")
            return False


def send_password_reset_email(recipient_email: str, reset_token: str) -> bool:
    """
    Convenience function to send password reset email.

    Args:
        recipient_email: Email address to send reset link to
        reset_token: Password reset token for the URL

    Returns:
        True if email sent successfully, False otherwise

    Example:
        >>> from app.mailgun_service import send_password_reset_email
        >>> success = send_password_reset_email("user@example.com", "abc123token")
    """
    mailgun = MailgunService()
    return mailgun.send_password_reset_email(recipient_email, reset_token)
