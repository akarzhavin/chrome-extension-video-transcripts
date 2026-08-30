import { readConsent } from './consent';
import { CONSENT_GRANTED } from './constants.cjs';

declare global {
  interface Window {
    // Set by build.mjs's inline block, and only when a measurement id was
    // configured. Its absence is how an untagged build stays silent.
    LG_GA4?: string;
    gtag?: (...args: unknown[]) => void;
    lgTrack?: (name: string, params?: Record<string, unknown>) => void;
  }
}

// Send an event, but only once consent is granted. GA4 itself would queue
// and drop the hit under denied consent, so this guard is belt-and-braces;
// what it really buys is that `track()` is safe to call from anywhere
// without each call site restating the condition.
//
// Consent is re-read on every call rather than cached: a visitor can withdraw
// mid-visit through the footer control, and a cached 'granted' would keep
// sending after they said stop.
export function track(name: string, params?: Record<string, unknown>): void {
  if (!window.LG_GA4 || typeof window.gtag !== 'function') return;
  if (readConsent() !== CONSENT_GRANTED) return;
  window.gtag('event', name, params || {});
}
