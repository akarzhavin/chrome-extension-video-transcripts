// Ships as analytics.js, loaded by a <script defer> ahead of main.js on every
// page. It carries the consent banner and the site's own GA4 events.
//
// Both halves are no-ops unless build.mjs emitted a tag (window.LG_GA4), so a
// local build with no SITE_GA4_MEASUREMENT_ID runs this file unchanged and
// sends nothing.
//
// The consent contract is split across two files by necessity, but not
// duplicated: build.mjs's inline <head> block seeds all four signals to
// 'denied' BEFORE gtag.js loads and upgrades them from storage on a returning
// visit, while this bundle owns the banner UI and the click that updates
// consent. Both read the key and the signal set from ./constants.cjs.

import { track } from './track';
import { initBanner } from './banner';
import { initStoreClicks } from './store-click';

// Assigned first and unconditionally — before the banner, and even on a build
// with no measurement id. The demo and auth bundles are separate Vite builds
// with no shared module with this one, so they reach analytics through this
// global; it has to exist and be a silent no-op rather than be absent, or a
// page without a tag would break their optional-call guard.
window.lgTrack = track;

initBanner();
initStoreClicks();
