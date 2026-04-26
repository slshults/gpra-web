"""Generate the curated Chord of the Day pool as SQL VALUES tuples.

Run once to produce the seed data. Output is pasted into the seed migration
so the migration itself is deterministic and reviewable in a diff.

Usage: python3 scripts/generate_chord_pool.py > /tmp/chord_pool_values.sql
"""
from collections import OrderedDict

# 12 keys, both sharp and flat spellings where they exist
ROOTS_12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
FLAT_ROOTS = ['Db', 'Eb', 'Gb', 'Ab', 'Bb']
COMMON_KEYS = ['C', 'D', 'E', 'G', 'A']  # the 5 most-used guitar keys


def names():
    """Yield (display_order, chord_name). Ordering reflects tiers below."""
    order = 0

    def emit(name):
        nonlocal order
        order += 1
        yield (order, name)

    # ---- Tier 1: foundational qualities, all 12 sharp keys (120) ----
    tier1_qualities = ['', 'm', '7', 'm7', 'maj7', '5', 'sus2', 'sus4', 'add9', '6']
    for q in tier1_qualities:
        for r in ROOTS_12:
            yield from emit(f'{r}{q}')

    # ---- Tier 2: common extensions, all 12 sharp keys (120) ----
    tier2_qualities = ['9', 'm9', 'maj9', '13', 'm11', 'dim', 'dim7', 'm7b5', 'aug', '7sus4']
    for q in tier2_qualities:
        for r in ROOTS_12:
            yield from emit(f'{r}{q}')

    # ---- Tier 3: slash chords (~50) ----
    slash_chords = [
        'C/E', 'C/G', 'C/B', 'C/Bb',
        'D/F#', 'D/A', 'D/B',
        'E/G#', 'E/B', 'E/D',
        'F/A', 'F/C', 'F/G',
        'G/B', 'G/D', 'G/F', 'G/F#', 'G/A',
        'A/C#', 'A/E', 'A/G',
        'B/D#', 'B/F#',
        'Am/C', 'Am/E', 'Am/G',
        'Bm/A', 'Bm/D', 'Bm/F#',
        'Cm/Eb', 'Cm/G',
        'Dm/A', 'Dm/F',
        'Em/B', 'Em/G',
        'F#m/A',
        'Gm/Bb', 'Gm/D',
        'Cmaj7/E', 'Cmaj7/G',
        'D7/F#', 'D7/A',
        'G7/B', 'G7/D',
        'A7/C#', 'A7/E',
        'B7/D#', 'B7/F#',
        'Em7/B', 'Am7/G',
        'Dsus4/F#', 'Asus2/E',
    ]
    for c in slash_chords:
        yield from emit(c)

    # ---- Tier 4: extra flavors for the 5 most common keys (40) ----
    extra_qualities = ['6/9', 'mMaj7', 'add4', 'm6', '7#9', '7b9', '7#5', '7b5']
    for q in extra_qualities:
        for r in COMMON_KEYS:
            yield from emit(f'{r}{q}')

    # ---- Tier 5: alternate flat spellings for foundational qualities (50) ----
    flat_qualities = ['', 'm', '7', 'm7', 'maj7', '5', 'sus2', 'sus4', 'add9', '6']
    for q in flat_qualities:
        for r in FLAT_ROOTS:
            yield from emit(f'{r}{q}')

    # ---- Tier 6: minor extras for popular minor roots (16) ----
    minor_roots = ['Am', 'Dm', 'Em', 'Gm']
    minor_extra_suffixes = ['add9', 'maj7', '13', '6/9']
    for r in minor_roots:
        for s in minor_extra_suffixes:
            yield from emit(f'{r}{s}')

    # ---- Tier 7: jazz / blues idiomatic specifics (22) ----
    jazz = [
        'Cmaj13', 'Dmaj13', 'Em9', 'Am9', 'F#m7b5', 'Bm7b5',
        'C7alt', 'G7alt', 'D7sus4', 'A7sus4', 'Dm6', 'G7b13',
        'C13b9', 'F13', 'Bb13', 'Eb7', 'A7sus2', 'C7sus2',
        'Dmaj7#11', 'Am11', 'Gmaj13', 'Fmaj7#11',
    ]
    for c in jazz:
        yield from emit(c)

    # ---- Tier 8: common wide voicings (4) ----
    wide = ['Csus2/G', 'Dsus2/A', 'Gsus4/D', 'Asus2/E']
    for c in wide:
        yield from emit(c)

    # ---- Tier 9: 11/maj13/7sus/add11 across 12 keys (48) ----
    extra_qualities_2 = ['11', 'maj13', '7sus', 'add11']
    for q in extra_qualities_2:
        for r in ROOTS_12:
            yield from emit(f'{r}{q}')

    # ---- Tier 10: more flat-key extensions (40) ----
    flat_extra_qualities = ['9', 'm9', 'maj9', '7sus4', 'dim7', 'm7b5', '13', 'aug']
    for q in flat_extra_qualities:
        for r in FLAT_ROOTS:
            yield from emit(f'{r}{q}')


def main():
    # De-dupe while preserving first-seen display_order. Names are case-sensitive
    # and we keep them as-is (no lowercasing) — the chord name renders verbatim
    # in the post text.
    seen = OrderedDict()
    for order, name in names():
        if name not in seen:
            seen[name] = order

    print(f'-- Total: {len(seen)} chords')
    print('-- Ordering reflects tiered curation: foundational, extensions, slash, jazz')
    print()
    items = list(seen.items())
    for i, (name, order) in enumerate(items):
        safe = name.replace("'", "''")
        comma = ',' if i < len(items) - 1 else ''
        print(f"    ('{safe}', {order}){comma}")


if __name__ == '__main__':
    main()
