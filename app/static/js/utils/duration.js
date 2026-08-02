// Item duration resolution, shared by every surface that shows or counts it.
//
// Column E is free text minutes and may be fractional: ItemEditor composes it
// as `mins + (secs / 60)`, so "5.5" means 5 min 30 sec and 1 min 50 sec stores
// as 1.8333333333333335.
//
// Item details are a cache-only read that stays null until a row is expanded,
// so always fall back to the copy in the lightweight active-routine payload
// before the default - otherwise collapsed rows silently report 5 minutes.

export const DEFAULT_DURATION_MINUTES = 5;

// The default applies only when there is genuinely no usable value - empty,
// null, or junk. A deliberate 0 is a real duration and stays 0, the same way a
// 1-minute item stays 1. (A plain `|| DEFAULT` would silently turn 0 into 5.)
export const resolveDurationMinutes = (details, minimalDetails) => {
  const parsed = parseFloat(details?.['E'] ?? minimalDetails?.['E']);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DURATION_MINUTES;
};

// Timers tick by whole seconds and test for exactly 0, so a seed must be an
// integer. Seeding 1.8333 * 60 = 110.00000000000001 steps past zero to a tiny
// negative: the completion sound never fires and the display renders "-1:-1".
export const resolveDurationSeconds = (details, minimalDetails) =>
  Math.round(resolveDurationMinutes(details, minimalDetails) * 60);

// Compact label for browse lists: "5 min" when the duration is whole minutes,
// "5:30" when it isn't. Whole minutes answer "how long is this?" more directly
// than a clock reading, but rounding would report a 1 min 50 sec item as
// "2 min" - which is the one place seconds used to get lost.
export const formatDurationLabel = (minutes) => {
  const total = Math.max(0, Math.round(minutes * 60)) || 0; // guards NaN and negatives
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return secs === 0 ? `${mins} min` : `${mins}:${String(secs).padStart(2, '0')}`;
};
