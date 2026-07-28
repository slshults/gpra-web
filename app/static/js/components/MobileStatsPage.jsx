// app/static/js/components/MobileStatsPage.jsx
// Mobile Stats page (design 5b). Rendered by StatsPage below the 640px
// breakpoint; StatsPage stays the owner of all fetching, tracking and consent
// state and passes what this view needs as props.
//
// Same data and the same /api/user/practice-stats periods as desktop — this is a
// layout re-skin. Two deliberate differences from the desktop page:
//   * period chips replace the Radix Select (a native-feeling row of taps beats a
//     dropdown on a phone), using short labels since the caption already says
//     which period is in view;
//   * the hero chart is bars, not the desktop AreaChart. With one to three
//     practice days in a week an area chart reads as a meaningless slope.
// The bars are hand-rolled flex rather than Recharts: at 110px tall the design
// calls for 9.5px value labels above each bar and 2px stubs for empty buckets,
// which is a handful of divs here and a fight with ResponsiveContainer there.
import { CalendarDays, CheckCircle2, Clock, Loader2, Timer } from 'lucide-react';
import { formatCount, formatDuration } from '@components/stats/formatters';
import { buildBars, formatBarValue } from '@components/stats/mobileBars';

const PERIOD_CHIPS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
];

// Caption beside the hero total — "24m total · this week"
const PERIOD_CAPTIONS = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  year: 'this year',
  all: 'all time',
};

const BAR_MAX_HEIGHT = 80;

const STAT_CARDS = [
  { key: 'days_practiced', label: 'Days practiced', icon: CalendarDays, format: formatCount },
  { key: 'items_completed', label: 'Items completed', icon: CheckCircle2, format: formatCount },
  { key: 'avg_item_seconds', label: 'Avg time per item', icon: Timer, format: formatDuration },
  { key: 'total_practice_seconds', label: 'Total practice time', icon: Clock, format: formatDuration },
];

const StatCard = ({ icon: Icon, value, label }) => (
  <div
    className="flex items-center ph-no-capture"
    style={{
      backgroundColor: '#111827',
      border: '1px solid #1f2937',
      borderRadius: '12px',
      height: '56px',
      gap: '10px',
      padding: '0 12px',
      boxSizing: 'border-box',
    }}
  >
    <div
      className="flex items-center justify-center shrink-0"
      style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: 'rgba(249,115,22,0.12)' }}
    >
      <Icon size={16} color="#fb923c" />
    </div>
    <div className="min-w-0">
      <div className="font-bold truncate" style={{ fontSize: '17px', color: '#f3f4f6', lineHeight: 1.15 }}>
        {value}
      </div>
      <div style={{ fontSize: '10.5px', color: '#6b7280' }}>{label}</div>
    </div>
  </div>
);

const HeroChart = ({ period, data }) => {
  const bars = buildBars(period, data.daily);
  const peak = Math.max(...bars.map((b) => b.minutes), 1);

  return (
    <div
      className="ph-no-capture"
      style={{
        margin: '10px 12px 0',
        backgroundColor: '#111827',
        border: '1px solid #1f2937',
        borderRadius: '14px',
        padding: '14px',
        boxSizing: 'border-box',
      }}
    >
      <div className="flex items-baseline" style={{ gap: '8px' }}>
        <span className="font-extrabold" style={{ fontSize: '30px', color: '#f3f4f6' }}>
          {formatDuration(data.summary?.total_practice_seconds)}
        </span>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>total · {PERIOD_CAPTIONS[period]}</span>
      </div>

      <div className="flex items-end" style={{ height: '110px', gap: '6px', marginTop: '12px' }}>
        {bars.map((bar, i) => (
          <div
            key={`${bar.label}-${i}`}
            className="flex flex-col items-center justify-end"
            style={{ flex: 1, gap: '4px', height: '100%' }}
          >
            <span style={{ fontSize: '9.5px', color: '#9ca3af' }}>
              {bar.minutes ? formatBarValue(bar.minutes) : ''}
            </span>
            <div
              style={{
                width: '100%',
                maxWidth: '30px',
                borderRadius: '4px 4px 0 0',
                // Empty buckets keep a 2px stub so the axis still reads as a row of days
                height: bar.minutes ? `${Math.max(6, Math.round((bar.minutes / peak) * BAR_MAX_HEIGHT))}px` : '2px',
                backgroundColor: bar.minutes ? '#f97316' : '#1f2937',
              }}
            />
            <span style={{ fontSize: '9.5px', color: '#6b7280' }}>{bar.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TopItems = ({ items }) => {
  if (!items?.length) return null;
  const peak = Math.max(...items.map((i) => i.total_seconds || 0), 1);

  return (
    <>
      <div
        className="font-bold uppercase"
        style={{ padding: '20px 16px 0', fontSize: '11px', letterSpacing: '0.08em', color: '#6b7280' }}
      >
        Top items
      </div>
      <div className="flex flex-col ph-no-capture" style={{ padding: '2px 16px 0' }}>
        {items.map((item, i) => (
          <div
            // Two practice items can share a title, so the name alone isn't a key
            key={`${item.item_name}-${i}`}
            className="flex flex-col"
            style={{ padding: '10px 0', borderBottom: '1px solid #1f2937', gap: '6px' }}
          >
            <div className="flex items-center justify-between" style={{ gap: '8px' }}>
              <span className="truncate" style={{ fontSize: '14px', color: '#f3f4f6' }}>
                {item.item_name}
              </span>
              <span
                className="shrink-0"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', color: '#9ca3af' }}
              >
                {formatDuration(item.total_seconds)}
              </span>
            </div>
            <div style={{ height: '4px', borderRadius: '2px', backgroundColor: '#1f2937' }}>
              <div
                style={{
                  height: '4px',
                  borderRadius: '2px',
                  backgroundColor: '#f97316',
                  width: `${Math.round(((item.total_seconds || 0) / peak) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

const MobileStatsPage = ({
  period,
  onPeriodChange,
  data,
  loading,
  error,
  onRetry,
  showEmptyHint,
  isFreeTier = false,
  onUpsellClick,
}) => (
  <div style={{ padding: '0 0 64px', boxSizing: 'border-box' }}>
    {/* Sticky top bar — replaces the app title + gear + logout block on mobile */}
    <div
      className="sticky flex items-center"
      style={{
        top: 0,
        zIndex: 40,
        height: '52px',
        padding: '0 14px',
        backgroundColor: 'rgba(17,24,39,0.96)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '1px solid #1f2937',
      }}
    >
      <div className="font-bold" style={{ fontSize: '17px', color: '#f3f4f6' }}>Stats</div>
    </div>

    {isFreeTier ? (
      <div
        className="text-center"
        style={{
          margin: '16px 12px 0',
          backgroundColor: '#111827',
          border: '1px solid #1f2937',
          borderRadius: '14px',
          padding: '24px 16px',
        }}
      >
        <div className="font-bold" style={{ fontSize: '16px', color: '#f3f4f6' }}>Practice stats</div>
        <p style={{ fontSize: '13px', color: '#9ca3af', margin: '10px 0 18px' }}>
          Upgrade to a paid plan to see your practice statistics, including daily practice time, most
          practiced items, and session trends.
        </p>
        <button
          type="button"
          onClick={onUpsellClick}
          className="font-bold"
          style={{ height: '44px', padding: '0 20px', borderRadius: '10px', backgroundColor: '#f97316', color: '#111827', fontSize: '14px' }}
          data-ph-capture-attribute-button="mobile-stats-view-plans"
        >
          View plans
        </button>
      </div>
    ) : (
      <>
      {/* Period chips — the mobile stand-in for the desktop Select */}
      <div className="flex" style={{ padding: '12px 12px 4px', gap: '8px', overflowX: 'auto' }}>
        {PERIOD_CHIPS.map((chip) => {
          const active = chip.value === period;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => onPeriodChange(chip.value)}
              className="flex items-center font-semibold shrink-0"
              style={{
                height: '32px',
                padding: '0 14px',
                borderRadius: '99px',
                fontSize: '13px',
                backgroundColor: active ? '#f97316' : 'transparent',
                color: active ? '#111827' : '#9ca3af',
                border: `1px solid ${active ? '#f97316' : '#374151'}`,
                boxSizing: 'border-box',
              }}
              aria-pressed={active}
              data-ph-capture-attribute-button={`mobile-stats-period-${chip.value}`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center justify-center" style={{ padding: '64px 0', color: '#9ca3af' }}>
          <Loader2 className="animate-spin" size={22} color="#fb923c" />
          <span style={{ marginLeft: '8px', fontSize: '13px' }}>Loading stats...</span>
        </div>
      )}

      {error && !loading && (
        <div
          className="text-center"
          style={{
            margin: '10px 12px 0',
            backgroundColor: '#111827',
            border: '1px solid #7f1d1d',
            borderRadius: '12px',
            padding: '16px',
          }}
        >
          <p style={{ fontSize: '13px', color: '#f87171' }}>Failed to load practice stats: {error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="font-semibold"
            style={{ marginTop: '10px', fontSize: '13px', color: '#fb923c', minHeight: '44px', padding: '0 12px' }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {showEmptyHint && (
            <div
              style={{
                margin: '10px 12px 0',
                backgroundColor: 'rgba(124,45,18,0.2)',
                border: '1px solid rgba(194,65,12,0.6)',
                borderRadius: '12px',
                padding: '12px',
                fontSize: '13px',
                color: '#e5e7eb',
              }}
            >
              No stats yet. Use the timers and 'Mark done' buttons on the{' '}
              <a href="/#Practice" style={{ color: '#fb923c' }}>Practice</a> page, then come back later to see your
              stats. (Keep cookies enabled to track stats.)
            </div>
          )}
          <HeroChart period={period} data={data} />
          <div style={{ margin: '8px 12px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {STAT_CARDS.map(({ key, label, icon, format }) => (
              <StatCard key={key} icon={icon} value={format(data.summary?.[key])} label={label} />
            ))}
          </div>
          <TopItems items={data.top_items} />
      </>
    )}
      </>
    )}
  </div>
);

export default MobileStatsPage;
