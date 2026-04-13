// Shared formatters for practice stats charts and cards.
// All input values are seconds (from PostHog), output is human-readable.

export const formatDuration = (totalSeconds) => {
  if (!totalSeconds) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
};

// Chart axis tick formatter. Input is already in minutes.
export const formatAxisMinutes = (mins) => {
  if (mins >= 60) {
    const h = mins / 60;
    return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
  }
  return `${mins}m`;
};
