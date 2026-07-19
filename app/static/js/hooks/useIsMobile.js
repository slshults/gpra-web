// app/static/js/hooks/useIsMobile.js
import { useState, useEffect } from 'react';

// Mobile redesign breakpoint: below sm (640px) gets the mobile treatments,
// tablets and up keep the desktop layout (explicit product decision from the
// mobile redesign handoff).
const MOBILE_QUERY = '(max-width: 639px)';

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    // Listen to both: some environments (emulated viewports) resize without
    // firing matchMedia change events
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return isMobile;
};

export default useIsMobile;
