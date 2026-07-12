// Shared "accept all cookies" flow for the Stats-page consent modals.
// Mirrors CookieConsent.jsx handleAcceptAll: localStorage + server session + opt-in + reload.
// Sets a one-shot flag so StatsPage can show the "Ok, all set" follow-up after the reload.
export const enableCookiesForStats = async () => {
  localStorage.setItem('cookieConsent', 'all');
  localStorage.setItem('statsConsentJustAccepted', '1');

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
  window.location.reload();
};
