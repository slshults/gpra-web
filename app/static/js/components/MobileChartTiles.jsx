// app/static/js/components/MobileChartTiles.jsx
// A dense grid of scaled chord tiles + a tap-to-enlarge overlay, for one
// section's chords. Shared by the Practice-page density grid (view-only) and
// the Items/Routines chord modal (with edit actions).
//
// Pass onEdit / onDelete / onInsertAfter (each called with the chart object) to
// surface Edit / + Insert-after / Delete buttons in the enlarge overlay. Omit
// them for a view-only grid.
import { useState, useEffect } from 'react';
import MobileChordChart from '@components/MobileChordChart';

const MobileChartTiles = ({ chords, density, onEdit, onDelete, onInsertAfter }) => {
  const [enlarged, setEnlarged] = useState(null); // chart object | null
  const showFingers = density === 3; // numbers only at 3-across
  const cols = density; // 3 or 4

  // Close the enlarge overlay on Escape (backdrop tap also closes it).
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e) => { if (e.key === 'Escape') setEnlarged(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enlarged]);

  // Run an action against the enlarged chart, closing the overlay first.
  const act = (handler) => {
    const chart = enlarged;
    setEnlarged(null);
    handler(chart);
  };

  return (
    <>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {chords.map(chart => (
          <button
            key={chart.id}
            onClick={() => setEnlarged(chart)}
            className="flex flex-col items-center"
            style={{ backgroundColor: '#111827', borderRadius: '8px', padding: '4px 4px 2px' }}
            data-ph-capture-attribute-button="mobile-chord-tile"
          >
            <div style={{ width: '100%', aspectRatio: '144 / 154' }}>
              <MobileChordChart chart={chart} showFingers={showFingers} />
            </div>
            <span className="font-semibold text-center truncate w-full" style={{ fontSize: '12px', color: '#d1d5db' }}>
              {chart.title}
            </span>
          </button>
        ))}
      </div>

      {/* Enlarge overlay — always shows finger numbers */}
      {enlarged && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 70, backgroundColor: 'rgba(2,8,23,0.88)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', padding: '16px' }}
          onClick={() => setEnlarged(null)}
        >
          <div
            className="flex flex-col items-center"
            style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '16px', padding: '20px', maxWidth: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="font-bold mb-2" style={{ fontSize: '22px', color: '#f3f4f6' }}>{enlarged.title}</div>
            <div style={{ width: '250px', maxWidth: '100%', height: '268px' }}>
              <MobileChordChart chart={enlarged} showFingers={true} />
            </div>
            <div className="flex flex-wrap justify-center mt-3" style={{ gap: '8px' }}>
              {onEdit && (
                <button
                  onClick={() => act(onEdit)}
                  className="font-semibold"
                  style={{ height: '44px', padding: '0 16px', borderRadius: '10px', backgroundColor: '#2563eb', color: '#ffffff' }}
                  data-ph-capture-attribute-button="mobile-chord-overlay-edit"
                >
                  ✏️ Edit
                </button>
              )}
              {onInsertAfter && (
                <button
                  onClick={() => act(onInsertAfter)}
                  className="font-semibold"
                  style={{ height: '44px', padding: '0 16px', borderRadius: '10px', border: '1px solid #374151', color: '#f3f4f6' }}
                  data-ph-capture-attribute-button="mobile-chord-overlay-insert"
                >
                  + Insert after
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => act(onDelete)}
                  className="font-semibold"
                  style={{ height: '44px', padding: '0 16px', borderRadius: '10px', border: '1px solid #374151', color: '#ef4444' }}
                  data-ph-capture-attribute-button="mobile-chord-overlay-delete"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setEnlarged(null)}
                className="font-semibold"
                style={{ height: '44px', padding: '0 16px', borderRadius: '10px', border: '1px solid #374151', color: '#f3f4f6' }}
                data-ph-capture-attribute-button="mobile-chord-enlarge-close"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileChartTiles;
