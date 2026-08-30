// Consent state: what the visitor answered, and forgetting them when they
// withdraw. No DOM events here — banner.ts owns those — so every function
// below can be exercised without a page.

import {
  CONSENT_KEY,
  CONSENT_GRANTED,
  CONSENT_DENIED,
  GA_COOKIE_EXPIRY,
} from './constants.mjs';

export function readConsent(): string | null {
  // Safari's "block all cookies" throws on localStorage access, not just on
  // write — so a bare read has to be guarded like a write.
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch (e) {
    return null;
  }
}

// Returns whether the choice actually persisted. Safari's "block all cookies"
// throws here, and a silent failure would be the worst of both worlds: consent
// is granted to GA for this page load while `track()` — which re-reads storage
// on every call — keeps dropping every event. The caller uses the result to
// keep the two in step.
export function writeConsent(value: string): boolean {
  try {
    localStorage.setItem(CONSENT_KEY, value);
    return localStorage.getItem(CONSENT_KEY) === value;
  } catch (e) {
    return false;
  }
}

// Anything that is not one of the two answers — absent, empty, a leftover from
// an older key — means the visitor has not answered yet.
export function isDecided(value: string | null): boolean {
  return value === CONSENT_GRANTED || value === CONSENT_DENIED;
}

// Storage that refuses to hold 'granted' means every later track() call reads
// back null and drops its event. Telling GA 'granted' anyway would claim a
// consent the page cannot honour, so an unpersisted acceptance stays denied for
// this page load too.
export function effectiveChoice(choice: string, persisted: boolean): string {
  return choice === CONSENT_GRANTED && !persisted ? CONSENT_DENIED : choice;
}

// Drop the identifiers GA4 already wrote. `consent update` to 'denied' stops
// new cookies but leaves the existing `_ga` / `_ga_<id>` in place, so the
// client_id would survive a withdrawal and rejoin the visitor's history if
// consent were granted again later. /privacy/site/ points at the footer
// control as THE way to change your mind, so it has to actually forget.
//
// Each name is expired at path=/ against three domain attempts — none, the
// exact host, and the registrable domain — because a cookie can only be
// expired by a matching domain/path pair, and GA writes to the registrable
// domain while a same-host cookie needs the bare attempt.
export function clearGaCookies(): void {
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n === '_ga' || n.indexOf('_ga_') === 0);
  if (!names.length) return;

  const host = location.hostname;
  // 'example.com' from 'www.example.com'. An IP literal has no registrable
  // domain to walk up to — slicing its last two octets would just produce a
  // '.0.1' the browser rejects — and neither does a single-label host like
  // 'localhost', so both keep only the exact-host attempt.
  //
  // Taking the last two labels is wrong for a multi-label public suffix: on
  // 'example.co.uk' it yields '.co.uk', which the browser refuses to set, so
  // the registrable-domain attempt silently does nothing and only the
  // exact-host one lands. Correcting it needs the Public Suffix List, a
  // dependency this file does not otherwise want. It is safe as written
  // because the site ships on a two-label domain; moving to one like
  // lingogram.co.uk would have to revisit this.
  const domains = ['', host];
  if (!/^[\d.]+$/.test(host) && host.indexOf(':') === -1) {
    const parts = host.split('.');
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    else if (parts.length === 2) domains.push('.' + host);
  }

  const past = '; expires=' + GA_COOKIE_EXPIRY + '; path=/';
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < domains.length; j++) {
      document.cookie = names[i] + '=' + past + (domains[j] ? '; domain=' + domains[j] : '');
    }
  }
}
