// hooks/useAutocreateAccess.js
// Reads /api/auth/status and exposes the gating signals for autocreate features.
// On fetch error, defaults to autocreateEnabled=true so users aren't locked out
// by a transient network issue — existing error handling kicks in if they try.
import { useState, useEffect } from 'react';

export const useAutocreateAccess = () => {
  const [autocreateEnabled, setAutocreateEnabled] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [tier, setTier] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchAccess = async () => {
      try {
        const response = await fetch('/api/auth/status');
        if (!response.ok) throw new Error('Auth status check failed');
        const data = await response.json();
        if (cancelled) return;
        setAutocreateEnabled(Boolean(data.autocreate_enabled));
        setHasApiKey(Boolean(data.has_anthropic_api_key));
        setTier(data.tier || null);
      } catch (error) {
        if (!cancelled) {
          // Fail open — don't lock users out on a network blip
          console.warn('useAutocreateAccess: defaulting to enabled after error:', error);
          setAutocreateEnabled(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAccess();
    return () => { cancelled = true; };
  }, []);

  return { autocreateEnabled, hasApiKey, tier, loading };
};

export default useAutocreateAccess;
