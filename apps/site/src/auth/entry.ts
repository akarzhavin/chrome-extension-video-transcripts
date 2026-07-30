// Browser entry for the landing login/register forms. Bundled by
// vite.auth.config.ts to build/auth.js and loaded as a module. The pure logic
// lives in ./core (unit-tested); this file is the DOM glue: field enhancers
// (validation, password toggle, caps-lock hint, strength meter), email
// persistence across pages, and the submit flows.
import {
  EMAIL_RE,
  registerUser,
  loginUser,
  sendReset,
  scorePassword,
  dashboardPath,
  AuthError,
  RuntimeAuthConfig,
} from './core';
import { sdkOps } from './firebase';
// Also export the pure DOM helpers so tests can exercise them directly.
export {
  markField,
  validateEmailField,
  validatePasswordField,
  wirePasswordToggle,
  wireCapsHint,
  wireStrengthMeter,
} from './dom';
import {
  markField,
  validateEmailField,
  validatePasswordField,
  wirePasswordToggle,
  wireCapsHint,
  wireStrengthMeter,
} from './dom';

declare global {
  interface Window {
    LINGOGRAM_AUTH?: RuntimeAuthConfig;
    LINGOGRAM_APP_URL?: string;
  }
}

const CFG = window.LINGOGRAM_AUTH;
const APP_URL = window.LINGOGRAM_APP_URL || '/app/';
// Real Firebase SDK ops (email/password sign-in/up + reset). The SDK persists
// the session to IndexedDB, which the SPA reads on the same origin — no manual
// token stashing needed anymore.
const OPS = CFG ? sdkOps(CFG) : null;

// Remember the email across /login ↔ /register so a wrong-page visit doesn't
// cost a retype. Cleared on a successful auth.
function rememberEmail(v: string): void {
  try { sessionStorage.setItem('lingogram_email', v || ''); } catch (e) {}
}
function recallEmail(): string {
  try { return sessionStorage.getItem('lingogram_email') || ''; } catch (e) { return ''; }
}

function setError(el: Element | null, msg: string): void {
  if (!(el instanceof HTMLElement)) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function bindSubmit(
  form: HTMLFormElement,
  onSubmit: (f: HTMLFormElement) => Promise<void>,
): void {
  const errEl = form.querySelector('[data-auth-error]');
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const btnText = btn ? btn.textContent || '' : '';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(errEl, '');
    if (btn) {
      btn.disabled = true;
      btn.textContent = btn.getAttribute('data-busy-text') || 'Please wait…';
    }
    try {
      await onSubmit(form);
    } catch (err) {
      // An Error with an empty message is the "already handled" sentinel: a flow
      // (e.g. register's EMAIL_EXISTS → offerLoginInstead) already wrote a richer
      // message into errEl and threw Error('') to stop the submit — leave errEl
      // as-is. Anything else with no usable message gets the generic fallback.
      if (err instanceof Error) {
        if (err.message) setError(errEl, err.message);
        // else: handled sentinel — keep whatever the flow already displayed
      } else {
        setError(errEl, 'Something went wrong.');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = btnText;
      }
    }
  });
}

// Shared field enhancers: blur validation, password toggle/caps/strength, email
// prefill + persistence. Runs on whichever fields the form has.
function enhanceFields(form: HTMLFormElement, minLen: number): void {
  const email = form.querySelector<HTMLInputElement>('input[name="email"]');
  const pw = form.querySelector<HTMLInputElement>('input[name="password"]');
  if (email) {
    const recalled = recallEmail();
    if (recalled && !email.value) email.value = recalled;
    email.addEventListener('blur', () => validateEmailField(email));
    email.addEventListener('input', () => {
      rememberEmail(email.value.trim());
      if (email.closest('.auth-field')?.classList.contains('is-invalid')) validateEmailField(email);
    });
  }
  if (pw) {
    wirePasswordToggle(pw);
    wireCapsHint(pw);
    wireStrengthMeter(pw);
    pw.addEventListener('blur', () => validatePasswordField(pw, minLen));
  }
  const focusTarget = email && !email.value ? email : form.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  if (focusTarget && !focusTarget.value) { try { focusTarget.focus(); } catch (e) {} }
}

// On a "duplicate email" registration error, offer a one-tap route to login
// with the email carried over, instead of a dead-end error string.
function offerLoginInstead(errEl: Element | null, email: string): void {
  if (!(errEl instanceof HTMLElement)) return;
  rememberEmail(email);
  errEl.innerHTML =
    'An account with this email already exists. ' +
    '<a href="/login/" class="auth-link">Log in instead →</a>';
  errEl.style.display = 'block';
}

function initRegister(): void {
  const form = document.getElementById('register-form') as HTMLFormElement | null;
  if (!form) return;
  enhanceFields(form, 8);
  const errEl = form.querySelector('[data-auth-error]');
  bindSubmit(form, async (f) => {
    const email = (f.elements.namedItem('email') as HTMLInputElement).value.trim();
    const nameEl = f.elements.namedItem('name') as HTMLInputElement | null;
    const pwEl = f.elements.namedItem('password') as HTMLInputElement;
    const name = nameEl ? nameEl.value.trim() : '';
    if (!EMAIL_RE.test(email)) { markField(f.elements.namedItem('email') as HTMLInputElement, 'That email address looks invalid.'); throw new Error('Please fix the errors above.'); }
    if (pwEl.value.length < 8) { markField(pwEl, 'Use at least 8 characters.'); throw new Error('Please fix the errors above.'); }
    let result;
    try {
      result = await registerUser(OPS!, CFG!, { email, password: pwEl.value, fullName: name });
    } catch (err) {
      // SDK code is auth/email-already-in-use; REST legacy was EMAIL_EXISTS.
      const code = err instanceof AuthError ? err.firebaseCode || '' : '';
      if (code === 'auth/email-already-in-use' || code.indexOf('EMAIL_EXISTS') === 0) {
        offerLoginInstead(errEl, email);
        throw new Error(''); // suppress the generic line; we showed a better one
      }
      throw err;
    }
    rememberEmail('');
    // Land in the role's dashboard, same as the SPA's routeByRole. The SDK
    // already persisted the session (IndexedDB), so the SPA opens logged-in.
    location.href = dashboardPath(result.user?.roles, APP_URL);
  });
}

function initLogin(): void {
  const form = document.getElementById('login-form') as HTMLFormElement | null;
  if (!form) return;
  enhanceFields(form, 1);
  bindSubmit(form, async (f) => {
    const email = (f.elements.namedItem('email') as HTMLInputElement).value.trim();
    const pw = (f.elements.namedItem('password') as HTMLInputElement).value;
    if (!EMAIL_RE.test(email)) { markField(f.elements.namedItem('email') as HTMLInputElement, 'That email address looks invalid.'); throw new Error('Please fix the errors above.'); }
    const { user } = await loginUser(OPS!, CFG!, { email, password: pw });
    rememberEmail('');
    // Land in the role's dashboard, same as the SPA's routeByRole. The SDK
    // already persisted the session, so the SPA opens logged-in.
    location.href = dashboardPath(user?.roles, APP_URL);
  });

  const reset = document.getElementById('reset-link');
  if (reset) {
    reset.addEventListener('click', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('[data-auth-error]');
      const note = document.getElementById('reset-note');
      const emailEl = form.elements.namedItem('email') as HTMLInputElement;
      const email = emailEl.value.trim();
      if (!EMAIL_RE.test(email)) {
        markField(emailEl, 'Enter a valid email above, then tap reset.');
        try { emailEl.focus(); } catch (err) {}
        return;
      }
      setError(errEl, '');
      reset.textContent = 'Sending…';
      try {
        await sendReset(OPS!, email);
        if (note instanceof HTMLElement) {
          note.textContent = 'Check your inbox — a reset link is on its way to ' + email + '.';
          note.style.display = 'block';
        }
        reset.textContent = 'Resend link';
      } catch (err) {
        setError(errEl, err instanceof Error && err.message ? err.message : 'Could not send reset email.');
        reset.textContent = 'Forgot password?';
      }
    });
  }
}

function start(): void {
  if (!CFG) return; // auth-config.js failed to load; nothing to wire.
  initRegister();
  initLogin();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
