"""Unit tests for the Facebook adapter (HTTP mocked)."""
import unittest
from unittest import mock

from app.services.social.facebook import _safe_error, post


class SafeErrorTests(unittest.TestCase):
    def test_redacts_access_token_param(self):
        msg = _safe_error(Exception('failed: access_token=secrettoken12345 expired'))
        self.assertIn('[REDACTED]', msg)
        self.assertNotIn('secrettoken12345', msg)

    def test_handles_uppercase_token_param(self):
        msg = _safe_error(Exception('access_TOKEN=foo'))
        self.assertIn('[REDACTED]', msg)

    def test_truncates_long_messages(self):
        msg = _safe_error(Exception('x' * 500))
        self.assertLess(len(msg), 220)


class PostTests(unittest.TestCase):
    def test_returns_error_when_creds_missing(self):
        with mock.patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('FACEBOOK_PAGE_ID', None)
            os.environ.pop('FACEBOOK_PAGE_ACCESS_TOKEN', None)
            result = post('hello')
        self.assertFalse(result['ok'])
        self.assertIn('credentials', result['error'].lower())

    def test_post_success_path(self):
        mock_response = mock.MagicMock(
            status_code=200,
            json=mock.MagicMock(return_value={'id': '12345_67890'}),
        )
        with mock.patch('app.services.social.facebook.requests.post', return_value=mock_response):
            result = post('hi', link='https://example.com', page_id='12345', page_access_token='tok')
        self.assertTrue(result['ok'])
        self.assertEqual(result['post_id'], '12345_67890')

    def test_post_extracts_graph_api_error(self):
        mock_response = mock.MagicMock(
            status_code=400,
            json=mock.MagicMock(return_value={
                'error': {
                    'type': 'OAuthException',
                    'message': 'Invalid OAuth access token',
                }
            }),
        )
        with mock.patch('app.services.social.facebook.requests.post', return_value=mock_response):
            result = post('hi', page_id='12345', page_access_token='tok')
        self.assertFalse(result['ok'])
        self.assertIn('OAuthException', result['error'])
        self.assertIn('Invalid OAuth access token', result['error'])

    def test_post_does_not_leak_token_on_network_error(self):
        with mock.patch(
            'app.services.social.facebook.requests.post',
            side_effect=Exception('Connection refused: access_token=ABC123XYZ from req'),
        ):
            result = post('hi', page_id='12345', page_access_token='ABC123XYZ')
        self.assertFalse(result['ok'])
        self.assertNotIn('ABC123XYZ', result['error'])
        self.assertIn('[REDACTED]', result['error'])


if __name__ == '__main__':
    unittest.main()
