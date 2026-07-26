// Helpers for the return trip from Stripe Checkout.
//
// billing.py builds success_url as `{host_url}#Account?upgrade=success&session_id=cs_...`,
// so the checkout params arrive inside the URL hash, not in window.location.search.

const readParams = () => {
  const queryIndex = window.location.hash.indexOf('?');
  if (queryIndex === -1) return null;
  return new URLSearchParams(window.location.hash.slice(queryIndex + 1));
};

// True for the success and the cancelled return alike — either way the user has
// just come back from Stripe and shouldn't be interrupted.
export const isCheckoutReturn = () => {
  const upgrade = readParams()?.get('upgrade');
  return upgrade === 'success' || upgrade === 'cancelled';
};

// Checkout session id from a successful return, or null if this isn't one.
export const getCheckoutSessionId = () => {
  const params = readParams();
  return params?.get('upgrade') === 'success' ? params.get('session_id') : null;
};

// Drop the checkout params once they've been acted on, so a reload doesn't replay
// the return and the session id stays out of history and analytics URLs. Only called
// when isCheckoutReturn() was true, so the hash always has a page part to keep.
export const clearCheckoutParams = () => {
  window.history.replaceState(null, '', window.location.hash.split('?')[0]);
};
