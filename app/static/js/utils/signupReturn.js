// Helpers for the return trip from an OAuth signup.
//
// security.py redirects a brand-new OAuth user to `/?show_tour=true&new_signup=<provider>`.
// Existing users signing in through that same flow get `show_tour` on its own, so the
// new_signup marker is what separates a first-time signup from a returning login.

const readParams = () => new URLSearchParams(window.location.search);

// Provider a brand-new user just signed up with, or null if this isn't a signup return.
export const getOAuthSignupProvider = () => readParams().get('new_signup') || null;

// Drop the marker once it's been acted on, so a reload doesn't double-count the signup.
// GuidedTour clears show_tour separately, so only new_signup is removed here and any
// other params (and the hash route) are preserved.
export const clearOAuthSignupParam = () => {
  const params = readParams();
  params.delete('new_signup');
  const query = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  );
};
