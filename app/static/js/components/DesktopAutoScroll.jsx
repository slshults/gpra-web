// app/static/js/components/DesktopAutoScroll.jsx
// Floating auto-scroll control for the desktop Practice page: hands-free
// window scrolling while playing along with charts. The "scroll" label is the
// on/off toggle; slow/med/fast pick the speed (and switch it on). Speeds are
// roughly double mobile Play mode's — a desktop viewport covers more ground.
// Persists under its own keys (not Play mode's) so a speed left on in Play
// mode doesn't surprise-scroll the desktop page on load.
import { useState, useEffect } from 'react';

const SCROLL_SPEEDS = { slow: 16, med: 32, fast: 56 }; // px per second
const SPEED_KEY = 'gpra_autoscroll_speed_desktop';
const ON_KEY = 'gpra_autoscroll_on_desktop';

// localStorage can throw (e.g. all cookies blocked); these run as useState
// initializers, so a throw here would take down the whole Practice page
const readSpeed = () => {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    return ['slow', 'med', 'fast'].includes(v) ? v : 'slow';
  } catch {
    return 'slow';
  }
};
const readOn = () => {
  try {
    return localStorage.getItem(ON_KEY) === '1';
  } catch {
    return false;
  }
};
const persist = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked — the setting still applies for this page view
  }
};

const DesktopAutoScroll = () => {
  const [speed, setSpeed] = useState(readSpeed);
  const [on, setOn] = useState(readOn);

  useEffect(() => {
    if (!on) return;
    const pxPerSec = SCROLL_SPEEDS[speed] || 0;
    const el = document.scrollingElement;
    let raf;
    let last = null;
    // Keep the true position in a float — scrollTop rounds to an integer on
    // write, so a sub-pixel-per-frame increment read back from scrollTop would
    // never accumulate.
    let pos = el.scrollTop;
    const step = (t) => {
      if (last != null) {
        const max = el.scrollHeight - el.clientHeight;
        // Stand by (don't write, don't die) while scrolling shouldn't happen:
        // content fits the viewport, we're at the bottom, or a modal is open
        // (Radix locks body scroll with overflow: hidden — but scrollingElement
        // is <html>, which still scrolls, so check the lock explicitly to
        // avoid drifting the page behind the dialog). The loop keeps ticking
        // so it resumes when content grows or the modal closes.
        const modalOpen = document.body.style.overflow === 'hidden';
        if (max > 2 && pos < max && !modalOpen) {
          // If the user scrolled manually (wheel, keys, scrollbar), adopt the
          // real position instead of fighting them back to ours
          if (Math.abs(el.scrollTop - pos) > 2) pos = el.scrollTop;
          pos = Math.min(pos + pxPerSec * ((t - last) / 1000), max);
          el.scrollTop = pos;
        } else {
          pos = el.scrollTop;
        }
      }
      last = t;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on, speed]);

  const toggleOn = () => {
    const next = !on;
    setOn(next);
    persist(ON_KEY, next ? '1' : '0');
    window.posthog?.capture('practice_page_scroll_toggled', { enabled: next, speed });
  };

  // Picking a speed also switches scrolling on — tapping "med" while off is a
  // clear statement of intent
  const changeSpeed = (s) => {
    setSpeed(s);
    persist(SPEED_KEY, s);
    if (!on) {
      setOn(true);
      persist(ON_KEY, '1');
    }
    window.posthog?.capture('practice_page_scroll_speed_changed', { speed: s });
  };

  return (
    <div
      className="fixed flex items-center bg-gray-800 border border-gray-700 rounded-full shadow-lg"
      style={{ bottom: '16px', right: '16px', zIndex: 40, padding: '4px 6px', gap: '6px' }}
      role="group"
      aria-label="Auto-scroll"
    >
      {/* The label is the on/off toggle — its "on" orange is a lighter hue
          than the selected-speed chip so the two states read differently */}
      <button
        type="button"
        onClick={toggleOn}
        className="font-bold rounded-full"
        style={{
          height: '24px',
          padding: '0 10px',
          fontSize: '11px',
          letterSpacing: '0.02em',
          color: on ? '#111827' : '#9ca3af',
          backgroundColor: on ? '#fb923c' : 'transparent',
        }}
        aria-pressed={on}
        data-ph-capture-attribute-button="practice-scroll-toggle"
      >
        scroll
      </button>
      {['slow', 'med', 'fast'].map(s => (
        <button
          key={s}
          type="button"
          onClick={() => changeSpeed(s)}
          className="font-bold rounded-full"
          style={{
            minWidth: '40px',
            height: '24px',
            fontSize: '11px',
            backgroundColor: speed === s ? (on ? '#f97316' : '#374151') : 'transparent',
            color: speed === s ? (on ? '#111827' : '#d1d5db') : '#9ca3af',
          }}
          aria-pressed={speed === s}
          data-ph-capture-attribute-button={`practice-scroll-${s}`}
        >
          {s}
        </button>
      ))}
    </div>
  );
};

export default DesktopAutoScroll;
