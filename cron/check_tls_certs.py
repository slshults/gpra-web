#!/usr/bin/env python3
"""
TLS Certificate Expiry Check Cron Job

Connects to each public hostname this server holds a Let's Encrypt cert for,
reads the certificate it actually serves, and sends a `tls_cert_checked`
event to PostHog with the days left before it expires. A PostHog insight
alert fires when the lowest value drops below the renewal window, and posts
to Slack.

Why this exists: when certbot renewal fails it fails quietly, and Let's
Encrypt no longer sends expiry emails. In November 2026 two lapsed domains
left on multi-domain certs blocked renewal for a month, and the site went down
when the cert expired.

Checking the served cert over the network (not the files on disk) also
catches a renewed cert that nginx never reloaded.

Events go to two PostHog projects, each with its own insight and alert:
- GPRA (GPRA_DOMAINS): https://us.posthog.com/project/217116/insights/pRFHoFze,
  alert posts to Slack #gpra.
- Shakespeare's Monologues (SHAKESMONOS_DOMAINS): its MCP server is served
  from this box, so its cert renews here too, but its events go to its own
  project: https://us.posthog.com/project/55178/insights/oAQbyWlT, alert posts
  to Slack #shakesmonos. Needs SHAKESMONOS_POSTHOG_API_KEY in .env (that
  project's public ingest key).

The alerts' 25-day bound lives in PostHog, not here. It assumes prod's apt
certbot (1.21), which renews at a fixed 30 days before expiry. Certbot 4.0 and
later renews when a third of the lifetime is left instead, which falls below
25 days once Let's Encrypt shortens its default lifetime (64 days from
February 2027). Ubuntu 26.04's apt package is certbot 4.0, so a server release
upgrade counts as a certbot upgrade: lower both bounds when that happens.

Example crontab entry (runs daily at 12:00 UTC):
0 12 * * * /path/to/venv/bin/python3 /path/to/gprweb/cron/check_tls_certs.py >> /path/to/gprweb/logs/tls_cert_check.log 2>&1
"""

import logging
import os
import socket
import ssl
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from posthog import Posthog

from app.utils.posthog_client import track_event, shutdown as posthog_shutdown

# Every hostname on a cert this server's certbot manages, split by the PostHog
# project its events go to. Update these when a domain is added to or dropped
# from a cert. tacet.guitarpracticeroutine.com is left out on purpose: it's
# PostHog's managed proxy, so the cert isn't ours.
GPRA_DOMAINS = [
    'guitarpracticeroutine.com',
    'www.guitarpracticeroutine.com',
    'gpra.app',
    'www.gpra.app',
    'guitarpracticeroutineapp.com',
    'www.guitarpracticeroutineapp.com',
    'guitarpracticeroutine.app',
    'www.guitarpracticeroutine.app',
    'mcp.guitarpracticeroutine.com',
]
SHAKESMONOS_DOMAINS = [
    'mcp.shakespeare-monologues.org',
]

EVENT_NAME = 'tls_cert_checked'
DISTINCT_ID = 'cert-monitor-bot'
CONNECT_TIMEOUT_SECONDS = 10

log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

# Own named logger with a FileHandler only, matching the other cron scripts:
# something in the `import app` chain configures the root logger first, so
# basicConfig would be a no-op.
logger = logging.getLogger('tls_cert_cron')
logger.setLevel(logging.INFO)
logger.propagate = False
_file_handler = logging.FileHandler(log_dir / 'tls_cert_check.log')
_file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger.addHandler(_file_handler)


def _cert_expiry(domain: str) -> float:
    """Return the served cert's notAfter as a Unix timestamp.

    Uses a verifying handshake, so an expired cert, a hostname mismatch, or a
    broken chain raises instead of returning.
    """
    context = ssl.create_default_context()
    with socket.create_connection((domain, 443), timeout=CONNECT_TIMEOUT_SECONDS) as sock:
        with context.wrap_socket(sock, server_hostname=domain) as tls:
            return ssl.cert_time_to_seconds(tls.getpeercert()['notAfter'])


def check_domain(domain: str, send) -> bool:
    """Check one domain and pass its result to `send`. Returns True if healthy."""
    try:
        not_after = _cert_expiry(domain)
    except Exception as e:
        # The alert watches a single number (the lowest days_remaining), so any
        # failure to get a valid cert reports 0 to trip it. `error` says why.
        error = f"{type(e).__name__}: {e}"
        # Network and TLS failures are OSErrors and routine. Anything else is
        # more likely a bug in this script, so log its traceback.
        logger.error(f"{domain}: TLS check failed: {error}", exc_info=not isinstance(e, OSError))
        send({'domain': domain, 'days_remaining': 0, 'error': error})
        return False

    days_remaining = round((not_after - time.time()) / 86400, 1)
    expires_at = datetime.fromtimestamp(not_after, tz=timezone.utc).isoformat()
    logger.info(f"{domain}: {days_remaining} days remaining (expires {expires_at})")
    send({'domain': domain, 'days_remaining': days_remaining, 'expires_at': expires_at})
    return True


def _send_to_gpra(properties: dict) -> None:
    track_event(user_id=None, event_name=EVENT_NAME, properties=properties, distinct_id=DISTINCT_ID)


if __name__ == '__main__':
    results = [check_domain(domain, _send_to_gpra) for domain in GPRA_DOMAINS]

    shakesmonos_key = os.getenv('SHAKESMONOS_POSTHOG_API_KEY')
    if shakesmonos_key:
        shakesmonos = Posthog(project_api_key=shakesmonos_key, host='https://us.i.posthog.com')

        def send_to_shakesmonos(properties: dict) -> None:
            shakesmonos.capture(distinct_id=DISTINCT_ID, event=EVENT_NAME, properties=properties)

        results += [check_domain(domain, send_to_shakesmonos) for domain in SHAKESMONOS_DOMAINS]
        shakesmonos.shutdown()
    else:
        # No events reach that project, so its alert fires daily until the key is set.
        logger.error("SHAKESMONOS_POSTHOG_API_KEY isn't set, so ShakesMonos domains weren't checked")
        results.append(False)

    posthog_shutdown()
    # Cron mails on output, not exit status, so PostHog is the alert path.
    sys.exit(0 if all(results) else 1)
