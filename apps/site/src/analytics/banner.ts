// The consent banner: revealing it, the click that answers it, and the footer
// control that reopens it. Server-rendered `hidden` by build.mjs's
// consentBanner(), so nothing here has to build markup.

import { readConsent, writeConsent, isDecided, effectiveChoice, clearGaCookies } from './consent';
import { CONSENT_DENIED, signals } from './constants.mjs';

export function initBanner(): void {
  const consentEl = document.getElementById('consent');
  // No banner on the page, or a build with no measurement id: nothing to run.
  if (!consentEl || !window.LG_GA4) return;

  // Reveal only for a visitor who has not answered. `hidden` is the
  // server-rendered default precisely so a returning visitor never sees the
  // banner flash before this line runs.
  if (!isDecided(readConsent())) consentEl.hidden = false;

  // Dismissal, for the reopened banner only. A visitor who opens the footer
  // control to LOOK at the setting must be able to leave without answering
  // again — the banner is fixed at z-index 60 (see .consent in site.css) and
  // covers content, and a forced re-decision is the pattern the one-click
  // Decline exists to avoid. Closing changes nothing: the stored choice stands.
  //
  // Not offered on the first, undecided view: there, a close box that leaves
  // consent at the denied default would be a third answer dressed as an
  // escape, and both real answers are already one click away.
  function dismiss(): void {
    if (!isDecided(readConsent())) return;
    (consentEl as HTMLElement).hidden = true;
    const reopenBtn = document.querySelector<HTMLElement>('[data-consent-reopen]');
    if (reopenBtn) reopenBtn.focus();
  }

  // One delegated listener for both controls the banner carries. Answering is
  // checked first and returns, so an element carrying both attributes could
  // not answer and dismiss on the same click.
  consentEl.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (!target || !target.closest) return;

    const btn = target.closest('[data-consent]');
    if (btn) {
      const choice = btn.getAttribute('data-consent');
      if (!choice || !isDecided(choice)) return;
      const stored = writeConsent(choice);
      (consentEl as HTMLElement).hidden = true;
      if (typeof window.gtag === 'function') {
        // All four signals move together, matching the returning-visitor
        // upgrade build.mjs serializes into its inline block from the same
        // constants. ad_storage is the one Google Signals actually needs:
        // without it the property setting is on and inert. Granting a signal
        // here but not there — or vice versa — would make a visitor's second
        // page behave unlike their first.
        window.gtag('consent', 'update', signals(effectiveChoice(choice, stored)));
      }
      // Withdrawal has to remove the identifier, not just stop writing new
      // ones. Order matters: the consent update above tells GA to stop first.
      if (choice === CONSENT_DENIED) clearGaCookies();
      // No page_view is re-sent here. The denied default does not swallow the
      // hit — gtag.js still sends it, cookieless, so the landing page is
      // already counted for this visit. Sending it again on Accept would
      // report two views for one page load.
      return;
    }

    if (target.closest('[data-consent-close]')) dismiss();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !(consentEl as HTMLElement).hidden) dismiss();
  });

  // Footer entry point, so a choice is reversible without clearing storage.
  const reopen = document.querySelector('[data-consent-reopen]');
  if (reopen) {
    reopen.addEventListener('click', () => {
      // Show the standing choice rather than a blank re-ask, and reveal the
      // close box so this visit can end without answering again.
      const standing = readConsent();
      const closeBtn = consentEl.querySelector<HTMLElement>('[data-consent-close]');
      if (closeBtn) closeBtn.hidden = !isDecided(standing);
      const buttons = consentEl.querySelectorAll('[data-consent]');
      for (let i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute(
          'aria-pressed',
          buttons[i].getAttribute('data-consent') === standing ? 'true' : 'false',
        );
      }
      consentEl.hidden = false;
    });
  }
}
