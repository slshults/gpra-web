// app/static/js/components/MobilePlayMode.jsx
// Full-screen hands-free practice view (design 2a play state). Launched from the
// Practice list ▶; renders over everything. PracticePage still owns all timer /
// completion / chord state — this is a focused view of one item plus a few
// local concerns (auto-scroll speed, wake lock).
import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { ChevronDown, Play, Pause } from 'lucide-react';
import MobileChordChart from '@components/MobileChordChart';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SCROLL_SPEEDS = { off: 0, slow: 8, med: 16, fast: 28 }; // px per second
const SCROLL_KEY = 'gpra_autoscroll_speed';

const readScrollSpeed = () => {
  const v = localStorage.getItem(SCROLL_KEY);
  return ['off', 'slow', 'med', 'fast'].includes(v) ? v : 'off';
};

const fmt = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

const MobilePlayMode = ({
  routine,
  entryId,
  getItemDetails,
  timers,
  activeTimers,
  completedItems,
  chordSections,
  onToggleTimer,
  onToggleComplete,
  onExit,
  onNavigate,
  onLoadChordCharts,
}) => {
  const items = routine?.items || [];
  const index = items.findIndex(i => i['A'] === entryId);
  const item = items[index];
  const itemId = item?.['B'];
  const details = getItemDetails(itemId);
  const name = item?.minimalDetails?.['C'] || details?.['C'] || 'Untitled item';
  const durationSec = (parseInt(details?.['E'], 10) || 5) * 60;
  const remaining = typeof timers[entryId] === 'number' ? timers[entryId] : durationSec;
  const running = activeTimers.has(entryId);
  // Stable reference so the auto-scroll effect doesn't re-run on unrelated
  // re-renders (a bare `|| []` yields a fresh array each render).
  const sections = useMemo(() => chordSections[itemId] || [], [chordSections, itemId]);
  const prevItem = index > 0 ? items[index - 1] : null;
  const nextItem = index >= 0 && index < items.length - 1 ? items[index + 1] : null;

  const [scrollSpeed, setScrollSpeed] = useState(readScrollSpeed);
  const scrollRef = useRef(null);

  // Load the current item's chords (no-ops if already cached).
  useEffect(() => {
    if (itemId) onLoadChordCharts(itemId);
  }, [itemId, onLoadChordCharts]);

  // Auto-advance: when the running timer crosses to 0, mark done + return to
  // the list. The ref tracks (entryId, remaining) together so a genuine
  // crossing is only detected WITHIN one item — navigating to an item that is
  // already at 0 (e.g. a background timer that finished) must not count as a
  // crossing. Only completes if not already done (onToggleComplete is a toggle,
  // so calling it on a done item would un-complete it).
  const prevRef = useRef({ entryId, remaining });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { entryId, remaining };
    if (running && prev.entryId === entryId && prev.remaining > 0 && remaining === 0) {
      if (!completedItems.has(entryId)) onToggleComplete(entryId);
      window.posthog?.capture('play_mode_auto_advanced', { routine_name: routine?.name, item_title: name });
      onExit();
    }
  }, [remaining, running, entryId, completedItems, onToggleComplete, onExit, routine, name]);

  // Auto-scroll the chord area when a speed is set and it overflows.
  useEffect(() => {
    const pxPerSec = SCROLL_SPEEDS[scrollSpeed] || 0;
    const el = scrollRef.current;
    if (!pxPerSec || !el) return;
    let raf;
    let last = null;
    // Keep the true position in a float — scrollTop rounds to an integer on
    // write, so a sub-pixel-per-frame increment read back from scrollTop would
    // never accumulate.
    let pos = el.scrollTop;
    const step = (t) => {
      if (last != null) {
        pos += pxPerSec * ((t - last) / 1000);
        el.scrollTop = pos;
        if (pos + el.clientHeight >= el.scrollHeight - 1) return; // stop at bottom
      }
      last = t;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scrollSpeed, sections]);

  // Keep the screen awake while in Play mode; re-acquire when the tab becomes
  // visible again. Granted silently (no permission dialog); if the API is
  // unsupported or rejects, the screen simply won't stay awake.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return undefined;
    let sentinel = null;
    let disposed = false;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (disposed) sentinel.release().catch(() => {});
      } catch { /* unsupported or rejected */ }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVis);
      if (sentinel) sentinel.release().catch(() => {});
    };
  }, []);

  // Escape exits Play mode (matches the ▾ control).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onExit(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onExit]);

  const changeScroll = (speed) => {
    setScrollSpeed(speed);
    localStorage.setItem(SCROLL_KEY, speed);
    window.posthog?.capture('play_mode_scroll_speed_changed', { speed });
  };

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 80, backgroundColor: '#020817' }}>
      {/* Header */}
      <div className="flex items-center" style={{ padding: '12px 14px', gap: '10px' }}>
        <button
          onClick={onExit}
          className="flex items-center justify-center shrink-0"
          style={{ width: '44px', height: '44px', color: '#9ca3af' }}
          aria-label="Collapse to list"
          data-ph-capture-attribute-button="play-mode-exit"
        >
          <ChevronDown size={24} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate" style={{ fontSize: '16px', color: '#f3f4f6' }}>{name}</div>
          <div className="truncate" style={{ fontSize: '11px', color: '#6b7280' }}>
            {index + 1} of {items.length} · {routine?.name}
          </div>
        </div>
        <div style={{ fontSize: '24px', color: '#f3f4f6', fontFamily: MONO }}>{fmt(remaining)}</div>
        <button
          onClick={() => onToggleTimer(entryId)}
          className="flex items-center justify-center shrink-0"
          style={{ width: '44px', height: '44px', borderRadius: '99px', border: '2px solid #4b5563' }}
          aria-label={running ? 'Pause timer' : 'Start timer'}
          data-ph-capture-attribute-button="play-mode-play-pause"
        >
          {running
            ? <Pause size={20} color="#ef4444" fill="#ef4444" />
            : <Play size={20} color="#22c55e" fill="#22c55e" />}
        </button>
      </div>

      {/* Pills row */}
      <div className="flex items-center" style={{ gap: '8px', padding: '10px 14px', flexWrap: 'wrap' }}>
        <span className="font-bold" style={{ fontSize: '10px', letterSpacing: '0.04em', color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: '99px', padding: '3px 8px' }}>
          AUTO-ADVANCE
        </span>
        <div className="flex items-center" style={{ gap: '6px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', color: '#6b7280' }}>SCROLL</span>
          <div className="flex" style={{ border: '1px solid #374151', borderRadius: '99px', overflow: 'hidden' }}>
            {['off', 'slow', 'med', 'fast'].map(s => (
              <button
                key={s}
                onClick={() => changeScroll(s)}
                style={{
                  minWidth: '44px', height: '24px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                  backgroundColor: scrollSpeed === s ? '#f97316' : 'transparent',
                  color: scrollSpeed === s ? '#111827' : '#9ca3af',
                }}
                aria-pressed={scrollSpeed === s}
                data-ph-capture-attribute-button={`play-mode-scroll-${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chord area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ padding: '0 14px 14px' }}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
          {sections.map(section => (
            <Fragment key={section.id}>
              {section.label && (
                <div className="flex items-center justify-between" style={{ gridColumn: '1 / -1', borderTop: '1px solid #1f2937', paddingTop: '6px', marginTop: '2px' }}>
                  <span className="uppercase font-bold" style={{ fontSize: '11px', letterSpacing: '0.06em', color: '#fb923c' }}>{section.label}</span>
                  {section.repeatCount && (
                    <span className="font-bold" style={{ fontSize: '10px', color: '#9ca3af', backgroundColor: '#1f2937', borderRadius: '99px', padding: '1px 8px' }}>{section.repeatCount}</span>
                  )}
                </div>
              )}
              {section.chords.map(chart => (
                <div key={chart.id} className="flex flex-col items-center" style={{ backgroundColor: '#111827', borderRadius: '8px', padding: '4px 4px 2px' }}>
                  <div style={{ width: '100%', aspectRatio: '144 / 154' }}>
                    <MobileChordChart chart={chart} showFingers={false} />
                  </div>
                  <span className="font-semibold text-center truncate w-full" style={{ fontSize: '12px', color: '#d1d5db' }}>{chart.title}</span>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Prev / next zones */}
      <div className="flex" style={{ borderTop: '1px solid #1f2937' }}>
        <button
          onClick={() => prevItem && onNavigate(prevItem['A'])}
          disabled={!prevItem}
          className="flex items-center"
          style={{ width: '50%', height: '64px', padding: '0 16px', backgroundColor: '#111827', color: prevItem ? '#9ca3af' : '#374151', borderRight: '1px solid #020817' }}
          data-ph-capture-attribute-button="play-mode-prev"
        >
          <span className="truncate" style={{ minWidth: 0 }}>
            {prevItem ? `‹ ${prevItem.minimalDetails?.['C'] || 'Previous'}` : ''}
          </span>
        </button>
        <button
          onClick={() => nextItem && onNavigate(nextItem['A'])}
          disabled={!nextItem}
          className="flex items-center justify-end font-bold"
          style={{ width: '50%', height: '64px', padding: '0 16px', backgroundColor: '#111827', color: nextItem ? '#f3f4f6' : '#374151' }}
          data-ph-capture-attribute-button="play-mode-next"
        >
          <span className="truncate" style={{ minWidth: 0 }}>
            {nextItem ? `${nextItem.minimalDetails?.['C'] || 'Next'} ›` : ''}
          </span>
        </button>
      </div>
    </div>
  );
};

export default MobilePlayMode;
