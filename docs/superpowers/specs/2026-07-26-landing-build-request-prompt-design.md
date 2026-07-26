# Landing page "tell me what to build" prompt

**Date:** 2026-07-26
**Status:** Approved, pending implementation

## Goal

At 50% scroll depth on the landing page, show a small chat-style popup on the
mid-right of the viewport reading:

> Don't see what you're looking for? Tell me what to build.

with a visible text field. The field must **not** take focus — the visitor keeps
scrolling and clicks in only if they want to reply. Submissions land in the same
PostHog Support inbox as the real chat widget.

## Why a custom popup rather than the real widget

The landing page currently has no chat widget at all: `<body class="bg-gray-900">`
lacks the `show-ph-widget` class, and `input.css:316` hides
`#ph-conversations-widget-container` by default.

The `posthog.conversations` API (`isAvailable`, `isVisible`, `show`, `hide`,
`sendMessage`, `getMessages`, `markAsRead`, `getTickets`, `getCurrentTicketId`,
`getWidgetSessionId`, `requestRestoreLink`, `restoreFromUrlToken`) has **no method
to expand the panel and no way to prefill the composer**. The greeting text,
placeholder, and position are project-level settings — GPRA's greeting is
support-oriented ("Hey. I'm just one guy, so please check the FAQ first…") and
position is `bottom_right`. Repurposing the real widget would change the support
experience on every other page and require synthetic clicks on
`button[aria-label="Open chat"]`, which is brittle against PostHog's DOM.

A PostHog Survey with an open-text question has the right trigger primitives but
the wrong destination — answers land in Surveys, with no reply thread.

So: a custom popup that borrows the API (`sendMessage`) but not the UI. The real
widget stays hidden on landing, since the existing CSS rule still applies.

## Structure

**New:** `app/templates/_build_request_prompt.html.jinja` — self-contained markup
+ inline `<style>` + inline `<script>`, following the
`_cookie_consent_banner.html.jinja` pattern. Inline styles rather than Tailwind
classes because `CookieConsent.css` loads after `main.css` on standalone
templates and overrides Tailwind responsive prefixes (CLAUDE.md cascade gotcha).

**Edited:** `app/templates/landing.html.jinja` — one `{% include %}` after
`_posthog_init.html.jinja`.

No Python, no build-step, no React, no CSS-file changes.

## Display gates

A single 250ms poll checks all conditions and shows the card when they are all
true, giving up after ~30s:

1. `sessionStorage.gpra_build_prompt_seen` is unset (once per session).
2. `window.posthog?.conversations?.isAvailable()` is true. The array.js stub does
   not proxy `conversations`, so it is `undefined` until the real SDK initialises —
   polling is required, a single check races.
3. Scroll depth `scrollY / (scrollHeight - innerHeight) >= 0.5`, tracked by a
   passive `scroll` listener that removes itself once fired.
4. The cookie consent banner (`#gpra-consent-banner`) is not visible — two
   popups at once is noise, and the banner can be tall on mobile.

All `sessionStorage` reads/writes are wrapped in `try/catch`: storage throws in
restricted in-app WebViews (Meta's Instagram/Facebook browsers, Safari private
mode), and a throwing write must never leave the card stuck or un-shown.

## Appearance

`position: fixed; right: 16px; top: 50%; transform: translateY(-50%)`, ~300px
wide; ~270px and `right: 8px` below 640px. Dark panel `#0f172a`, `#334155`
border, `×` dismiss top-right, GPRA-orange (`#ea580c`) send button — kin to the
chat widget without a full header bar. `z-index: 9998`, one below the consent
banner. Fade + slide-in from the right over 200ms, suppressed under
`prefers-reduced-motion`. Light-mode overrides via the `.light-mode` body class
the landing page already toggles.

Vertically centred on the right, so it never collides with the bottom-fixed
consent banner or the mobile footer.

## Content and interaction

Prompt line, then a 2-row `<textarea>` (placeholder "Type your idea…") and a Send
button. **No `autofocus` attribute and no `.focus()` call** — this is a hard
requirement. `enter` sends, `shift+enter` inserts a newline, matching the
convention in the project's own widget placeholder text.

**On send:** disable the button, `await posthog.conversations.sendMessage(body)`.
The body is prefixed with a `[Landing page — build request]` marker line so these
are distinguishable from real support tickets in the inbox.

**On success:** the card swaps in place to "Thanks — got it. 🙌" plus an optional
email input ("Add your email if you'd like a reply"). Submitting it fires a
second `sendMessage` on the same ticket carrying `userTraits: { email }`, which
back-fills the ticket's contact per the PostHog docs. No auto-dismiss in this
state — it would yank the email field away mid-typing.

**On failure:** inline "That didn't send — try again?" with the button re-enabled.

## Events

snake_case past tense, per GPRA convention:

- `landing_build_prompt_shown`
- `landing_build_prompt_dismissed`
- `landing_build_request_submitted` (`message_length`)
- `landing_build_request_email_added`
- `landing_build_request_failed` (`error`)

## Related fix: logout cleanup on standalone pages

Found while testing this feature. `_standalone_header.html.jinja` rendered plain
`<a href="/logout">` links (desktop nav + mobile menu) for logged-in users. A bare
GET navigates away before PostHog can clear its browser state, so the support
widget kept a `ph_conv_*` entry holding `{widgetSessionId, ticketId}` bound to the
previous user's ticket. Consequences for the next visitor on that device:

- Every widget poll of `/widget/messages` 403s, forever, every 5 seconds.
- `sendMessage` 403s, so this popup (and the real widget) cannot send.

The React app already handled this in `useAuth.handleLogout` via
`posthog.reset(true)` — verified empirically that `reset(true)` deletes the
`ph_conv_*` key outright, while `clearIdentity()` does not affect it. Standalone
pages have no React, so a delegated click handler in the same partial mirrors it:
`reset(true)` + `clearIdentity()` + clearing `lapsedModalDismissed`, then navigate
to the link's own href after 100ms. The PostHog calls are wrapped in `try/catch`
because storage writes throw in restricted WebViews, and failing to clear must
never trap a user on the page unable to log out. Modified and non-primary clicks
(ctrl/cmd/shift/middle) are left to the browser so "open in a new tab" still
works; those paths skip the cleanup, which is no worse than before.

Both copies carry a `KEEP IN SYNC` comment pointing at the other. A shared JS
module was considered and rejected: standalone pages load no app bundle, and the
duplication is ~15 lines against the cost of a new cross-cutting asset.

Known gap: activating the link without a click event (right-click → open in new
tab, drag to tab bar) skips the browser-state cleanup.

## Related fix: `/logout` left the remember-me cookie alive

Also found during this review, and more serious. `logout_route` (`app/routes_v2.py`)
called `logout_user()` and then `session.clear()`. Flask-Login's `logout_user()`
does not delete the remember-me cookie directly — it records the intent as
`session['_remember'] = 'clear'`, which its `_update_remember_cookie` after-request
hook acts on. `session.clear()` wiped that marker first, so the hook did nothing
and `remember_token` outlived the logout.

All three OAuth login paths use `login_user(user, remember=True)`
(`app/security.py`), so a Google or Tidal user who logged out via any link to
`/logout` left a valid remember-me cookie on the device, and the next request
could silently re-authenticate them. The sibling FAB route `/logout/`
(`CustomAuthDBView.logout`) already worked around this by expiring the cookie
explicitly; `/logout` did not.

Fixed in `logout_route` by returning a response that expires `remember_token` and
`session`, matching `/logout/`. Fixing it server-side covers every path to
`/logout` — bookmarks, middle-clicks, and any future link — rather than only the
clicks the JS handler intercepts. Verified: `/logout` now responds with
`Set-Cookie: remember_token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`.

Note the earlier inconclusive test: logging in through `/api/auth/login` uses
`remember=False`, so no remember cookie exists on that path and logout looks
clean. The defect only reproduces via an OAuth login.

## Testing

`localhost:5000` is already in the project's `widget_domains`, so the API works
locally. Playwright at a desktop viewport and 375px mobile:

1. Card is absent before 50% scroll.
2. Card appears at 50% scroll.
3. `document.activeElement` is still `<body>` after it appears — no focus steal.
4. Dismiss hides it; reload in the same session does not re-show it.
5. A submitted message arrives in the Support inbox (verified via PostHog MCP).
