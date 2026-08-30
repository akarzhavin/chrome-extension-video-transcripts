// The consent contract, in one place.
//
// It has to be readable from two worlds that share no build step:
//   - build.mjs, a plain Node ESM script, which serializes these values into
//     the inline <head> block that runs BEFORE gtag.js loads;
//   - src/analytics/*.ts, bundled by Vite into analytics.js, which owns the
//     banner and the click that updates consent.
// That is why this file is .mjs and not .ts: build.mjs has no TypeScript
// pipeline (it already imports ../../packages/shared/vite-limits.mjs the same
// way), while the TS side reaches it through `allowJs`.
//
// Before this file existed the key and the four signal names were written out
// by hand in both places, and the comment in build.mjs called that "duplicated
// by necessity". The failure mode was silent: change one side only, and every
// returning visitor who had accepted is stranded at 'denied' forever — no
// error, no visible difference, just a slow leak in the numbers.

// localStorage key holding the visitor's answer. Absent, or holding anything
// other than the two values below, means "has not answered yet".
export const CONSENT_KEY = 'lingogram_consent';

export const CONSENT_GRANTED = 'granted';
export const CONSENT_DENIED = 'denied';

// The four Consent Mode v2 signals, all moved together — the site has no use
// for a visitor who accepts analytics but declines ads, and offering that
// choice would mean a second control to explain. Order is fixed because
// build.mjs serializes this list straight into the page and consent-build
// tests match the emitted literal.
export const CONSENT_SIGNALS = [
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'analytics_storage',
];

// Builds the object literal both halves pass to gtag('consent', …):
// {ad_storage:'denied',ad_user_data:'denied',…}. Returned as an object here;
// build.mjs serializes it to source text itself, since its copy has to survive
// as a string inside a <script> tag.
export const signals = (value) => {
  const out = {};
  for (const name of CONSENT_SIGNALS) out[name] = value;
  return out;
};

// How long gtag.js holds hits back waiting for a consent update, in ms. The
// inline block reads storage synchronously, so the wait is only ever spent on
// a first visit — but without it a returning visitor's first hit can race the
// upgrade and be sent cookieless.
export const WAIT_FOR_UPDATE_MS = 500;

// A date in the past: setting a cookie with it is how a cookie is deleted.
export const GA_COOKIE_EXPIRY = 'Thu, 01 Jan 1970 00:00:00 GMT';

// Store URLs the store_click handler recognises. Both spellings are live:
// Google moved the Web Store to the first host but the second still resolves
// and still appears in older links.
export const STORE_HOSTS = ['chromewebstore.google.com', 'chrome.google.com/webstore'];

// GA4 truncates event parameters server-side; truncating here keeps what we
// send identical to what gets stored, so a value is never silently cut.
export const MAX_PARAM_LEN = 64;
export const MAX_LOCALE_LEN = 16;

// Emitted when the attribute is missing rather than dropping the parameter:
// a present-but-'unknown' value is visible in a report, an absent one is not.
export const EDITION_FALLBACK = 'unknown';
export const PLACEMENT_FALLBACK = 'other';
