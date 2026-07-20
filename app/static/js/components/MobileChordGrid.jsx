// app/static/js/components/MobileChordGrid.jsx
// Mobile Practice-page chord density grid (design 2a).
// Renders an item's chord sections as a 3- or 4-across grid of scaled charts,
// with sticky section labels and a tap-to-enlarge overlay.
//
// THE critical chord-chart rule: keep the exact SVGuitar config and scale the
// finished SVG into a smaller container. SVG scaling is uniform, so the dot
// geometry is preserved at every size. Density only toggles whether finger
// numbers are drawn (4-across = dots only; 3-across = numbers on).
import { useState, useEffect, useRef } from 'react';

// Matches MemoizedChordChart's proven config (PracticePage.jsx). Do not change
// dimensions per density — only strip finger numbers.
const buildConfig = (chartData) => ({
  strings: chartData.numStrings || 6,
  frets: chartData.numFrets || 5,
  position: chartData.startingFret || 1,
  tuning: [],
  width: 176,
  height: 248,
  fretSize: 1.2,
  fingerSize: 0.75,
  sidePadding: 0.2,
  fontFamily: 'Arial',
  color: '#ffffff',
  backgroundColor: 'transparent',
  strokeColor: '#ffffff',
  textColor: '#ffffff',
  fretLabelColor: '#ffffff',
  barreChordStrokeColor: '#ffffff',
  barreChordStyle: 'arc', // rectangle barres have a black-fill bug in v2.5.1
  fingerTextColor: '#000000',
  fingerTextSize: 28,
});

const buildChordData = (chartData, showFingers) => {
  const fingers = (chartData.fingers || []).map(([string, fret, fingerNumber]) => {
    if (showFingers && fingerNumber && fingerNumber !== 'undefined') {
      return [string, fret, fingerNumber];
    }
    return [string, fret]; // dots-only: drop the finger number
  });
  const allFingers = [
    ...fingers,
    ...(chartData.openStrings || []).map(s => [s, 0]),
    ...(chartData.mutedStrings || []).map(s => [s, 'x']),
  ];
  // Barres render on the arc above the fret; the stored fret already accounts
  // for this (toggleBarre added +1 at author time), so pass through as-is.
  return { fingers: allFingers, barres: chartData.barres || [] };
};

// Force barre paths white on the dark background (arc barres inherit a black
// fill from SVGuitar v2.5.1). Carried from chord-chart project memory.
const whitenBarres = (svg) => {
  svg.querySelectorAll('rect[class*="barre"], path[class*="barre"]').forEach(n => {
    n.setAttribute('fill', '#ffffff');
  });
};

const waitForSvguitar = (cb) => {
  if (window.svguitar) { cb(); return; }
  let tries = 0;
  const id = setInterval(() => {
    tries += 1;
    if (window.svguitar) { clearInterval(id); cb(); }
    else if (tries > 40) { clearInterval(id); } // ~4s, then give up quietly
  }, 100);
};

// One rendered chart. `showFingers` toggles finger numbers; `big` scales it up
// for the enlarge overlay.
const MobileChordChart = ({ chart, showFingers }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    waitForSvguitar(() => {
      if (cancelled || !ref.current) return;
      try {
        const chartData = chart.chordData || chart;
        ref.current.innerHTML = '';
        const instance = new window.svguitar.SVGuitarChord(ref.current);
        instance
          .configure(buildConfig(chartData))
          .chord(buildChordData(chartData, showFingers))
          .draw();
        const svg = ref.current.querySelector('svg');
        if (svg) {
          svg.style.width = '100%';
          svg.style.height = '100%';
          whitenBarres(svg);
          svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', `${chart.title || 'chord'} chord chart`);
        }
      } catch (e) {
        console.error('Error rendering mobile chord chart:', e);
      }
    });
    return () => { cancelled = true; };
  }, [chart, showFingers]);

  return <div ref={ref} className="w-full h-full flex items-center justify-center" />;
};

const MobileChordGrid = ({ sections, density }) => {
  const [enlarged, setEnlarged] = useState(null); // chart object | null
  const showFingers = density === 3; // numbers only at 3-across
  const cols = density; // 3 or 4

  if (!sections || sections.length === 0) {
    return <div className="text-xs text-gray-500 py-2">No chord charts for this item yet.</div>;
  }

  return (
    <div>
      {sections.map(section => (
        <div key={section.id} className="mb-2">
          {/* Sticky section label — sits below the 52px top bar */}
          <div
            className="sticky flex items-center justify-between mb-1.5"
            style={{
              top: '52px',
              zIndex: 30,
              backgroundColor: 'rgba(2,8,23,0.92)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              borderRadius: '6px',
              padding: '5px 10px',
            }}
          >
            <span
              className="uppercase font-bold"
              style={{ fontSize: '12px', letterSpacing: '0.06em', color: '#fb923c' }}
            >
              {section.label}
            </span>
            {section.repeatCount && (
              <span
                className="font-bold"
                style={{ fontSize: '11px', color: '#9ca3af', backgroundColor: '#1f2937', borderRadius: '99px', padding: '1px 8px' }}
              >
                {section.repeatCount}
              </span>
            )}
          </div>

          {/* Chart grid */}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {section.chords.map(chart => (
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
        </div>
      ))}

      {/* Enlarge overlay — always shows finger numbers */}
      {enlarged && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 70, backgroundColor: 'rgba(2,8,23,0.88)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={() => setEnlarged(null)}
        >
          <div
            className="flex flex-col items-center"
            style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '16px', padding: '20px' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="font-bold mb-2" style={{ fontSize: '22px', color: '#f3f4f6' }}>{enlarged.title}</div>
            <div style={{ width: '250px', height: '268px' }}>
              <MobileChordChart chart={enlarged} showFingers={true} />
            </div>
            <button
              onClick={() => setEnlarged(null)}
              className="mt-3 font-semibold"
              style={{ height: '44px', minWidth: '120px', borderRadius: '10px', border: '1px solid #374151', color: '#f3f4f6' }}
              data-ph-capture-attribute-button="mobile-chord-enlarge-close"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileChordGrid;
