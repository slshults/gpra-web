"""Unit tests for the Chord of the Day formatter.

Run directly: python3 -m unittest app.services.daily_chord.test_formatter
or:           python3 app/services/daily_chord/test_formatter.py
"""
import unittest
from unittest import mock

from app.services.daily_chord.formatter import (
    BLUESKY_GRAPHEME_LIMIT,
    DEFAULT_BASE_URL,
    DEFAULT_HASHTAGS,
    build_share_url,
    format_post,
)


class BuildShareUrlTests(unittest.TestCase):
    def test_id_url_when_id_given(self):
        url = build_share_url('Cmaj7', 42, 'https://example.com')
        self.assertEqual(url, 'https://example.com/find-a-chord-chart?id=42')

    def test_name_url_when_no_id(self):
        url = build_share_url('Cmaj7', None, 'https://example.com')
        self.assertEqual(url, 'https://example.com/find-a-chord-chart?chord=Cmaj7')

    def test_strips_trailing_slash_from_base(self):
        url = build_share_url('Cmaj7', 42, 'https://example.com/')
        self.assertEqual(url, 'https://example.com/find-a-chord-chart?id=42')

    def test_quotes_special_chars_in_name(self):
        # '#' and '/' need URL-encoding to survive query parsing
        url = build_share_url('C#m7b5', None, 'https://example.com')
        self.assertIn('%23', url)
        self.assertIn('chord=', url)

        url = build_share_url('C/E', None, 'https://example.com')
        self.assertIn('%2F', url)


class FormatPostTests(unittest.TestCase):
    def test_basic_post_shape(self):
        post = format_post('Cmaj7', 42, base_url='https://example.com')
        self.assertEqual(post['chord_name'], 'Cmaj7')
        self.assertIn('Cmaj7', post['text'])
        self.assertIn('https://example.com/find-a-chord-chart?id=42', post['text'])
        self.assertEqual(post['url'], 'https://example.com/find-a-chord-chart?id=42')
        self.assertEqual(post['hashtags'], DEFAULT_HASHTAGS)

    def test_text_starts_with_chord_of_the_day_heading(self):
        post = format_post('G', 1, base_url='https://example.com')
        self.assertTrue(post['text'].startswith('Chord of the day: G'))

    def test_hashtags_appear_at_end(self):
        post = format_post('G', 1, base_url='https://example.com')
        for tag in DEFAULT_HASHTAGS:
            self.assertIn(tag, post['text'])
        # Hashtag line is last; URL precedes it
        text = post['text']
        url_pos = text.find('https://')
        hashtag_pos = text.find(DEFAULT_HASHTAGS[0])
        self.assertGreater(hashtag_pos, url_pos)

    def test_falls_back_to_chord_name_url_when_no_id(self):
        post = format_post('Cmaj7', None, base_url='https://example.com')
        self.assertEqual(post['url'], 'https://example.com/find-a-chord-chart?chord=Cmaj7')

    def test_explicit_hashtags_override_default(self):
        post = format_post('G', 1, base_url='https://example.com', hashtags=['#foo', '#bar'])
        self.assertEqual(post['hashtags'], ['#foo', '#bar'])
        self.assertIn('#foo', post['text'])
        self.assertNotIn('#guitar', post['text'])

    def test_filters_invalid_hashtags(self):
        # Anything not starting with '#' is dropped
        post = format_post('G', 1, base_url='https://example.com', hashtags=['#good', 'bare', '#also-good'])
        self.assertEqual(post['hashtags'], ['#good', '#also-good'])

    def test_env_var_hashtags_used_when_not_explicit(self):
        with mock.patch.dict('os.environ', {'COTD_HASHTAGS': '#a #b #c'}):
            post = format_post('G', 1, base_url='https://example.com')
        self.assertEqual(post['hashtags'], ['#a', '#b', '#c'])

    def test_default_base_url_used_when_none(self):
        # Clear any env override so we're testing the in-code default
        with mock.patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('COTD_BASE_URL', None)
            post = format_post('G', 1)
        self.assertTrue(post['url'].startswith(DEFAULT_BASE_URL))

    def test_env_base_url_overrides_default(self):
        with mock.patch.dict('os.environ', {'COTD_BASE_URL': 'https://staging.example.com'}):
            post = format_post('G', 1)
        self.assertTrue(post['url'].startswith('https://staging.example.com'))

    def test_post_fits_under_bluesky_limit(self):
        # A long chord name shouldn't overflow the limit
        long_name = 'C' + 'm' * 50 + 'maj7'
        post = format_post(long_name, 42, base_url='https://example.com')
        self.assertLessEqual(len(post['text']), BLUESKY_GRAPHEME_LIMIT)

    def test_truncation_appends_ellipsis(self):
        # Force truncation by passing a huge fake post via long chord_name
        huge_name = 'X' * (BLUESKY_GRAPHEME_LIMIT + 100)
        post = format_post(huge_name, 1, base_url='https://example.com')
        self.assertLessEqual(len(post['text']), BLUESKY_GRAPHEME_LIMIT)
        self.assertTrue(post['text'].endswith('\u2026'))

    def test_empty_chord_name_raises(self):
        with self.assertRaises(ValueError):
            format_post('', 1, base_url='https://example.com')
        with self.assertRaises(ValueError):
            format_post('   ', 1, base_url='https://example.com')

    def test_curly_quotes_and_special_chars_preserved(self):
        # Chord names with special characters should round-trip
        post = format_post('F#m7b5', 100, base_url='https://example.com')
        self.assertIn('F#m7b5', post['text'])

    def test_chord_with_slash_uses_id_url_when_id_given(self):
        # 'C/E' has a '/' but with a real id we should still use ?id=N
        post = format_post('C/E', 200, base_url='https://example.com')
        self.assertEqual(post['url'], 'https://example.com/find-a-chord-chart?id=200')

    def test_chord_with_slash_falls_back_to_encoded_name(self):
        post = format_post('C/E', None, base_url='https://example.com')
        self.assertIn('%2F', post['url'])  # '/' is encoded in the name fallback


if __name__ == '__main__':
    unittest.main()
