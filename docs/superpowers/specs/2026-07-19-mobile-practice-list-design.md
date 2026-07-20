# Mobile Practice page — list state (design 2a) — PR-1

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation
**Redesign chunk:** 3 of N in the mobile redesign (after #109 chord editor, #110 nav shell)

## Goal

Recreate the approved **design 2a "list state"** for the Practice page on mobile
(below the 640px breakpoint), so guitarists see chord charts at a usable density
(3–4 across) instead of one-per-row. Desktop (≥640px) is unchanged.

The single most important payoff: chord charts in a grid, so a player sees a
whole section without taking hands off the guitar to scroll.

## Scope

**In (PR-1):** the complete design-2a *list* screen on mobile —
- Sticky 52px top bar: routine name, `mm:ss / mm:ss · N items`, reset button.
  Replaces the tall orange app header **on the Practice page only** (other pages
  keep it; the bottom tab bar from #110 stays).
- 52px item rows: completion circle, title, time, chevron; expand/collapse.
- Expanded item: timer strip, chords header + density toggle, sticky section
  labels, chord density grid, action row, notes row.
- Chord density grid: 3-across or 4-across, per-user persisted.
- Tap-a-chart → enlarged overlay (finger numbers on).
- Edit-mode toggle → per-tile edit/delete overlays.

**Deferred to PR-2:** Play mode (full-screen takeover, wake lock, auto-scroll,
prev/next). See "Seam: the ▶ button" below.

**Out of scope:** Routines page, Items page, Stats, autocreate UI, guided-tour
updates. Desktop Practice layout untouched.

## Seam: the ▶ button

The handoff couples the timer ▶ to "start timer **and** open Play mode." Play
mode is PR-2. **In PR-1, ▶ starts/stops the timer only** (current behavior).
PR-2 layers the Play-mode launch onto the same button — no throwaway work.

## Architecture (approach B — extract, don't inline)

`PracticePage.jsx` is ~6,100 lines with ~90 state/ref hooks; its state and
handlers are battle-tested and must not be disturbed. So:

- **`PracticePage.jsx` stays the state/logic owner.** Near its `return`, add:
  `if (isMobile) return <MobilePracticePage {...bundle} />;`
  (using the existing `useIsMobile` hook from #110). The desktop render path is
  untouched → cannot regress.
- **New `MobilePracticePage.jsx`** — mobile list JSX only. Receives a defined
  prop bundle (documents exactly what the mobile view depends on):
  - Data: `items` (ordered routine items), `activeRoutine`, `completedItems`,
    `expandedItems`, `timers` (elapsed per item), `chordSections` (per expanded
    item), `notesByItem`.
  - Handlers: `onToggleComplete(itemId)`, `onToggleExpand(itemId)`,
    `onStartTimer(itemId)`, `onStopTimer(itemId)`, `onResetProgress()`,
    `onEditChart`, `onDeleteChart`, `onInsertChartAfter`, `onAddChord`,
    `onAddSection`.
  - The exact prop list is finalized against the real state names during
    implementation; any state the mobile view needs that isn't already lifted
    stays owned by `PracticePage` and is passed down (no state extraction).
- **New `MobileChordGrid.jsx`** — the density grid for one expanded item:
  section labels (sticky), the CSS-grid of chart tiles, the enlarge overlay,
  and edit-mode overlays. Renders charts with the existing `MemoizedChordChart`
  (exported from `PracticePage.jsx`; import it, or hoist it to its own module if
  that import creates a cycle — decide during implementation).
- Reuses `useIsMobile` (`@hooks/useIsMobile`).

### The critical chord-chart rule

Charts render at 3-/4-across by **scaling the finished SVG into a smaller
container**, never by changing the SVGuitar config. Keep the existing config;
set `svg { width:100%; height:100% }`, container `aspect-ratio: 144/154`. SVG
scaling is uniform so dot geometry is preserved at every size.
- 4-across: dots only (strip the finger-number element from each finger tuple).
- 3-across: finger numbers on.
- Enlarge overlay: 250×268 with finger numbers.
- Barres keep `barreChordStyle:'arc'`, `fret+1` compensation, and the
  white-fill post-process on dark backgrounds (carried from CC project memory).

## Density persistence

- **Model:** add `chord_density = Column(SmallInteger, default=4, nullable=False)`
  to `UserPreferences` (app/models.py). Alembic migration (default 4 for
  existing rows).
- **Endpoint:** follow the existing `/api/user/*` pattern (e.g. api-key routes).
  Prefer extending/adding a small preferences route:
  - `GET /api/user/preferences` → `{ chord_density: 4, ... }` (create-on-read
    default if no row yet), and
  - `POST /api/user/preferences` `{ chord_density: 3|4 }` → validates ∈ {3,4},
    upserts, returns saved value.
  (If a general preferences GET/POST already exists, extend it instead of adding
  a parallel one — check during implementation.)
- **Client:** `localStorage` mirror (`gpra_chord_density`) for instant first
  paint; on load, read localStorage → render immediately, then reconcile with
  the server value; on toggle, update state + localStorage + POST. Server is the
  source of truth across devices.
- Default 4-across.

## State (new, mobile-only)

- `density` (3|4) — from persistence above.
- `enlargedChord` (chart id | null) — session only.
- `editMode` per chord-section (bool) — session only.
- Existing state (timers, completedItems, expandedItems, chordSections) unchanged
  and owned by `PracticePage`.

## Design tokens

Per handoff: page `#020817`; surfaces `#111827`/`#1f2937`/`#374151`; accent
`#f97316` (active) / `#fb923c` (labels); green `#22c55e`; row height 52px; tap
targets ≥44px; top bar 52px; mono for times/tunings. Reuse existing Tailwind
gray/orange classes where they map (keeps light-mode overrides working); use
inline styles for exact sizes (Tailwind-purge gotcha).

## Testing

Live in the in-app browser at 375px with a logged-in account:
1. Sticky top bar shows routine name + `mm:ss / mm:ss · N items` + reset.
2. Rows expand/collapse; completion circle toggles line-through.
3. Timer ▶ starts/stops; elapsed updates in the strip and top bar.
4. Density toggle 3↔4 re-renders charts (numbers only at 3); **persists across
   reload** and reflects server value.
5. Tap chart → enlarge overlay (numbers on); close returns.
6. Edit mode → per-tile edit/delete overlays; edit opens the existing editor.
7. Sticky section labels stack below the 52px top bar.
8. Desktop (≥640px) Practice page unchanged (regression check).

## Risks / notes

- `MemoizedChordChart` import from a 6,100-line module: watch for an import
  cycle when `MobileChordGrid` imports it; hoist to `MemoizedChordChart.jsx` if
  needed.
- Prop bundle size: acceptable and intentional (documents the dependency
  surface). If it balloons past ~20, consider a small internal context — decide
  during implementation, don't pre-optimize.
- The mobile top bar replaces the app header only on Practice; confirm the fixed
  header/`headerHeight` logic in `main.jsx` doesn't double up with the new 52px
  bar on mobile (may need the app header hidden on Practice-mobile).
