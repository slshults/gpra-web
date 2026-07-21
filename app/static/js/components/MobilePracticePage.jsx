// app/static/js/components/MobilePracticePage.jsx
// Mobile Practice-page list state (design 2a). Rendered by PracticePage below
// the 640px breakpoint; PracticePage stays the owner of all practice state and
// passes the subset this view needs (plus handlers) as props.
import { useState, useEffect, useCallback } from 'react';
import { Check, ChevronDown, ChevronRight, Music, RotateCcw, Play } from 'lucide-react';
import MobileChordGrid from '@components/MobileChordGrid';
import MobilePlayMode from '@components/MobilePlayMode';
import { useChordDensity } from '@hooks/useChordDensity';

const fmt = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};

const MobilePracticePage = ({
  routine,
  getItemDetails,
  completedItems,
  activeTimers,
  timers,
  expandedItems,
  chordSections,
  totalMinutes,
  completedMinutes,
  onToggleItem,
  onToggleTimer,
  onToggleComplete,
  onResetProgress,
  onLoadChordCharts,
}) => {
  const { density, changeDensity } = useChordDensity();
  const [playModeEntryId, setPlayModeEntryId] = useState(null);
  const items = routine?.items || [];

  // The list ▶ launches Play mode: start the timer if it isn't already running,
  // then go full-screen. (Product decision: ▶ always enters Play mode.)
  const launchPlayMode = (entryId, e) => {
    e?.stopPropagation();
    if (!activeTimers.has(entryId)) onToggleTimer(entryId, e);
    setPlayModeEntryId(entryId);
  };

  // Stable identities so Play mode's effects (Escape listener, auto-advance)
  // don't re-subscribe on every parent render.
  const exitPlayMode = useCallback(() => setPlayModeEntryId(null), []);
  const navigatePlayMode = useCallback((id) => setPlayModeEntryId(id), []);

  // Ensure chords load for any expanded item (loadChordChartsForItem no-ops if
  // already cached). Mirrors the desktop lazy-load, but on mobile chords are
  // always shown when an item is expanded.
  useEffect(() => {
    expandedItems.forEach(entryId => {
      const ri = items.find(i => i['A'] === entryId);
      if (ri) onLoadChordCharts(ri['B']);
    });
  }, [expandedItems, items, onLoadChordCharts]);

  const secondsFor = (entryId, durationMin) => {
    const t = timers[entryId];
    return typeof t === 'number' ? t : durationMin * 60;
  };

  return (
    <>
    <div style={{ padding: '10px 12px 64px', boxSizing: 'border-box' }}>
      {/* Sticky top bar */}
      <div
        className="sticky flex items-center justify-between"
        style={{
          top: 0,
          zIndex: 40,
          height: '52px',
          margin: '0 -12px 10px',
          padding: '0 14px',
          backgroundColor: 'rgba(17,24,39,0.96)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid #1f2937',
        }}
      >
        <div className="min-w-0">
          <div className="font-bold truncate" style={{ fontSize: '15px', color: '#f3f4f6' }}>
            {routine?.name || 'Practice'}
          </div>
          <div style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {completedMinutes}/{totalMinutes} min · {items.length} item{items.length === 1 ? '' : 's'}
          </div>
        </div>
        <button
          onClick={onResetProgress}
          className="flex items-center justify-center shrink-0"
          style={{ width: '36px', height: '36px', border: '1px solid #1f2937', borderRadius: '8px', color: '#9ca3af' }}
          aria-label="Reset progress"
          data-ph-capture-attribute-button="mobile-reset-progress"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Item rows */}
      <div className="flex flex-col" style={{ gap: '8px' }}>
        {items.map(item => {
          const entryId = item['A'];
          const itemId = item['B'];
          const details = getItemDetails(itemId);
          // minimalDetails carries the title without a full details fetch;
          // full details (with duration) load lazily on expand.
          const name = item.minimalDetails?.['C'] || details?.['C'] || 'Untitled item';
          const durationMin = parseInt(details?.['E'], 10) || 5;
          const done = completedItems.has(entryId);
          const expanded = expandedItems.has(entryId);
          const timerActive = activeTimers.has(entryId);
          const sections = chordSections[itemId] || [];
          const tuning = sections[0]?.chords?.[0]?.tuning || '';

          return (
            <div key={entryId} style={expanded ? { border: '1px solid #374151', borderRadius: '12px' } : undefined}>
              {/* Row header */}
              <div
                data-item-header={entryId}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => onToggleItem(entryId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleItem(entryId);
                  }
                }}
                className="flex items-center cursor-pointer"
                style={{
                  height: '52px',
                  backgroundColor: '#1f2937',
                  borderRadius: expanded ? '12px 12px 0 0' : '10px',
                  padding: '0 14px',
                  gap: '10px',
                }}
              >
                <button
                  onClick={(e) => onToggleComplete(entryId, e)}
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: '22px', height: '22px', borderRadius: '99px',
                    border: done ? 'none' : '2px solid #9ca3af',
                    backgroundColor: done ? '#22c55e' : 'transparent',
                  }}
                  aria-label={done ? 'Mark not done' : 'Mark done'}
                  data-ph-capture-attribute-button="mobile-toggle-complete"
                >
                  {done && <Check size={14} color="#ffffff" strokeWidth={3} />}
                </button>
                <span
                  className="flex-1 truncate"
                  style={{
                    fontSize: '15px',
                    color: done ? '#6b7280' : '#f3f4f6',
                    fontWeight: expanded ? 600 : 400,
                    textDecoration: done ? 'line-through' : 'none',
                  }}
                >
                  {name}
                </span>
                <span style={{ fontSize: '13px', color: '#9ca3af', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {fmt(secondsFor(entryId, durationMin))}
                </span>
                {expanded ? <ChevronDown size={16} color="#6b7280" /> : <ChevronRight size={16} color="#6b7280" />}
              </div>

              {/* Expanded body */}
              {expanded && (
                <div style={{ backgroundColor: '#1f2937', borderRadius: '0 0 12px 12px', padding: '0 10px 10px' }}>
                  {/* Timer strip */}
                  <div
                    className="flex items-center"
                    style={{ backgroundColor: '#111827', borderRadius: '10px', padding: '10px 12px', gap: '12px', marginBottom: '10px' }}
                  >
                    <button
                      onClick={(e) => launchPlayMode(entryId, e)}
                      className="flex items-center justify-center shrink-0"
                      style={{ width: '52px', height: '52px', borderRadius: '99px', backgroundColor: '#16351f', border: '2px solid #22c55e' }}
                      aria-label="Open Play mode"
                      data-ph-capture-attribute-button="mobile-launch-play-mode"
                    >
                      <Play size={22} color="#22c55e" fill="#22c55e" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: '30px', color: '#f3f4f6', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1 }}>
                        {fmt(secondsFor(entryId, durationMin))}
                      </div>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                        {timerActive ? 'Timer running · ▶ opens Play mode' : '▶ opens Play mode'}
                      </div>
                    </div>
                    <button
                      onClick={(e) => onToggleComplete(entryId, e)}
                      className="shrink-0"
                      style={{ height: '44px', padding: '0 16px', borderRadius: '8px', border: '1px solid #374151', color: '#f3f4f6', fontSize: '14px' }}
                      data-ph-capture-attribute-button="mobile-done"
                    >
                      {done ? 'Undo' : 'Done'}
                    </button>
                  </div>

                  {/* Chords header + density toggle */}
                  <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                    <div className="flex items-center min-w-0" style={{ gap: '6px' }}>
                      <Music size={14} color="#f3f4f6" />
                      <span className="font-semibold" style={{ fontSize: '14px', color: '#f3f4f6' }}>Chords</span>
                      {tuning && (
                        <span className="truncate" style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{tuning}</span>
                      )}
                    </div>
                    <div className="flex shrink-0" style={{ border: '1px solid #374151', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#111827' }}>
                      {[3, 4].map(n => (
                        <button
                          key={n}
                          onClick={() => changeDensity(n)}
                          style={{
                            width: '40px', height: '32px', fontSize: '13px', fontWeight: 600,
                            backgroundColor: density === n ? '#f97316' : 'transparent',
                            color: density === n ? '#111827' : '#9ca3af',
                          }}
                          aria-pressed={density === n}
                          data-ph-capture-attribute-button={`mobile-density-${n}`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Chord density grid */}
                  <MobileChordGrid sections={sections} density={density} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    {playModeEntryId && (
      <MobilePlayMode
        routine={routine}
        entryId={playModeEntryId}
        getItemDetails={getItemDetails}
        timers={timers}
        activeTimers={activeTimers}
        completedItems={completedItems}
        chordSections={chordSections}
        onToggleTimer={onToggleTimer}
        onToggleComplete={onToggleComplete}
        onExit={exitPlayMode}
        onNavigate={navigatePlayMode}
        onLoadChordCharts={onLoadChordCharts}
      />
    )}
    </>
  );
};

export default MobilePracticePage;
