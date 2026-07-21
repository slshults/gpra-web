// app/static/js/components/MobileChordChart.jsx
// One rendered SVGuitar chord chart, scaled into its container. Shared by the
// Practice-page density grid (MobileChordGrid) and Play mode (MobilePlayMode).
//
// THE critical chord-chart rule: keep the exact SVGuitar config and scale the
// finished SVG — never change the config per size. `showFingers` toggles the
// finger-number element only (4-across / Play mode = dots only; 3-across =
// numbers on).
import { useEffect, useRef } from 'react';

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

// Wait for the SVGuitar UMD script (PracticePage loads it on mount). Returns a
// cancel fn so the caller can stop polling on unmount. Usually resolves
// synchronously since the script is loaded well before charts render.
const waitForSvguitar = (cb) => {
  if (window.svguitar) { cb(); return () => {}; }
  let tries = 0;
  const id = setInterval(() => {
    tries += 1;
    if (window.svguitar) { clearInterval(id); cb(); }
    else if (tries > 40) { clearInterval(id); } // ~4s, then give up quietly
  }, 100);
  return () => clearInterval(id);
};

const MobileChordChart = ({ chart, showFingers }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    const cancelWait = waitForSvguitar(() => {
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
    return () => { cancelled = true; cancelWait(); };
  }, [chart, showFingers]);

  return <div ref={ref} className="w-full h-full flex items-center justify-center" />;
};

export default MobileChordChart;
