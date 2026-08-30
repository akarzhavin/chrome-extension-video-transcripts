import { track } from './track';
import {
  STORE_HOSTS,
  MAX_PARAM_LEN,
  MAX_LOCALE_LEN,
  EDITION_FALLBACK,
  PLACEMENT_FALLBACK,
} from './constants.cjs';

// Store clicks: the one conversion this site has. `edition` is the card or
// landing page the visitor chose — youtube, netflix, rezka — and the CTAs
// that belong to no edition (hero, final, uninstall banner) report the one
// they install rather than a placement name of their own.
//
// Delegated on document so it covers every store link on every page,
// including the ones main.js itself rewrites (welcome reordering).
export function initStoreClicks(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const a = target && target.closest ? target.closest('a[href]') : null;
    if (!a) return;
    const url = a.getAttribute('href') || '';
    if (!STORE_HOSTS.some((host: string) => url.indexOf(host) !== -1)) return;

    track('store_click', {
      // Which edition, per build.mjs's data-store. Not derived from the URL:
      // the YouTube and Netflix cards share one listing id, so the URL cannot
      // tell them apart while the attribute can. The site-wide CTAs (hero,
      // final, uninstall banner) carry no edition of their own and resolve to
      // the one they install, so they join its value instead of inventing a
      // `primary` that matches no card.
      edition: (a.getAttribute('data-store') || EDITION_FALLBACK).slice(0, MAX_PARAM_LEN),
      // Where on the site the click came from — hero, card, final CTA — so
      // the same listing's clicks can be attributed to a position.
      placement: (a.getAttribute('data-place') || PLACEMENT_FALLBACK).slice(0, MAX_PARAM_LEN),
      // These links navigate the SAME tab, so the hit has to outlive the
      // unload. Nothing here arranges that, and nothing needs to: gtag.js
      // already sends over fetch+keepalive, which the browser completes after
      // the page is gone. `transport_type: 'beacon'` was tried and removed —
      // it changed no transport and only added a custom parameter to every
      // event (see build.mjs's analytics block).
      page_locale: (document.documentElement.lang || '').slice(0, MAX_LOCALE_LEN),
    });
  });
}
