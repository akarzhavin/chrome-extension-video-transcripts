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

function wireButton(btn: HTMLElement, auth: ReturnType<typeof getAuth>) {
  const form = btn.closest('form');
  const errEl = form ? form.querySelector('[data-auth-error]') : null;
  btn.addEventListener('click', async () => {
    setError(errEl, '');
    (btn as HTMLButtonElement).disabled = true;
    // A cold start can hold this for tens of seconds. Without a label change
    // the page looks frozen — which is what makes a slow login read as broken.
    const label = btn.textContent;
    let waking: ReturnType<typeof setTimeout> | undefined;
    const restore = () => {
      clearTimeout(waking);
      if (label !== null) btn.textContent = label;
    };
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      // Only announce the wait once it is actually a wait; a warm backend
      // answers well inside this and the label never flickers.
      waking = setTimeout(() => {
        btn.textContent = 'Waking up the server…';
      }, 2000);
      await backendMe(CFG!, idToken);
      restore();
      location.href = APP_URL;
    } catch (err) {
      restore();
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
