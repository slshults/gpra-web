"""Build the post text for the Chord of the Day social posts.

Pure functions only — no DB, no HTTP. Adapters consume the returned dict to
build platform-specific payloads (BlueSky facets, Facebook Graph fields).
"""
import os
import unicodedata
from typing import List, Optional, TypedDict
from urllib.parse import quote


# BlueSky's hard limit on post length, measured in user-perceived characters.
BLUESKY_GRAPHEME_LIMIT = 300

DEFAULT_HASHTAGS = ['#guitar', '#chords', '#guitarpractice']
# Short-form domain used in social posts to save characters. gpra.app serves
# the same Flask app as guitarpracticeroutine.com (same DB, same routes), so
# deep-link query params resolve identically. The og:url tag emitted by the
# template reflects whichever host the page was requested through.
DEFAULT_BASE_URL = 'https://gpra.app'


class PostPayload(TypedDict):
    text: str
    url: str
    hashtags: List[str]
    chord_name: str
    # Byte offsets into UTF-8 encoded `text` that mark the chord-name span.
    # Bluesky uses these to attach a link facet so the chord name itself is
    # the clickable target. Facebook ignores them (no inline-link support;
    # the URL is sent separately as the `link` parameter for the unfurl card).
    chord_byte_start: int
    chord_byte_end: int


def build_share_url(chord_name: str, common_chord_id: Optional[int], base_url: str) -> str:
    """Prefer ?id=N (precise voicing). Fall back to ?chord=NAME when no id."""
    base = base_url.rstrip('/')
    if common_chord_id:
        return f"{base}/find-a-chord-chart?id={common_chord_id}"
    # quote with safe='' so '/' and '#' in chord names survive round-tripping
    return f"{base}/find-a-chord-chart?chord={quote(chord_name, safe='')}"


def _truncate_to_graphemes(s: str, limit: int) -> str:
    """Trim s so it fits within `limit` grapheme clusters.

    Uses NFC normalization as a close approximation. For full unicode-segmentation
    correctness use the third-party `regex` library; for ASCII-heavy chord posts
    this is sufficient.
    """
    s_nfc = unicodedata.normalize('NFC', s)
    if len(s_nfc) <= limit:
        return s
    # Reserve one slot for the ellipsis
    return s_nfc[: limit - 1].rstrip() + '\u2026'


def _resolve_hashtags(hashtags: Optional[List[str]]) -> List[str]:
    if hashtags is not None:
        return [tag for tag in hashtags if tag.startswith('#')]
    env = os.getenv('COTD_HASHTAGS')
    if env:
        return [tag.strip() for tag in env.split() if tag.strip().startswith('#')]
    return list(DEFAULT_HASHTAGS)


def chord_name_for_display(chord_name: str) -> str:
    """Render a chord name with the proper Unicode music-sharp symbol.

    Bluesky (and to a lesser extent Facebook) auto-link any '#word' pattern as
    a hashtag, which mangles names like 'A#5' or 'C#m7'. Substituting the
    proper U+266F MUSIC SHARP SIGN sidesteps the auto-linker entirely and is
    the musically correct symbol anyway.
    """
    return chord_name.replace('#', '\u266f')


FACEBOOK_CARD_CTA = "(Click on 'gpra.app', below, to view the chord)"


def format_post(
    chord_name: str,
    common_chord_id: Optional[int] = None,
    base_url: Optional[str] = None,
    hashtags: Optional[List[str]] = None,
    platform: str = 'bluesky',
) -> PostPayload:
    """Assemble the daily post payload.

    Args:
        chord_name: e.g. "Cmaj7" — appears verbatim in the post text.
        common_chord_id: voicing id for ?id=N URL. None falls back to ?chord=NAME.
        base_url: defaults to COTD_BASE_URL env or the production URL.
        hashtags: explicit list ('#tag' format). None falls back to env or defaults.
        platform: 'bluesky' or 'facebook'. Each platform gets a slightly
            different layout:
              - 'bluesky' adds a leading blank line for breathing room above
                the first visible line of the post (the avatar/header sit
                right against the body otherwise).
              - 'facebook' inserts a CTA block between the chord-name line
                and the hashtags pointing the reader at the unfurled link
                card below the post (since on FB the URL isn't in the body).

    Returns a dict with `text` (full post), `url` (deep-link), `hashtags` (list),
    `chord_name`, and `chord_byte_start`/`chord_byte_end` (UTF-8 byte offsets
    of the chord name in `text` — used by the Bluesky adapter to attach a link
    facet so the chord name itself becomes the clickable target).

    Note: the visible post text uses the music-sharp symbol (U+266F) in chord
    names, while `chord_name` (in the return dict) and the `?chord=NAME`
    URL fallback use the literal '#' since common_chords.name stores it that way.
    """
    if not chord_name or not chord_name.strip():
        raise ValueError("chord_name is required")
    if platform not in ('bluesky', 'facebook'):
        raise ValueError(f"platform must be 'bluesky' or 'facebook', got {platform!r}")

    if base_url is None:
        base_url = os.getenv('COTD_BASE_URL', DEFAULT_BASE_URL)
    resolved_hashtags = _resolve_hashtags(hashtags)

    url = build_share_url(chord_name, common_chord_id, base_url)
    display_name = chord_name_for_display(chord_name)
    hashtags_line = ' '.join(resolved_hashtags)

    leading = '\n' if platform == 'bluesky' else ''
    cta_block = f"\n\n{FACEBOOK_CARD_CTA}" if platform == 'facebook' else ''

    intro = "Today's Chord of the Day is: "
    text = (
        f"{leading}{intro}{display_name}"
        f"{cta_block}\n"
        "\n"
        f"{hashtags_line}"
    )

    # Byte offsets of the chord name. Computed BEFORE any potential truncation;
    # the chord name appears near the start of the post so it's never trimmed.
    chord_byte_start = len(leading.encode('utf-8')) + len(intro.encode('utf-8'))
    chord_byte_end = chord_byte_start + len(display_name.encode('utf-8'))

    text = _truncate_to_graphemes(text, BLUESKY_GRAPHEME_LIMIT)

    return PostPayload(
        text=text,
        url=url,
        hashtags=resolved_hashtags,
        chord_name=chord_name,
        chord_byte_start=chord_byte_start,
        chord_byte_end=chord_byte_end,
    )
