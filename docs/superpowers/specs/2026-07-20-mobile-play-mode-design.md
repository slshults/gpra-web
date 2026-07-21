# Mobile Play mode (design 2a — play state)

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation
**Redesign chunk:** 4 (after #109 chord editor, #110 nav shell, #111 Practice list)

## Goal

A full-screen, hands-free **Play mode** for practicing an item on mobile: big
countdown, the item's chord charts in a dense dots-only grid, optional
auto-scroll for long songs, a screen wake lock, and huge knuckle-tappable
prev/next zones. Launched from the list's ▶. Desktop unchanged.

## Launch & exit

- **The list ▶ launches Play mode** (starts the item's timer + goes full-screen).
  This replaces the in-place start/stop toggle from #111 — the ▶ on the timer
  strip now always enters Play mode.
- **Play/pause and exit are separate controls** (key decision):
  - Header **play/pause circle** toggles the timer and *stays in Play mode* (so
    you can pause to retune / switch guitars / grab a drink, then resume).
  - Header **exit control** (a down-chevron "▾", top-left, ≥44px) returns to the
    list. Discoverable, always visible.
- The **timer is independent of the view.** Exiting keeps the timer's state (a
  running timer keeps counting and shows live in the list row — #111 already
  renders `timers[entryId]`). The global countdown effect in PracticePage runs
  regardless of view, so no special handling.

## The screen (top → bottom)

1. **Header** (padding 12/14): `▾` exit (left) · song title 16/700 + `N of M ·
   <routine>` 11 `#6b7280` · countdown 24 mono + play/pause circle (44px, 2px
   `#4b5563` border; Play or Pause icon per timer state).
2. **Progress bar**: 5px track `#1f2937`, fill `#f97316`, `width = elapsed /
   duration`.
3. **Pills row**:
   - `AUTO-ADVANCE` — **status pill** (non-interactive), 10/700 `#22c55e` on
     `rgba(34,197,94,0.12)`. Always on (see Behaviors).
   - `SCROLL` segmented control — **`OFF / SLOW / MED / FAST`** (44×24 cells,
     active `#f97316`/`#111827`, radius 99px). Interactive; persisted.
   - `SCREEN AWAKE` — status pill, shown only when a wake lock is actually held.
4. **Chord area** (flex:1, scrollable): one continuous **4-across dots-only**
   grid; section labels are full-width rows (`grid-column:1/-1`, 11/700 uppercase
   `#fb923c` + repeat pill + 1px `#1f2937` rule). No "current section" highlight.
   Sectionless songs (e.g. Blue Jean Blues) render as one label-less run — valid.
5. **Prev/next zones**: bottom row, 64px tall, half-width each, `#111827`, 1px
   gap/top border: `‹ <prevName>` (`#9ca3af`) / `<nextName> ›` (`#f3f4f6` 700).
   Disabled/hidden at the ends of the routine.

Landscape: the grid just reflows wider (`repeat(auto-fill, minmax(84px, 1fr))`).
No special landscape layout.

## Behaviors

- **Play/pause**: `onToggleTimer(entryId)` (mobile `skipSoundModal`), stays in
  Play mode.
- **Prev/next**: switch the current item; **do NOT auto-start its timer** (people
  need setup time). Land on the new song's chords with the timer at full
  duration; the user taps play when ready. Loads the new item's chords via
  `onLoadChordCharts(itemB)`.
- **Auto-advance (always on)**: when the current item's timer reaches 0:00, mark
  it done (`onToggleComplete`) and **return to the list** (`onExit`). Detected in
  MobilePlayMode via a previous-value ref on `timers[entryId]` crossing to 0
  while active; fires once. (The existing PracticePage timer effect plays the
  end sound at 0.)
- **Wake lock**: request `navigator.wakeLock.request('screen')` while Play mode
  is active; re-acquire on `visibilitychange` → visible; release on exit. If the
  API is unsupported or the request rejects, hide the `SCREEN AWAKE` pill (don't
  fake it).
- **Auto-scroll**: when speed ≠ `off` and the chord area overflows, scroll it
  down via a `requestAnimationFrame` loop at a px/s rate; stop at the bottom.
  Starting values (tunable by feel): SLOW 8, MED 16, FAST 28 px/s. Default
  **OFF** — no one gets a surprise moving screen; they opt in. Persisted.

## Persistence

- `autoScrollSpeed` ∈ {off, slow, med, fast} — **localStorage only**
  (`gpra_autoscroll_speed`), default `off`. Per-device feel knob; no backend
  (decision A). A tiny local state, no server round-trip.

## State

- `playModeEntryId` (routine-entry id | null) — lives in `MobilePracticePage`;
  when set, it renders `<MobilePlayMode>` over everything.
- `autoScrollSpeed` — local to MobilePlayMode (localStorage-backed).
- Everything else (timers, activeTimers, completedItems, chordSections) stays
  owned by PracticePage and flows through MobilePracticePage as today.

## Components

- **`MobileChordChart.jsx`** (new) — extract the existing SVGuitar renderer out
  of `MobileChordGrid.jsx` into its own module, exported, so both the grid and
  Play mode render charts from one component (same config, scaled SVG, dots-only
  / finger-number toggle, arc-barre white post-process). `MobileChordGrid`
  imports it instead of defining it inline.
- **`MobilePlayMode.jsx`** (new) — the full-screen view. Props: `routine`,
  `entryId`, `getItemDetails`, `timers`, `activeTimers`, `chordSections`,
  `onToggleTimer`, `onToggleComplete`, `onExit`, `onNavigate(entryId)`,
  `onLoadChordCharts`. Owns wake lock, auto-scroll, auto-advance detection, and
  the `autoScrollSpeed` local state.
- **`MobilePracticePage.jsx`** — add `playModeEntryId` state; the timer-strip ▶
  now launches Play mode (start timer if stopped + set `playModeEntryId`);
  render `<MobilePlayMode>` when set, with `onExit`/`onNavigate` wired to the
  state setter and prev/next resolution.

## Testing (Acoustic Relearning 1, 412px / Pixel 7)

1. ▶ on an item → full-screen Play mode; countdown ticks; progress fills.
2. Play/pause toggles the timer and stays in Play mode; exit ▾ returns to list.
3. Exiting with a running timer → list row shows it still counting.
4. Prev/next switches items (Blue Jean Blues is item #2) without starting the
   timer; chords load; ends of routine disable the zones.
5. SCROLL OFF/SLOW/MED/FAST: OFF = no motion; others scroll an overflowing song
   (Blue Jean Blues) at increasing speed; persists across reloads.
6. Wake lock: `SCREEN AWAKE` pill shows when held; hidden if unsupported.
7. Auto-advance: let a timer reach 0:00 → item marked done + back to list.
8. Landscape reflow; desktop Practice unchanged (regression).

## Out of scope / deferred

Mobile in-place chord *editing* (still queued), Items/Routines chord modals,
Routines/Items page redesigns. Auto-scroll BPM-awareness (fixed px/s for v1).
