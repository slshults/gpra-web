"""Unit tests for the region → consent_mode classifier.

Run:
  python3 -m unittest app.test_geo
"""
import os
import unittest

from app.geo import classify, consent_mode_for_ip, OPT_IN_COUNTRIES


class ClassifyTests(unittest.TestCase):
    def test_eu_country_is_opt_in(self):
        self.assertEqual(classify('DE', None), 'opt-in')
        self.assertEqual(classify('FR', 'IDF'), 'opt-in')

    def test_uk_is_opt_in(self):
        self.assertEqual(classify('GB', 'ENG'), 'opt-in')

    def test_switzerland_is_opt_in(self):
        self.assertEqual(classify('CH', None), 'opt-in')

    def test_eea_non_eu_is_opt_in(self):
        self.assertEqual(classify('NO', None), 'opt-in')
        self.assertEqual(classify('IS', None), 'opt-in')
        self.assertEqual(classify('LI', None), 'opt-in')

    def test_us_california_is_opt_in(self):
        self.assertEqual(classify('US', 'CA'), 'opt-in')

    def test_us_other_state_is_opt_out(self):
        self.assertEqual(classify('US', 'TX'), 'opt-out')
        self.assertEqual(classify('US', None), 'opt-out')

    def test_non_restricted_country_is_opt_out(self):
        self.assertEqual(classify('AU', None), 'opt-out')
        self.assertEqual(classify('JP', '13'), 'opt-out')

    def test_unknown_country_is_opt_out(self):
        # A resolved-but-not-restricted country classifies opt-out;
        # truly unknown IPs are handled by consent_mode_for_ip, not here.
        self.assertEqual(classify('BR', None), 'opt-out')

    def test_opt_in_set_membership(self):
        self.assertIn('DE', OPT_IN_COUNTRIES)
        self.assertIn('GB', OPT_IN_COUNTRIES)
        self.assertIn('CH', OPT_IN_COUNTRIES)
        self.assertIn('NO', OPT_IN_COUNTRIES)  # EEA non-EU member
        self.assertNotIn('US', OPT_IN_COUNTRIES)  # US handled via subdivision rule


class ConsentModeForIpTests(unittest.TestCase):
    def setUp(self):
        # Force a guaranteed-missing DB so these tests exercise the fail-safe
        # path deterministically, regardless of whether a real GeoLite2 DB is
        # installed in the environment. (A real DB would resolve 8.8.8.8 to
        # US/non-CA = opt-out, which is NOT what these tests are about.)
        import app.geo as geo
        self._prev = os.environ.get('MAXMIND_DB_PATH')
        os.environ['MAXMIND_DB_PATH'] = '/nonexistent/GeoLite2-City.mmdb'
        geo._reader = None
        geo._reader_path = None
        geo._failed_path = None

    def tearDown(self):
        if self._prev is None:
            os.environ.pop('MAXMIND_DB_PATH', None)
        else:
            os.environ['MAXMIND_DB_PATH'] = self._prev

    def test_none_ip_fails_safe_to_opt_in(self):
        self.assertEqual(consent_mode_for_ip(None), 'opt-in')

    def test_empty_ip_fails_safe_to_opt_in(self):
        self.assertEqual(consent_mode_for_ip(''), 'opt-in')

    def test_missing_db_fails_safe_to_opt_in(self):
        self.assertEqual(consent_mode_for_ip('8.8.8.8'), 'opt-in')

    def test_private_ip_with_missing_db_fails_safe_to_opt_in(self):
        self.assertEqual(consent_mode_for_ip('127.0.0.1'), 'opt-in')
        self.assertEqual(consent_mode_for_ip('192.168.1.5'), 'opt-in')


class RealDbFailSafeTests(unittest.TestCase):
    """Verify private IPs fail-safe to opt-in against a REAL GeoLite2 DB.
    Skipped when no DB is installed (e.g. local dev)."""

    def setUp(self):
        import app.geo as geo
        # Ensure no forced-missing override leaks in from other tests.
        os.environ.pop('MAXMIND_DB_PATH', None)
        geo._reader = None
        geo._reader_path = None
        geo._failed_path = None
        self._db_path = '/usr/share/GeoIP/GeoLite2-City.mmdb'

    @unittest.skipUnless(os.path.exists('/usr/share/GeoIP/GeoLite2-City.mmdb'),
                         'GeoLite2-City DB not installed')
    def test_private_ip_fails_safe_against_real_db(self):
        # geoip2 raises AddressNotFoundError for private ranges; consent_mode_for_ip
        # must catch it and return opt-in.
        self.assertEqual(consent_mode_for_ip('127.0.0.1'), 'opt-in')
        self.assertEqual(consent_mode_for_ip('192.168.1.5'), 'opt-in')


class BundledTestDbTests(unittest.TestCase):
    """Region detection against the bundled MaxMind test DB — exercises the REAL
    lookup path (country + subdivision → classify), not just the fail-safe path.
    The fixture ships permissively in maxmind/MaxMind-DB (test-data)."""

    DB = os.path.join(os.path.dirname(__file__), 'test_data', 'GeoIP2-City-Test.mmdb')

    def setUp(self):
        import app.geo as geo
        self._prev = os.environ.get('MAXMIND_DB_PATH')
        os.environ['MAXMIND_DB_PATH'] = self.DB
        geo._reader = None
        geo._reader_path = None
        geo._failed_path = None

    def tearDown(self):
        import app.geo as geo
        if self._prev is None:
            os.environ.pop('MAXMIND_DB_PATH', None)
        else:
            os.environ['MAXMIND_DB_PATH'] = self._prev
        geo._reader = None
        geo._reader_path = None
        geo._failed_path = None

    def test_uk_ip_opt_in(self):
        # 81.2.69.142 -> GB / England
        self.assertEqual(consent_mode_for_ip('81.2.69.142'), 'opt-in')

    def test_sweden_ip_opt_in(self):
        # 89.160.20.112 -> SE (EEA)
        self.assertEqual(consent_mode_for_ip('89.160.20.112'), 'opt-in')

    def test_us_non_california_opt_out(self):
        # 216.160.83.56 -> US / Washington (US but not CA -> opt-out)
        self.assertEqual(consent_mode_for_ip('216.160.83.56'), 'opt-out')

    def test_china_ip_opt_out(self):
        # 175.16.199.0 -> CN
        self.assertEqual(consent_mode_for_ip('175.16.199.0'), 'opt-out')


if __name__ == '__main__':
    unittest.main()
