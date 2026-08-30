// Google sign-in for the landing-page login/register forms.
//
// Email/password runs on plain fetch against Firebase's REST surface
// (src/js/auth.js) — no SDK needed. Google is different: signInWithPopup is
// only in the Firebase Web SDK, so this small ESM bundle carries firebase/auth
// and wires the "Continue with Google" buttons. Built separately from the demo
// (see vite.auth.config.ts) and loaded only on /login and /register.
//
// Runtime config comes from window.LINGOGRAM_AUTH (set by auth-config.js), so
// dev/prod switching stays in one place. After the popup we call GET
// {apiBase}/auth/me — auth-service auto-creates the profile on first hit
// (_ensure_user_record), so new Google users need no explicit register call,
// exactly like the SPA's loginWithGoogle().
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import type { RuntimeAuthConfig } from './core';
import { AuthError, fetchWithRetry } from './core';
import { getAuthInstance } from './firebase';

declare global {
  interface Window {
    LINGOGRAM_AUTH?: RuntimeAuthConfig;
    LINGOGRAM_APP_URL?: string;
  }
}

const CFG = window.LINGOGRAM_AUTH;
const APP_URL = window.LINGOGRAM_APP_URL || '/app/';

async function backendMe(cfg: RuntimeAuthConfig, idToken: string) {
  // Retries cold starts and throws AuthError('backend/unreachable') once the
  // backoff is spent — see fetchWithRetry.
  const res = await fetchWithRetry(cfg.apiBase + '/auth/me', {
    headers: { Authorization: 'Bearer ' + idToken },
  });
  if (!res.ok) {
    throw new Error('Could not reach your account (' + res.status + ').');
  }
}

function setError(el: Element | null, msg: string) {
  if (!(el instanceof HTMLElement)) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// popup-closed / cancelled are normal user actions, not errors — stay silent
// (mirrors the SPA's handleGoogleLogin).
function isCancel(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request'
  );
}

/**
 * Puts the button in a busy state: swaps the Google mark for a spinner and
 * lets the caller name the current step. Returns handles to update that label
 * and to undo everything.
 *
 * The spinner starts on click rather than after a delay — the popup can take a
 * second to appear, and a button that greys out with no other change is the
 * thing that makes people click twice.
 */
function setBusy(btn: HTMLElement) {
  // Only the trailing text node is captured, never btn.textContent: assigning
  // that back would delete the Google <svg> and leave a button with no mark.
  const labelNode =
    btn.lastChild && btn.lastChild.nodeType === Node.TEXT_NODE
      ? btn.lastChild
      : null;
  const original = labelNode?.textContent ?? null;
  const spinner = document.createElement('span');
  spinner.className = 'auth-google-spinner';
  btn.setAttribute('data-busy', '');
  btn.setAttribute('aria-busy', 'true');
  btn.prepend(spinner);

  const timers: ReturnType<typeof setTimeout>[] = [];
  // Write through the captured node so the spinner and icon are never touched.
  const label = (text: string) => {
    if (labelNode) labelNode.textContent = ' ' + text;
  };

  return {
    label,
    labelAfter: (ms: number, text: string) => {
      timers.push(setTimeout(() => label(text), ms));
    },
    stop: () => {
      timers.forEach(clearTimeout);
      spinner.remove();
      btn.removeAttribute('data-busy');
      btn.removeAttribute('aria-busy');
      if (labelNode && original !== null) labelNode.textContent = original;
    },
  };
}

function wireButton(btn: HTMLElement, auth: ReturnType<typeof getAuth>) {
  const form = btn.closest('form');
  const errEl = form ? form.querySelector('[data-auth-error]') : null;
  btn.addEventListener('click', async () => {
    setError(errEl, '');
    (btn as HTMLButtonElement).disabled = true;
    const busy = setBusy(btn);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      // Returning from the popup is the moment the page looks emptiest: the
      // overlay is gone and the profile fetch is the only thing left running.
      // Name that step, and after 2s say why it is slow — a cold container.
      busy.label('Signing you in…');
      busy.labelAfter(2000, 'Waking up the server…');
      await backendMe(CFG!, idToken);
      // The site's GA4 event (main.js owns the consent gate — see its
      // window.lgTrack). One button serves both pages, so the path is what
      // says whether this was a sign-up or a sign-in; Firebase's own
      // isNewUser flag is not read here because it lives behind an
      // additionalUserInfo import this bundle does not otherwise need.
      // The event carries the method only, never the account.
      try {
        const name = location.pathname.indexOf('/register') !== -1 ? 'sign_up' : 'login';
        (window as { lgTrack?: (n: string, p?: Record<string, unknown>) => void })
          .lgTrack?.(name, { method: 'google' });
      } catch (e) {}
      // Deliberately left spinning: the redirect below ends this page, and
      // restoring the idle label first would flash "Log in with Google" as
      // though nothing had happened.
      location.href = APP_URL;
    } catch (err) {
      busy.stop();
      (btn as HTMLButtonElement).disabled = false;
      if (!isCancel(err)) {
        // The popup is only half of this flow: backendMe() runs after Google
        // has already authenticated the user, so a sleeping backend fails here
        // with sign-in perfectly fine. Saying "Google sign-in failed" sends
        // people to re-check an account that was never the problem.
        setError(
          errEl,
          err instanceof AuthError && err.firebaseCode === 'backend/unreachable'
            ? "Signed in with Google, but couldn't reach the server — it may still be starting up. Please try again."
            : 'Google sign-in failed. Please try again.',
        );
      }
    }
  });
}

function start() {
  if (!CFG) return;
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>('[data-google-auth]'),
  );
  if (buttons.length === 0) return;
  const auth = getAuthInstance(CFG);
  buttons.forEach((btn) => wireButton(btn, auth));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
