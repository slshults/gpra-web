// Bucketing for the mobile Stats hero chart (design 5b).
//
// /api/user/practice-stats always returns `daily` as one row per day that had
// practice ({practice_date: 'YYYY-MM-DD', total_seconds}), whatever the period —
// days with no practice are simply absent. The mobile chart wants a bar for
// every bucket in the window (empty ones render as 2px stubs), at a granularity
// that suits the period: days for Today/Week, weeks for Month, months for Year,
// years for All. So we generate the buckets and fill them from the rows.

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

// Local-date key matching the server's 'YYYY-MM-DD' strings. Built from local
// getters rather than toISOString() so we don't shift a day in either direction.
const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const minutesOf = (seconds) => Math.round((seconds || 0) / 60);

// Sum seconds for every row whose practice_date starts with the given prefix
// ('2026-07' for a month, '2026' for a year).
const sumByPrefix = (rows, prefix) =>
  rows.reduce((total, r) => (String(r.practice_date || '').startsWith(prefix) ? total + (r.total_seconds || 0) : total), 0);

const buildDayBars = (rows, count) => {
  const byDay = new Map();
  rows.forEach((r) => {
    byDay.set(r.practice_date, (byDay.get(r.practice_date) || 0) + (r.total_seconds || 0));
  });

  const today = startOfToday();
  const bars = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    bars.push({
      label: WEEKDAY_INITIALS[day.getDay()],
      minutes: minutesOf(byDay.get(dateKey(day))),
    });
  }
  return bars;
};

// Five equal buckets across the 30-day window, oldest first. Six days rather
// than seven so every bucket is the same width — with 7-day buckets the 30-day
// window leaves a 2-day remainder that would always render as a slump, and the
// bars would no longer add up to the total shown above them.
const buildWeekBars = (rows, windowDays = 30, bucketDays = 6) => {
  const byDay = new Map();
  rows.forEach((r) => {
    byDay.set(r.practice_date, (byDay.get(r.practice_date) || 0) + (r.total_seconds || 0));
  });

  const start = addDays(startOfToday(), -(windowDays - 1));
  const bucketCount = Math.ceil(windowDays / bucketDays);
  const bars = [];
  for (let b = 0; b < bucketCount; b++) {
    let seconds = 0;
    for (let d = 0; d < bucketDays; d++) {
      const offset = b * bucketDays + d;
      if (offset >= windowDays) break;
      seconds += byDay.get(dateKey(addDays(start, offset))) || 0;
    }
    // Labelled by the date each bucket starts rather than "W1".."W5" — these are
    // six-day buckets, so calling them weeks would be a small lie.
    const bucketStart = addDays(start, b * bucketDays);
    bars.push({
      label: `${bucketStart.getMonth() + 1}/${bucketStart.getDate()}`,
      minutes: minutesOf(seconds),
    });
  }
  return bars;
};

const buildMonthBars = (rows, count = 12) => {
  const today = startOfToday();
  const bars = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    bars.push({
      label: MONTH_INITIALS[month.getMonth()],
      minutes: minutesOf(sumByPrefix(rows, prefix)),
    });
  }
  return bars;
};

// One bar per year from the earliest year with data through this year, capped at
// 10 so a long history still fits the width.
const buildYearBars = (rows, maxBars = 10) => {
  const thisYear = startOfToday().getFullYear();
  const years = rows
    .map((r) => parseInt(String(r.practice_date || '').slice(0, 4), 10))
    .filter((y) => Number.isFinite(y));
  const earliest = years.length ? Math.min(...years, thisYear) : thisYear;
  const first = Math.max(earliest, thisYear - maxBars + 1);

  const bars = [];
  for (let y = first; y <= thisYear; y++) {
    bars.push({
      label: `'${String(y).slice(2)}`,
      minutes: minutesOf(sumByPrefix(rows, String(y))),
    });
  }
  return bars;
};

export const buildBars = (period, daily) => {
  const rows = daily || [];
  switch (period) {
    case 'today':
      return [{ label: 'Today', minutes: minutesOf(rows.reduce((t, r) => t + (r.total_seconds || 0), 0)) }];
    case 'week':
      return buildDayBars(rows, 7);
    case 'month':
      return buildWeekBars(rows);
    case 'year':
      return buildMonthBars(rows);
    case 'all':
      return buildYearBars(rows);
    default:
      return [];
  }
};

// Compact value label above each bar — "45m" under an hour, "1.5h" over it.
export const formatBarValue = (minutes) =>
  minutes >= 60 ? `${Math.round(minutes / 6) / 10}h` : `${minutes}m`;
