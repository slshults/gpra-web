// app/static/js/hooks/useChordDensity.js
import { useState, useEffect, useCallback, useRef } from 'react';

// Mobile chord-density preference: 3 or 4 charts across.
// - localStorage mirror gives an instant first paint (no flash of the wrong
//   density while the server round-trips).
// - The server is the source of truth across devices; we reconcile on mount.
// - On change we update state + localStorage immediately and POST in the
//   background (fire-and-forget; the localStorage mirror covers reloads).
const STORAGE_KEY = 'gpra_chord_density';
const VALID = [3, 4];
const DEFAULT_DENSITY = 4;

const readLocal = () => {
  const raw = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  return VALID.includes(raw) ? raw : DEFAULT_DENSITY;
};

export const useChordDensity = () => {
  const [density, setDensity] = useState(readLocal);
  const didReconcile = useRef(false);
  // Once the user has toggled, don't let a late-resolving mount GET overwrite
  // their choice (the POST has already committed it server-side).
  const userChanged = useRef(false);

  // Reconcile with the server once on mount. If the stored server value differs
  // from the local mirror, adopt the server's (it's authoritative across
  // devices) and refresh the mirror.
  useEffect(() => {
    if (didReconcile.current) return;
    didReconcile.current = true;
    let cancelled = false;
    fetch('/api/user/preferences/chord-density')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data || userChanged.current) return;
        const serverDensity = data.chord_density;
        if (VALID.includes(serverDensity)) {
          setDensity(serverDensity);
          localStorage.setItem(STORAGE_KEY, String(serverDensity));
        }
      })
      .catch(() => { /* offline / not logged in: keep the local mirror */ });
    return () => { cancelled = true; };
  }, []);

  const changeDensity = useCallback((next) => {
    if (!VALID.includes(next)) return;
    userChanged.current = true;
    setDensity(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    fetch('/api/user/preferences/chord-density', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chord_density: next }),
    }).catch(() => { /* mirror already updated; server will catch up next time */ });
    window.posthog?.capture('chord_density_changed', { chord_density: next });
  }, []);

  return { density, changeDensity };
};

export default useChordDensity;
