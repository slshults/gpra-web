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
    FACEBOOK_CARD_CTA,
    build_share_url,
    chord_name_for_display,
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
        self.assertEqual(post['url'], 'https://example.com/find-a-chord-chart?id=42')
        self.assertEqual(post['hashtags'], DEFAULT_HASHTAGS)

    def test_text_contains_chord_of_the_day_heading(self):
        # The exact starting position depends on platform (bluesky has a
        # leading newline). PlatformVariationTests below covers position;
        # this test just verifies the heading substring is present.
        post = format_post('G', 1, base_url='https://example.com')
        self.assertIn("Today's Chord of the Day is: G", post['text'])

    def test_url_is_not_embedded_in_text(self):
        # New format: URL is NOT in the visible body. Bluesky links the chord
        # name itself via a facet; Facebook attaches the URL via the `link`
        # parameter (unfurl card). Either way, the URL doesn't clutter the body.
        post = format_post('Cmaj7', 42, base_url='https://example.com')
        self.assertNotIn('https://example.com', post['text'])
        self.assertNotIn('See it here', post['text'])

    def test_hashtags_appear_after_chord_name(self):
        post = format_post('G', 1, base_url='https://example.com')
        for tag in DEFAULT_HASHTAGS:
            self.assertIn(tag, post['text'])
        text = post['text']
        chord_pos = text.find('G')
        hashtag_pos = text.find(DEFAULT_HASHTAGS[0])
        self.assertGreater(hashtag_pos, chord_pos)

    def test_chord_byte_offsets_ascii(self):
        # "Today's Chord of the Day is: " is 29 bytes ASCII; "G" is 1 byte.
        post = format_post('G', 1, base_url='https://example.com')
        text_bytes = post['text'].encode('utf-8')
        self.assertEqual(text_bytes[post['chord_byte_start']:post['chord_byte_end']], b'G')

    def test_chord_byte_offsets_with_sharp(self):
        # ♯ (U+266F) is 3 bytes in UTF-8. The byte offset must reflect that, or
        # Bluesky's link facet would land in the wrong place.
        post = format_post('A#5', 71, base_url='https://example.com')
        text_bytes = post['text'].encode('utf-8')
        span = text_bytes[post['chord_byte_start']:post['chord_byte_end']]
        self.assertEqual(span.decode('utf-8'), 'A\u266f5')

    def test_chord_byte_offsets_with_slash(self):
        post = format_post('C/E', 200, base_url='https://example.com')
        text_bytes = post['text'].encode('utf-8')
        span = text_bytes[post['chord_byte_start']:post['chord_byte_end']]
        self.assertEqual(span.decode('utf-8'), 'C/E')

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

    def test_special_chars_in_chord_name_round_trip(self):
        # Chord names with sharps and flats appear in the text — sharps render
        # as ♯ (U+266F) to dodge hashtag auto-linkers; 'b' for flats stays as-is.
        post = format_post('F#m7b5', 100, base_url='https://example.com')
        self.assertIn('F\u266fm7b5', post['text'])

    def test_chord_with_slash_uses_id_url_when_id_given(self):
        # 'C/E' has a '/' but with a real id we should still use ?id=N
        post = format_post('C/E', 200, base_url='https://example.com')
        self.assertEqual(post['url'], 'https://example.com/find-a-chord-chart?id=200')

    def test_chord_with_slash_falls_back_to_encoded_name(self):
        post = format_post('C/E', None, base_url='https://example.com')
        self.assertIn('%2F', post['url'])  # '/' is encoded in the name fallback

    def test_sharp_symbol_substituted_in_post_text(self):
        # The visible text should use U+266F (♯), not '#', so Bluesky doesn't
        # auto-link 'A#5' as the hashtag '#5'.
        post = format_post('A#5', 71, base_url='https://example.com')
        self.assertIn('A\u266f5', post['text'])
        self.assertNotIn('A#5', post['text'])

    def test_sharp_substitution_handles_multiple_sharps(self):
        post = format_post('C#m7#5', 1, base_url='https://example.com')
        self.assertIn('C\u266fm7\u266f5', post['text'])

    def test_chord_name_in_return_dict_keeps_literal_hash(self):
        # The chord_name field is for adapters/analytics — keep DB form
        post = format_post('A#5', 71, base_url='https://example.com')
        self.assertEqual(post['chord_name'], 'A#5')

    def test_url_id_form_unaffected_by_sharp_substitution(self):
        post = format_post('A#5', 71, base_url='https://example.com')
        self.assertEqual(post['url'], 'https://example.com/find-a-chord-chart?id=71')

    def test_url_name_fallback_uses_literal_hash_encoded(self):
        # When falling back to ?chord=NAME, must use '#' (encoded) so the
        # server-side common_chords.name lookup still matches.
        post = format_post('C#m7', None, base_url='https://example.com')
        self.assertIn('%23', post['url'])  # '#' is %23
        self.assertNotIn('%E2%99%AF', post['url'])  # ♯ should NOT appear

    def test_chord_name_for_display_helper(self):
        self.assertEqual(chord_name_for_display('A#5'), 'A\u266f5')
        self.assertEqual(chord_name_for_display('Cmaj7'), 'Cmaj7')
        self.assertEqual(chord_name_for_display('C#m7#5'), 'C\u266fm7\u266f5')


class PlatformVariationTests(unittest.TestCase):
    """Per-platform layout differences."""

    def test_default_platform_is_bluesky(self):
        # Calling without platform= should produce the Bluesky shape (leading
        # newline, no FB CTA).
        post = format_post('G', 1, base_url='https://example.com')
        self.assertTrue(post['text'].startswith('\n'))
        self.assertNotIn(FACEBOOK_CARD_CTA, post['text'])

    def test_bluesky_starts_with_leading_newline(self):
        post = format_post('G', 1, base_url='https://example.com', platform='bluesky')
        self.assertTrue(post['text'].startswith("\nToday's Chord of the Day is: G"))

    def test_facebook_no_leading_newline(self):
        post = format_post('G', 1, base_url='https://example.com', platform='facebook')
        self.assertFalse(post['text'].startswith('\n'))
        self.assertTrue(post['text'].startswith("Today's Chord of the Day is: G"))

    def test_facebook_includes_card_cta_between_chord_and_hashtags(self):
        post = format_post('G', 1, base_url='https://example.com', platform='facebook')
        self.assertIn(FACEBOOK_CARD_CTA, post['text'])
        # CTA appears AFTER the chord name and BEFORE the hashtags
        text = post['text']
        chord_pos = text.find('Today')
        cta_pos = text.find(FACEBOOK_CARD_CTA)
        hashtag_pos = text.find('#')
        self.assertGreater(cta_pos, chord_pos)
        self.assertGreater(hashtag_pos, cta_pos)

    def test_bluesky_no_facebook_cta(self):
        post = format_post('G', 1, base_url='https://example.com', platform='bluesky')
        self.assertNotIn(FACEBOOK_CARD_CTA, post['text'])

    def test_bluesky_chord_byte_offsets_account_for_leading_newline(self):
        # Leading '\n' is 1 byte. Chord name span shifts by 1 byte vs the
        # previous (no-leading-newline) layout.
        post = format_post('G', 1, base_url='https://example.com', platform='bluesky')
        text_bytes = post['text'].encode('utf-8')
        self.assertEqual(text_bytes[post['chord_byte_start']:post['chord_byte_end']], b'G')
        # Verify it's specifically 30, not 29 (the 29 from earlier ascii-only
        # test was without the leading newline)
        self.assertEqual(post['chord_byte_start'], 30)

    def test_facebook_chord_byte_offsets_no_shift(self):
        # No leading newline on FB. Chord name still at byte 29.
        post = format_post('G', 1, base_url='https://example.com', platform='facebook')
        text_bytes = post['text'].encode('utf-8')
        self.assertEqual(text_bytes[post['chord_byte_start']:post['chord_byte_end']], b'G')
        self.assertEqual(post['chord_byte_start'], 29)

    def test_bluesky_byte_offsets_with_sharp_and_leading_newline(self):
        post = format_post('A#5', 71, base_url='https://example.com', platform='bluesky')
        text_bytes = post['text'].encode('utf-8')
        span = text_bytes[post['chord_byte_start']:post['chord_byte_end']]
        self.assertEqual(span.decode('utf-8'), 'A\u266f5')

    def test_unknown_platform_raises(self):
        with self.assertRaises(ValueError):
            format_post('G', 1, base_url='https://example.com', platform='twitter')

    def test_facebook_post_still_under_grapheme_limit(self):
        # Adding the CTA shouldn't push a normal-length post over the limit
        post = format_post('Cmaj7', 42, base_url='https://example.com', platform='facebook')
        self.assertLessEqual(len(post['text']), BLUESKY_GRAPHEME_LIMIT)


if __name__ == '__main__':
    unittest.main()
