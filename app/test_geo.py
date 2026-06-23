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

    def test_private_ip_fails_safe_to_opt_in(self):
        self.assertEqual(consent_mode_for_ip('127.0.0.1'), 'opt-in')
        self.assertEqual(consent_mode_for_ip('192.168.1.5'), 'opt-in')


if __name__ == '__main__':
    unittest.main()
