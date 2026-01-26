"""
Email templates for account deletion flow.

These templates follow the friendly PostHog-inspired tone
and are sent via Mailgun for various deletion events.
"""

import os
import requests
from typing import Dict, Any


def send_mailgun_email(to_email: str, subject: str, html_body: str) -> bool:
    """
    Send an email via Mailgun API.

    Args:
        to_email: Recipient email address
        subject: Email subject line
        html_body: HTML email body

    Returns:
        True if successful, False otherwise
    """
    mailgun_api_key = os.getenv('MAILGUN_API_KEY')
    mailgun_domain = os.getenv('MAILGUN_DOMAIN')

    if not mailgun_api_key or not mailgun_domain:
        print("Error: Mailgun credentials not configured")
        return False

    try:
        response = requests.post(
            f"https://api.mailgun.net/v3/{mailgun_domain}/messages",
            auth=("api", mailgun_api_key),
            data={
                "from": f"GPRA <noreply@{mailgun_domain}>",
                "to": to_email,
                "subject": subject,
                "html": html_body
            }
        )

        return response.status_code == 200
    except Exception as e:
        print(f"Error sending email: {e}")
        return False


def scheduled_deletion_confirmation_email(
    to_email: str,
    username: str,
    deletion_date: str,
    refund_amount: float
) -> bool:
    """
    Send confirmation email for scheduled account deletion.

    Args:
        to_email: User's email address
        username: User's username
        deletion_date: Formatted deletion date (e.g., "December 15, 2025")
        refund_amount: Prorated refund amount
    """
    subject = f"Your GPRA account will be deleted on {deletion_date}"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #ea580c; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
            .button {{ display: inline-block; padding: 12px 24px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 5px; }}
            .warning {{ background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Account Deletion Scheduled</h1>
            </div>
            <div class="content">
                <p>Hi {username},</p>

                <p>We've received your request to delete your GPRA account. Here's what you need to know:</p>

                <div class="warning">
                    <strong>Deletion Date:</strong> {deletion_date}<br>
                    <strong>Refund Amount:</strong> ${refund_amount:.2f}
                </div>

                <h3>What happens now:</h3>
                <ul>
                    <li>Your subscription has been canceled</li>
                    <li>You'll receive a prorated refund of <strong>${refund_amount:.2f}</strong></li>
                    <li>Your account will stay active until <strong>{deletion_date}</strong></li>
                    <li>You can continue using GPRA until that date</li>
                    <li>On {deletion_date}, all your data will be permanently deleted</li>
                </ul>

                <h3>Changed your mind?</h3>
                <p>You can cancel this deletion anytime before {deletion_date} from your Account Settings.</p>

                <p style="text-align: center; margin-top: 30px;">
                    <a href="https://guitarpracticeroutine.com/" class="button">Go to Account Settings</a>
                </p>

                <p style="margin-top: 30px; font-size: 14px; color: #666;">
                    <strong>P.S.</strong> Your refund will appear in your account within 5-10 business days.
                </p>
            </div>
            <div class="footer">
                <p>Guitar Practice Routine App</p>
            </div>
        </div>
    </body>
    </html>
    """

    return send_mailgun_email(to_email, subject, html_body)


def immediate_deletion_farewell_email(
    to_email: str,
    username: str
) -> bool:
    """
    Send farewell email after immediate account deletion.

    Args:
        to_email: User's email address
        username: User's username
    """
    subject = "Your GPRA account has been deleted"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #991b1b; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
            .info {{ background-color: #dbeafe; border-left: 4px solid: #3b82f6; padding: 15px; margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Account Deleted</h1>
            </div>
            <div class="content">
                <p>Hi {username},</p>

                <p>Your GPRA account has been permanently deleted, as requested.</p>

                <h3>What was removed:</h3>
                <ul>
                    <li>All practice items and routines</li>
                    <li>All chord charts</li>
                    <li>Practice history</li>
                    <li>Account settings and preferences</li>
                </ul>

                <div class="info">
                    <strong>Important:</strong> This action is permanent and cannot be undone. All your data has been permanently erased.
                </div>

                <p>We're sorry to see you go! If you ever decide to come back, you'll need to create a new account from scratch.</p>

                <p style="margin-top: 30px;">
                    Thanks for practicing with GPRA. Keep playing that guitar! 🎸
                </p>
            </div>
            <div class="footer">
                <p>Guitar Practice Routine App</p>
            </div>
        </div>
    </body>
    </html>
    """

    return send_mailgun_email(to_email, subject, html_body)


def deletion_canceled_email(
    to_email: str,
    username: str
) -> bool:
    """
    Send welcome back email when deletion is canceled.

    Args:
        to_email: User's email address
        username: User's username
    """
    subject = "Welcome back to GPRA! 🎉"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #16a34a; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
            .button {{ display: inline-block; padding: 12px 24px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 5px; }}
            .success {{ background-color: #dcfce7; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎉 Welcome Back! 🎉</h1>
            </div>
            <div class="content">
                <p>Hi {username},</p>

                <p>Great news! You've successfully canceled your account deletion.</p>

                <div class="success">
                    <strong>Your account is safe!</strong><br>
                    Your subscription is active again and all your data is secure.
                </div>

                <h3>What this means:</h3>
                <ul>
                    <li>Your subscription has been reactivated</li>
                    <li>All your practice items and routines are still here</li>
                    <li>All your chord charts are preserved</li>
                    <li>Your account will NOT be deleted</li>
                </ul>

                <p>We're glad you're staying with GPRA! Let's keep those practice sessions going. 🎸</p>

                <p style="text-align: center; margin-top: 30px;">
                    <a href="https://guitarpracticeroutine.com/" class="button">Continue Practicing</a>
                </p>
            </div>
            <div class="footer">
                <p>Guitar Practice Routine App</p>
            </div>
        </div>
    </body>
    </html>
    """

    return send_mailgun_email(to_email, subject, html_body)


def inactivity_notification_email(
    to_email: str,
    username: str,
    unsubscribe_token: str
) -> bool:
    """
    Send 90-day inactivity notification to paying subscribers.

    Args:
        to_email: User's email address
        username: User's username
        unsubscribe_token: JWT token for one-click unsubscribe
    """
    subject = "You're paying for GPRA but you're not using it"

    # Build unsubscribe URL
    unsubscribe_url = f"https://guitarpracticeroutine.com/api/unsubscribe/inactivity/{unsubscribe_token}"
    account_settings_url = "https://guitarpracticeroutine.com/#Account"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #ea580c; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
            .button {{ display: inline-block; padding: 12px 24px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 5px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Did you know you're still paying me monthly?</h1>
            </div>
            <div class="content">
                <p>Hey{' ' + username if username else ''},</p>

                <p>This is an automated email. It's sent if you haven't used GPRA in over 90 days, but you're still subscribed and paying for it.</p>

                <p>I'm guessing you forgot about it, so, <a href="{account_settings_url}">click here to log in and pause or cancel your subscription</a>. Scroll to the bottom, and expand the "Danger zone" at the bottom of the left column for pause and cancel options. (If that link doesn't take you to the Account / Settings page, then click the gear icon in the top right corner of the page.)</p>

                <p>Or, if you want to keep paying without using it, perhaps as a way of encouraging yourself to get back to practicing regularly, then: Thanks, that's really generous of you, and I really appreciate it!</p>

                <p style="margin-top: 30px;">
                    Rock on <span style="font-size: 1.2em;">&#129304;</span>,<br>
                    ~Steven<br>
                    Guitar Practice Routine App
                </p>
            </div>
            <div class="footer">
                <p>Guitar Practice Routine App</p>
                <p style="margin-top: 20px; font-size: 11px;">
                    <a href="{unsubscribe_url}" style="color: #666;">Stop receiving these inactivity reminder emails</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    """

    return send_mailgun_email(to_email, subject, html_body)


def final_deletion_scheduled_email(
    to_email: str,
    username: str,
    deletion_date: str,
    refund_amount: float
) -> bool:
    """
    Send final deletion email when scheduled deletion is processed.

    Args:
        to_email: User's email address
        username: User's username
        deletion_date: Formatted deletion date
        refund_amount: Refund amount processed
    """
    subject = "Your GPRA account has been deleted"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #991b1b; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
            .info {{ background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Account Deleted as Scheduled</h1>
            </div>
            <div class="content">
                <p>Hi {username},</p>

                <p>As scheduled, your GPRA account has been permanently deleted on {deletion_date}.</p>

                <h3>What was removed:</h3>
                <ul>
                    <li>All practice items and routines</li>
                    <li>All chord charts</li>
                    <li>Practice history</li>
                    <li>Account settings and preferences</li>
                </ul>

                <h3>Your refund:</h3>
                <div class="info">
                    <strong>Refund Amount:</strong> ${refund_amount:.2f}<br>
                    <strong>Processing Time:</strong> 5-10 business days<br>
                    <br>
                    Your refund will appear in the original payment method.
                </div>

                <p>Thanks for using GPRA! We hope it helped you with your guitar practice journey. Keep playing and keep improving! 🎸</p>

                <p style="margin-top: 30px; font-size: 14px; color: #666;">
                    If you ever decide to come back, you're always welcome to create a new account.
                </p>
            </div>
            <div class="footer">
                <p>Guitar Practice Routine App</p>
            </div>
        </div>
    </body>
    </html>
    """

    return send_mailgun_email(to_email, subject, html_body)
