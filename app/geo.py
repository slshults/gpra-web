"""Region detection for cookie-consent mode.

Looks up the request IP against a local MaxMind GeoLite2-City database and
decides whether the visitor is in an opt-in region (EU/EEA/UK/Switzerland or
US-California) or opt-out (everywhere else). Fails safe to opt-in whenever the
region cannot be determined.
"""
import logging
import os

import geoip2.database
import geoip2.errors

logger = logging.getLogger(__name__)

# EU 27 + EEA non-EU (IS, LI, NO) + UK + Switzerland. California is handled
# separately via the subdivision rule in classify().
OPT_IN_COUNTRIES = frozenset({
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE',          # EU 27
    'IS', 'LI', 'NO',          # EEA non-EU
    'GB',                      # United Kingdom
    'CH',                      # Switzerland
})

_DEFAULT_DB_PATH = '/usr/share/GeoIP/GeoLite2-City.mmdb'

# Module-level reader cache so we open the .mmdb once per process.
_reader = None
_reader_path = None


def classify(country_iso, subdivision_iso):
    """Pure mapping from region to consent mode. Returns 'opt-in' or 'opt-out'."""
    if country_iso in OPT_IN_COUNTRIES:
        return 'opt-in'
    if country_iso == 'US' and subdivision_iso == 'CA':
        return 'opt-in'
    return 'opt-out'


def _get_reader():
    """Return a cached geoip2 Reader, or None if the DB can't be opened."""
    global _reader, _reader_path
    db_path = os.environ.get('MAXMIND_DB_PATH', _DEFAULT_DB_PATH)
    if _reader is not None and _reader_path == db_path:
        return _reader
    try:
        _reader = geoip2.database.Reader(db_path)
        _reader_path = db_path
        return _reader
    except (FileNotFoundError, OSError) as exc:
        logger.warning('GeoLite2 DB unavailable at %s (%s); defaulting to opt-in', db_path, exc)
        return None


def consent_mode_for_ip(ip):
    """Resolve a consent mode for an IP. Fail-safe to 'opt-in' on any problem."""
    if not ip:
        return 'opt-in'
    reader = _get_reader()
    if reader is None:
        return 'opt-in'
    try:
        resp = reader.city(ip)
    except (geoip2.errors.AddressNotFoundError, ValueError):
        return 'opt-in'
    except Exception:
        logger.exception('GeoIP lookup failed for %s', ip)
        return 'opt-in'
    country = resp.country.iso_code
    if not country:
        return 'opt-in'
    subdivision = resp.subdivisions.most_specific.iso_code
    return classify(country, subdivision)
