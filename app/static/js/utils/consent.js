// True when the full (cookie) PostHog SDK initialised - which is what actually
// decides whether the Conversations chat widget exists on the page.
//
// Deliberately NOT `cookieConsent === 'all'`: _posthog_init.html.jinja loads the
// full SDK when the user accepted OR when they're in an opt-out region and
// haven't declined. That second case covers the US and most of GPRA's traffic,
// so a consent-string check would tell the majority of users to "allow cookies"
// while the widget was already sitting in their corner.
//
// __phCookieless is set synchronously in <head> on the cookieless branch only,
// so there's no load-order race. Same probe LoginPage and RegisterPage use.
export const hasFullPostHogSdk = () => window.__phCookieless !== true;

// Shared "accept all cookies" flow.
// Mirrors CookieConsent.jsx handleAcceptAll: localStorage + server session + opt-in.
//
// Reloading is the caller's choice. The SDK only loads in full cookie mode at
// init, so the Conversations widget won't appear until a reload - but callers
// with unsaved work on screen (e.g. the chord editor's save-failure notice)
// must not blow it away, so they opt out and tell the user to refresh.
export const acceptAllCookies = async ({ reload = true } = {}) => {
  // Throwing here (storage disabled) is the one failure worth propagating -
  // localStorage IS the consent record, so if it didn't stick, callers must
  // not tell the user their choice was saved.
  localStorage.setItem('cookieConsent', 'all');

  try {
    const tokenResponse = await fetch('/api/csrf-token');
    const { csrf_token } = await tokenResponse.json();

    await fetch('/api/consent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrf_token,
      },
      body: JSON.stringify({ consent: 'all' }),
    });
  } catch (error) {
    console.error('[consent] Failed to save consent to server:', error);
  }

  if (window.posthog?.opt_in_capturing) {
    window.posthog.opt_in_capturing();
  }

  // Reload so the PostHog SDK loads in full cookie mode and starts capturing
  if (reload) {
    window.location.reload();
  }
};

// Stats-page variant: sets a one-shot flag so StatsPage can show the
// "Ok, all set" follow-up after the reload.
export const enableCookiesForStats = async () => {
  localStorage.setItem('statsConsentJustAccepted', '1');
  await acceptAllCookies();
};
