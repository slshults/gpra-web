"""Unit tests for the BlueSky adapter (HTTP mocked)."""
import unittest
from unittest import mock

from app.services.social.bluesky import _build_facets, _safe_error, post


class BuildFacetsTests(unittest.TestCase):
    def test_extracts_hashtags_with_byte_offsets(self):
        text = "#guitar #chords"
        facets = _build_facets(text)
        tags = [
            f for f in facets
            if any(feat.get('$type') == 'app.bsky.richtext.facet#tag' for feat in f['features'])
        ]
        self.assertEqual(len(tags), 2)
        self.assertEqual(tags[0]['features'][0]['tag'], 'guitar')
        self.assertEqual(tags[0]['index'], {'byteStart': 0, 'byteEnd': 7})
        # '#chords' starts at byte 8 (after '#guitar' + space)
        self.assertEqual(tags[1]['index'], {'byteStart': 8, 'byteEnd': 15})

    def test_url_facet(self):
        url = "https://example.com/x"
        text = f"See it: {url}"
        facets = _build_facets(text, url)
        link_facets = [
            f for f in facets
            if any(feat.get('$type') == 'app.bsky.richtext.facet#link' for feat in f['features'])
        ]
        self.assertEqual(len(link_facets), 1)
        self.assertEqual(link_facets[0]['features'][0]['uri'], url)

    def test_byte_offsets_handle_multibyte_correctly(self):
        # 'é' is 2 bytes in UTF-8. '#x' is at character index 5, byte index 6.
        text = "café #x"
        facets = _build_facets(text)
        self.assertEqual(facets[0]['index']['byteStart'], 6)
        self.assertEqual(facets[0]['index']['byteEnd'], 8)

    def test_no_facets_when_no_hashtags_or_url(self):
        facets = _build_facets("just text no tags")
        self.assertEqual(facets, [])

    def test_url_not_added_when_not_present_in_text(self):
        # Defensive: if the URL isn't actually in the text, don't add a facet
        facets = _build_facets("just a hashtag #foo", url="https://other.example.com")
        # only the hashtag facet
        self.assertEqual(len(facets), 1)


class SafeErrorTests(unittest.TestCase):
    def test_redacts_jwt(self):
        msg = _safe_error(Exception('oops eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature'))
        self.assertIn('[REDACTED]', msg)
        self.assertNotIn('eyJ', msg)

    def test_redacts_app_password_pattern(self):
        msg = _safe_error(Exception('login failed: abcd-efgh-ijkl-mnop'))
        self.assertIn('[REDACTED]', msg)
        self.assertNotIn('abcd-efgh', msg)

    def test_truncates_long_messages(self):
        msg = _safe_error(Exception('x' * 500))
        self.assertLess(len(msg), 220)


class PostTests(unittest.TestCase):
    def test_returns_error_when_creds_missing(self):
        with mock.patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('BLUESKY_HANDLE', None)
            os.environ.pop('BLUESKY_APP_PASSWORD', None)
            result = post('hello world')
        self.assertFalse(result['ok'])
        self.assertIn('credentials', result['error'].lower())

    def test_post_success_path(self):
        with mock.patch('app.services.social.bluesky.requests.post') as rp:
            # First call: createSession
            rp.side_effect = [
                mock.MagicMock(
                    raise_for_status=mock.MagicMock(),
                    json=mock.MagicMock(return_value={'accessJwt': 'jwt', 'did': 'did:plc:xyz', 'handle': 'a.bsky.social'}),
                ),
                mock.MagicMock(
                    raise_for_status=mock.MagicMock(),
                    json=mock.MagicMock(return_value={'uri': 'at://did:plc:xyz/app.bsky.feed.post/abc123', 'cid': 'bafy'}),
                ),
            ]
            result = post('hello', url=None, handle='a.bsky.social', app_password='pw')
        self.assertTrue(result['ok'])
        self.assertEqual(result['uri'], 'at://did:plc:xyz/app.bsky.feed.post/abc123')

    def test_post_error_on_auth_failure(self):
        with mock.patch('app.services.social.bluesky.requests.post') as rp:
            rp.side_effect = Exception('401 Unauthorized eyJhbGciOiJIUzI1NiJ9.x.y')
            result = post('hi', handle='a.bsky.social', app_password='pw')
        self.assertFalse(result['ok'])
        self.assertNotIn('eyJ', result['error'])  # JWT redacted


if __name__ == '__main__':
    unittest.main()
