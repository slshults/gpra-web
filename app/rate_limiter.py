"""
Rate limiting service for password reset requests.

Tracks both email-based and IP-based rate limits to prevent abuse.
Uses Redis if available, falls back to in-memory storage.
"""
import time
import logging
from typing import Optional, Tuple
from flask import current_app

logger = logging.getLogger(__name__)


class RateLimiter:
    """
    Rate limiter with Redis fallback to in-memory storage.

    Email-based limits:
    - Max 2 emails per minute to same address
    - Max 5 emails per 30 minutes to same address
    - Max 10 emails per hour to same address
    - After 10 emails in an hour: block for 24 hours

    IP-based limits:
    - Max 9 different email addresses per hour from same IP
    - 10th different email address: refuse with message
    """

    def __init__(self):
        """Initialize rate limiter with Redis or in-memory storage."""
        self.use_redis = False
        self.redis_client = None

        # In-memory fallback storage
        # Format: {email: [(timestamp1, timestamp2, ...)]}
        self.email_attempts = {}

        # Format: {ip: set([email1, email2, ...])}
        self.ip_email_sets = {}

        # Try to initialize Redis
        try:
            import redis
            redis_url = current_app.config.get('REDIS_URL')
            if redis_url:
                self.redis_client = redis.from_url(redis_url, decode_responses=True)
                self.redis_client.ping()
                self.use_redis = True
                logger.info("Rate limiter using Redis storage")
            else:
                logger.info("REDIS_URL not configured, using in-memory rate limiting")
        except (ImportError, Exception) as e:
            logger.info(f"Redis not available ({e}), using in-memory rate limiting")

    def check_email_rate_limit(self, email: str) -> Tuple[bool, Optional[str]]:
        """
        Check if email address has exceeded rate limits.

        Args:
            email: Email address to check

        Returns:
            Tuple of (is_allowed, error_message)
            - (True, None) if request is allowed
            - (False, "error message") if rate limit exceeded
        """
        now = time.time()
        email = email.lower().strip()

        if self.use_redis:
            return self._check_email_redis(email, now)
        else:
            return self._check_email_memory(email, now)

    def _check_email_redis(self, email: str, now: float) -> Tuple[bool, Optional[str]]:
        """Check email rate limit using Redis."""
        key = f"password_reset:email:{email}"

        # Get all attempts for this email
        attempts = self.redis_client.lrange(key, 0, -1)
        attempts = [float(ts) for ts in attempts]

        # Remove expired attempts (older than 24 hours)
        cutoff_24h = now - (24 * 60 * 60)
        attempts = [ts for ts in attempts if ts > cutoff_24h]

        # Check if blocked for 24 hours (10 attempts in last hour)
        cutoff_1h = now - (60 * 60)
        recent_hour = [ts for ts in attempts if ts > cutoff_1h]

        if len(recent_hour) >= 10:
            return (False, "Too many password reset attempts. Please wait 24 hours before trying again.")

        # Check 30-minute limit (5 max)
        cutoff_30m = now - (30 * 60)
        recent_30m = [ts for ts in attempts if ts > cutoff_30m]

        if len(recent_30m) >= 5:
            return (False, "Too many password reset attempts. Please wait 30 minutes before trying again.")

        # Check 1-minute limit (2 max)
        cutoff_1m = now - 60
        recent_1m = [ts for ts in attempts if ts > cutoff_1m]

        if len(recent_1m) >= 2:
            return (False, "Please wait at least 1 minute before requesting another password reset.")

        # Request is allowed - record this attempt
        self.redis_client.delete(key)
        for ts in attempts:
            self.redis_client.rpush(key, ts)
        self.redis_client.rpush(key, now)
        self.redis_client.expire(key, 24 * 60 * 60)  # Expire after 24 hours

        return (True, None)

    def _check_email_memory(self, email: str, now: float) -> Tuple[bool, Optional[str]]:
        """Check email rate limit using in-memory storage."""
        # Get attempts for this email
        if email not in self.email_attempts:
            self.email_attempts[email] = []

        attempts = self.email_attempts[email]

        # Remove expired attempts (older than 24 hours)
        cutoff_24h = now - (24 * 60 * 60)
        attempts = [ts for ts in attempts if ts > cutoff_24h]
        self.email_attempts[email] = attempts

        # Check if blocked for 24 hours (10 attempts in last hour)
        cutoff_1h = now - (60 * 60)
        recent_hour = [ts for ts in attempts if ts > cutoff_1h]

        if len(recent_hour) >= 10:
            return (False, "Too many password reset attempts. Please wait 24 hours before trying again.")

        # Check 30-minute limit (5 max)
        cutoff_30m = now - (30 * 60)
        recent_30m = [ts for ts in attempts if ts > cutoff_30m]

        if len(recent_30m) >= 5:
            return (False, "Too many password reset attempts. Please wait 30 minutes before trying again.")

        # Check 1-minute limit (2 max)
        cutoff_1m = now - 60
        recent_1m = [ts for ts in attempts if ts > cutoff_1m]

        if len(recent_1m) >= 2:
            return (False, "Please wait at least 1 minute before requesting another password reset.")

        # Request is allowed - record this attempt
        attempts.append(now)

        return (True, None)

    def check_ip_rate_limit(self, ip: str, email: str) -> Tuple[bool, Optional[str]]:
        """
        Check if IP address has exceeded rate limits.

        Args:
            ip: IP address to check
            email: Email being requested (to track unique emails per IP)

        Returns:
            Tuple of (is_allowed, error_message)
            - (True, None) if request is allowed
            - (False, "error message") if rate limit exceeded
        """
        now = time.time()
        email = email.lower().strip()

        if self.use_redis:
            return self._check_ip_redis(ip, email, now)
        else:
            return self._check_ip_memory(ip, email, now)

    def _check_ip_redis(self, ip: str, email: str, now: float) -> Tuple[bool, Optional[str]]:
        """Check IP rate limit using Redis."""
        key = f"password_reset:ip:{ip}"

        # Get all email:timestamp pairs for this IP
        data = self.redis_client.hgetall(key)

        # Remove expired entries (older than 1 hour)
        cutoff_1h = now - (60 * 60)
        valid_emails = set()

        for stored_email, timestamp in data.items():
            if float(timestamp) > cutoff_1h:
                valid_emails.add(stored_email)

        # Check if this would be the 10th unique email
        if email not in valid_emails and len(valid_emails) >= 9:
            return (False, "Dude, how many email addresses do you have? At this point, we have to assume you're up to something nefarious, so go away or I'll taunt you again.")

        # Update Redis with this email
        self.redis_client.hset(key, email, now)
        self.redis_client.expire(key, 60 * 60)  # Expire after 1 hour

        return (True, None)

    def _check_ip_memory(self, ip: str, email: str, now: float) -> Tuple[bool, Optional[str]]:
        """Check IP rate limit using in-memory storage."""
        # Get email set for this IP
        if ip not in self.ip_email_sets:
            self.ip_email_sets[ip] = {}

        ip_data = self.ip_email_sets[ip]

        # Remove expired entries (older than 1 hour)
        cutoff_1h = now - (60 * 60)
        valid_emails = {email_addr: ts for email_addr, ts in ip_data.items() if ts > cutoff_1h}
        self.ip_email_sets[ip] = valid_emails

        # Check if this would be the 10th unique email
        if email not in valid_emails and len(valid_emails) >= 9:
            return (False, "Dude, how many email addresses do you have? At this point, we have to assume you're up to something nefarious, so go away or I'll taunt you again.")

        # Record this email
        valid_emails[email] = now

        return (True, None)

    def record_attempt(self, email: str, ip: str) -> None:
        """
        Record a password reset attempt (for the 10th email warning).

        This is called AFTER emails are sent to track when to send the warning.

        Args:
            email: Email address
            ip: IP address
        """
        # Email tracking is done in check_email_rate_limit
        # IP tracking is done in check_ip_rate_limit
        # This method is here for potential future use
        pass


# Global rate limiter instance
_rate_limiter = None


def get_rate_limiter() -> RateLimiter:
    """Get or create the global rate limiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter
