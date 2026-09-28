"""
Escalating response to repeated /admin probing.

Every denied /admin request (anonymous, or logged in without the Admin role)
counts against the client IP in Redis for 24 hours from the first attempt.
The first four get the usual redirect, the fifth gets a warning
page, and the sixth gets a farewell page and bans the IP: every later
request, on any URL, gets the 403 page.

Ban length depends on what AbuseIPDB knows about the IP: 48 hours for
shared networks (mobile carriers, schools, libraries, businesses), where
innocent neighbours share the address; a year for addresses with a bad
reputation; 30 days otherwise, or when the lookup fails or the hourly
lookup budget is used up.

Bans live here in the app (a Redis key with a TTL) rather than in the
firewall, so a banned person still sees a page, and the 403 page's chat
widget gives a false positive a way to reach Steven.

The IP comes from request.remote_addr, which ProxyFix(x_for=1) sets from the
address nginx appends to X-Forwarded-For. Never use the leftmost XFF entry
here: the client controls it, and a forged one would let anyone get a third
party banned. IPv6 clients are bucketed by /64.

To lift a ban, clear the attempt counter too, or the next denied request
re-bans straight away:
    redis-cli DEL banhammer:banned:<ip or v6 /64> banhammer:admin:<ip or v6 /64>
"""

import ipaddress
import logging
import os
import re
import time

import redis
import requests
from flask import current_app, render_template, request

WARN_AT = 5
BAN_AT = 6
WINDOW_SECONDS = 24 * 60 * 60
DAY = 24 * 60 * 60
BAN_SECONDS = 30 * DAY
SHARED_BAN_SECONDS = 2 * DAY
BAD_REPUTATION_BAN_SECONDS = 365 * DAY
BAD_REPUTATION_SCORE = 75  # AbuseIPDB abuseConfidenceScore, 0-100
LOOKUPS_PER_HOUR = 40  # keeps IP rotation from burning the daily AbuseIPDB quota

# AbuseIPDB usageType values where many unrelated people share one address.
SHARED_USAGE_TYPES = {
    'Mobile ISP', 'University/College/School', 'Library',
    'Commercial', 'Organization', 'Government', 'Military',
}

log = logging.getLogger(__name__)


def _networks(values):
    nets = []
    for v in values:
        try:
            nets.append(ipaddress.ip_network(v, strict=False))
        except ValueError:
            # A typo in the env var must not take the site down (this module is
            # imported from a hook that runs on every request).
            log.warning(f'banhammer: ignoring invalid BANHAMMER_EXEMPT entry {v!r}')
    return nets


# Never banned: loopback, the server itself, PostHog's service IPs (US, then
# EU), Meta's ad/crawler ranges (banning Meta breaks ads), and any extra
# addresses in BANHAMMER_EXEMPT (comma- or space-separated IPs/CIDRs, set in
# the server's .env, not in the repo).
EXEMPT_NETWORKS = _networks((
    '127.0.0.0/8', '::1',
    '208.113.200.79',
    '44.205.89.55', '52.4.194.122', '44.208.188.173',
    '3.75.65.221', '18.197.246.42', '3.120.223.253',
    '31.13.24.0/21', '31.13.64.0/18', '66.220.144.0/20', '69.63.176.0/20',
    '69.171.224.0/19', '173.252.64.0/18', '157.240.0.0/16', '129.134.0.0/16',
    '2a03:2880::/32',
)) + _networks(os.getenv('BANHAMMER_EXEMPT', '').replace(',', ' ').split())

# Crawlers and link unfurlers follow links without Sec-Fetch headers, so a few
# planted links to /admin?1, /admin?2... could otherwise get Googlebot banned.
CRAWLER_UA = re.compile(
    r'Google(?:bot|Other|-InspectionTool|ImageProxy)|bingbot|DuckDuckBot|Applebot|'
    r'Slackbot|Discordbot|Twitterbot|TelegramBot|WhatsApp|facebookexternalhit|'
    r'LinkedInBot|Mastodon|Bluesky', re.IGNORECASE)

# delay=True opens the file on the first ban rather than at import (the
# import runs inside a hook on every request). Writing the line can still
# fail, so record_admin_denial guards it.
_ban_log_path = os.getenv('BANHAMMER_LOG', 'logs/banhammer.log')
try:
    os.makedirs(os.path.dirname(_ban_log_path) or '.', exist_ok=True)
except OSError:
    pass  # an import failure here would 500 every request; the guarded write below reports it instead
ban_log = logging.getLogger('gpra.banhammer')
ban_log.propagate = False
if not ban_log.handlers:
    _handler = logging.FileHandler(_ban_log_path, delay=True)
    _handler.setFormatter(logging.Formatter('%(asctime)s BAN %(message)s'))
    ban_log.addHandler(_handler)
    ban_log.setLevel(logging.INFO)


def _bucket(ip):
    """The unit we count and ban: the IPv4 address, or the IPv6 /64."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 6 and addr.ipv4_mapped:
        return str(addr.ipv4_mapped)
    if addr.version == 6:
        return str(ipaddress.ip_network(f'{addr}/64', strict=False))
    return ip


def _is_exempt(ip):
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return any(addr in net for net in EXEMPT_NETWORKS)


def _is_drive_by():
    """
    True when a modern browser fetched /admin on some other site's behalf,
    e.g. an <img src=".../admin"> planted on a forum. Those arrive without
    cookies, so counting them would let anyone get their page's visitors
    banned. Browsers too old to send Sec-Fetch headers (Safari < 16.4, from
    before March 2023) get no exception: they count like anything else.
    """
    h = request.headers
    if h.get('Sec-Fetch-Site') == 'cross-site':
        return True
    dest = h.get('Sec-Fetch-Dest')
    if dest and dest != 'document':
        return True
    return 'prefetch' in (h.get('Sec-Purpose', '') + h.get('Purpose', '')).lower()


def _ban_seconds(ip, redis_client):
    """Pick the ban length for ip from AbuseIPDB; (seconds, reason for the log)."""
    api_key = (os.getenv('ABUSEIPDB_API_KEY') or '').strip()
    if not api_key:
        return BAN_SECONDS, 'default (no AbuseIPDB key)'
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return BAN_SECONDS, 'default (unparseable ip)'
    if addr.version == 6 and addr.ipv4_mapped:
        ip = str(addr.ipv4_mapped)
    try:
        budget_key = f'banhammer:abuseipdb:{time.strftime("%Y%m%d%H")}'
        with redis_client.pipeline() as pipe:
            pipe.incr(budget_key)
            pipe.expire(budget_key, 3600)
            used = pipe.execute()[0]
    except redis.RedisError:
        used = 0
    if used > LOOKUPS_PER_HOUR:
        current_app.logger.warning('banhammer: AbuseIPDB hourly lookup budget used up')
        return BAN_SECONDS, 'default (lookup budget used up)'
    try:
        resp = requests.get(
            'https://api.abuseipdb.com/api/v2/check',
            params={'ipAddress': ip, 'maxAgeInDays': 90},
            headers={'Key': api_key, 'Accept': 'application/json'},
            timeout=(2, 2),
        )
        resp.raise_for_status()
        data = resp.json()['data']
        usage = str(data.get('usageType') or '')
        score = int(data.get('abuseConfidenceScore') or 0)
        is_tor = bool(data.get('isTor'))
    except Exception as e:  # external API: any failure means the default tier, never a 500
        current_app.logger.warning(f'banhammer: AbuseIPDB lookup failed for {ip}: {type(e).__name__}')
        return BAN_SECONDS, 'default (lookup failed)'
    # Shared wins over reputation: a carrier or campus IP collects reports
    # from everyone behind it, and a year-long ban would hit them all.
    if usage in SHARED_USAGE_TYPES:
        return SHARED_BAN_SECONDS, f'shared ({usage}, score {score})'
    if score >= BAD_REPUTATION_SCORE or is_tor:
        return BAD_REPUTATION_BAN_SECONDS, f'bad reputation ({usage or "unknown"}, score {score})'
    return BAN_SECONDS, f'default ({usage or "unknown"}, score {score})'


def banned_response(redis_client):
    """Return the 403 page if the current IP is banned, else None."""
    ip = request.remote_addr
    path = request.path
    if not ip or _is_exempt(ip) or path.startswith('/static/') or path in ('/favicon.ico', '/logout', '/logout/', '/privacy', '/terms'):
        return None
    try:
        banned = redis_client.exists(f'banhammer:banned:{_bucket(ip)}')
    except redis.RedisError as e:
        # Runs on every request, so no traceback: sessions share this Redis and will be logging already.
        current_app.logger.warning(f'banhammer: Redis unavailable, skipping ban check: {e}')
        return None
    if not banned:
        return None
    return render_template('403.html.jinja', posthog_key=os.getenv('POSTHOG_API_KEY', ''), banned=True), 403


def clear_admin_denials(redis_client):
    """An admin got through: forget this IP's denied attempts (e.g. from an expired session)."""
    ip = request.remote_addr
    if not ip:
        return
    try:
        redis_client.delete(f'banhammer:admin:{_bucket(ip)}')
    except redis.RedisError as e:
        current_app.logger.warning(f'banhammer: Redis unavailable, could not clear /admin attempts: {e}')


def record_admin_denial(redis_client):
    """
    Count a denied /admin request from the current IP.

    Returns a (body, status) response for the fifth and sixth attempts, or
    None to let the caller fall through to its normal redirect.
    """
    ip = request.remote_addr
    if not ip or _is_drive_by() or CRAWLER_UA.search(request.headers.get('User-Agent', '')):
        return None

    bucket = _bucket(ip)
    key = f'banhammer:admin:{bucket}'
    try:
        # One transaction: the first attempt creates the key with its 24h TTL
        # (a fixed window, so occasional visits over weeks never add up), and
        # a counter can never be left without a TTL.
        with redis_client.pipeline() as pipe:
            pipe.set(key, 0, ex=WINDOW_SECONDS, nx=True)
            pipe.incr(key)
            count = pipe.execute()[1]
    except redis.RedisError as e:
        # Fail open: a Redis outage must not turn every /admin redirect into a 500.
        current_app.logger.warning(f'banhammer: Redis unavailable, skipping /admin attempt count: {e}')
        return None

    posthog_key = os.getenv('POSTHOG_API_KEY', '')

    if count < WARN_AT:
        return None
    if count < BAN_AT:
        current_app.logger.warning(f'banhammer: warning page for {bucket} after {count} /admin attempts')
        return render_template('backstage_warning.html.jinja', posthog_key=posthog_key, posthog_cookieless_only=True), 403

    # Exempt IPs see the farewell page once (useful for testing) but are never
    # banned; after that they get the normal login redirect again.
    if _is_exempt(ip):
        if count > BAN_AT:
            return None
        current_app.logger.warning(f'banhammer: {ip} hit the ban limit but is exempt')
    else:
        ban_key = f'banhammer:banned:{bucket}'
        try:
            # Provisional 30-day ban first: parallel requests are blocked at
            # once, and only the request that set it does the lookup.
            first = redis_client.set(ban_key, 1, ex=BAN_SECONDS, nx=True)
            if not first:
                return render_template('banned.html.jinja', posthog_key=posthog_key), 403
            ban_seconds, reason = _ban_seconds(ip, redis_client)
            if ban_seconds != BAN_SECONDS:
                try:
                    redis_client.expire(ban_key, ban_seconds)
                except redis.RedisError:
                    current_app.logger.warning(f'banhammer: could not apply {reason!r} to {bucket}; keeping the 30-day ban')
                    ban_seconds, reason = BAN_SECONDS, f'{reason} (tier not applied)'
        except redis.RedisError:
            current_app.logger.exception(f'banhammer: Redis unavailable, could not ban {bucket}')
        else:
            current_app.logger.warning(f'banhammer: banned {bucket} for {ban_seconds // DAY}d ({reason!r}) after {count} /admin attempts')
            try:
                # repr() so a path containing a decoded newline can't forge extra log lines.
                ban_log.info(f'{bucket} path={request.path!r} attempts={count} days={ban_seconds // DAY} tier={reason!r}')
            except OSError:
                current_app.logger.exception('banhammer: could not write the ban audit log')
    return render_template('banned.html.jinja', posthog_key=posthog_key), 403
