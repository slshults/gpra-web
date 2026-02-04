import React, { useState, useEffect } from 'react';

/**
 * Cookie Consent Banner
 *
 * Displays a friendly GDPR/CPRA compliant cookie consent banner at the bottom of the page.
 * Users can choose to accept all cookies (including analytics) or only essential cookies.
 *
 * Preferences stored in localStorage.cookieConsent:
 * - 'all': User accepted all cookies (PostHog enabled)
 * - 'essential': User accepted only essential cookies (PostHog disabled)
 * - null/undefined: User hasn't made a choice yet (show banner)
 *
 * Note: PostHog is loaded via script tag in HTML, accessed via window.posthog
 */
const CookieConsent = () => {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const checkConsent = async () => {
      // Check localStorage first (fast, client-side)
      let consent = localStorage.getItem('cookieConsent');

      if (!consent) {
        // No localStorage - check server session (for cross-subdomain support)
        try {
          const response = await fetch('/api/consent');
          const data = await response.json();
          consent = data.consent;

          if (consent) {
            // Sync server consent to localStorage for faster future checks
            localStorage.setItem('cookieConsent', consent);
          }
        } catch (error) {
          console.error('[CookieConsent] Failed to fetch server consent:', error);
        }
      }

      if (!consent) {
        // No consent anywhere - show banner
        setShowBanner(true);
      } else {
        // Apply stored consent preference
        applyConsent(consent);
      }
    };

    checkConsent();
  }, []);

  const deleteCookies = (pattern) => {
    // Delete all cookies matching the pattern
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i];
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();

      if (pattern.test(name)) {
        // Delete cookie for all paths and domains
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname;
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname;
      }
    }
  };

  const applyConsent = (choice) => {
    // Access PostHog from window object (loaded via script tag)
    const posthog = window.posthog;

    if (choice === 'all') {
      // Enable PostHog analytics - page reload required to load SDK
      if (typeof posthog !== 'undefined' && posthog.opt_in_capturing) {
        posthog.opt_in_capturing();
      }
    } else if (choice === 'essential') {
      // Disable PostHog analytics and delete tracking cookies
      if (typeof posthog !== 'undefined' && posthog.opt_out_capturing) {
        posthog.opt_out_capturing();
      }
      // Delete PostHog cookies (ph_phc_* format)
      deleteCookies(/^ph_phc_/);

      // Manually clear ALL PostHog localStorage (opt_out_capturing preserves distinct_id by design)
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('ph_') || key.includes('posthog')) {
          localStorage.removeItem(key);
        }
      });
    }
  };

  const handleAcceptAll = async () => {
    // Save to both localStorage (fast) and server session (cross-subdomain)
    localStorage.setItem('cookieConsent', 'all');

    try {
      // Get CSRF token
      const tokenResponse = await fetch('/api/csrf-token');
      const { csrf_token } = await tokenResponse.json();

      // Save consent with CSRF protection
      await fetch('/api/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf_token
        },
        body: JSON.stringify({ consent: 'all' })
      });
    } catch (error) {
      console.error('[CookieConsent] Failed to save consent to server:', error);
    }

    applyConsent('all');
    setShowBanner(false);
    // Reload page to load PostHog SDK
    window.location.reload();
  };

  const handleEssentialOnly = async () => {
    // Save to both localStorage (fast) and server session (cross-subdomain)
    localStorage.setItem('cookieConsent', 'essential');

    try {
      // Get CSRF token
      const tokenResponse = await fetch('/api/csrf-token');
      const { csrf_token } = await tokenResponse.json();

      // Save consent with CSRF protection
      await fetch('/api/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf_token
        },
        body: JSON.stringify({ consent: 'essential' })
      });
    } catch (error) {
      console.error('[CookieConsent] Failed to save consent to server:', error);
    }

    applyConsent('essential');
    setShowBanner(false);
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div
      className="fixed left-0 right-0 bg-white dark:bg-gray-800 border-t-2 border-orange-500 shadow-2xl"
      style={{ bottom: 0, zIndex: 9999 }}
    >
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-center md:justify-between gap-4">
          {/* Message */}
          <div className="flex-1 text-sm text-gray-700 dark:text-gray-300 text-center md:text-left">
            <p className="mb-2">
              <span className="font-semibold text-base">We use cookies to make GPRA better</span>
            </p>
            <p>
              We use functional cookies (required for login and sessions, "Essential only") and PostHog cookies for analytics, contact form, etc. ("Accept all") {' '}
              <a href="/privacy#cookies" className="text-orange-600 dark:text-orange-400 hover:underline">
                Learn more
              </a>
            </p>
          </div>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 min-w-max">
            <button
              onClick={handleAcceptAll}
              className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg transition-colors whitespace-nowrap shadow-md"
            >
              Accept all
            </button>
            <button
              onClick={handleEssentialOnly}
              className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-semibold rounded-lg transition-colors whitespace-nowrap shadow-md"
            >
              Essential only
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
