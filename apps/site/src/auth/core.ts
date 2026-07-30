// Pure, DOM-free auth logic for the landing forms. Extracted from the form
// wiring so it can be unit-tested directly (tests/auth-core.test.ts) — the
// browser entry (src/auth/entry.ts, bundled to auth.js) imports from here and
// adds the DOM glue.
//
// Sign-in/up runs through the Firebase Web SDK (see ./firebase, injected as
// SdkOps) so the session persists to IndexedDB — the SPA reads it on the same
// origin and opens logged-in. The password never touches our backend; we only
// call auth-service (/auth/register, /auth/me) with the resulting ID token for
// the app profile + roles.

export interface RuntimeAuthConfig {
  env: 'dev' | 'preprod' | 'prod';
  apiKey: string;
  // Kept for auth-config.js parity / the Google flow; the email/password flow
  // uses the SDK, not this REST base.
  identityToolkitUrl: string;
  apiBase: string;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Map Firebase Identity Toolkit error codes to human copy. Raw codes
// (EMAIL_EXISTS, INVALID_LOGIN_CREDENTIALS, …) are never shown to the user.
const FIREBASE_MESSAGES: Record<string, string> = {
  EMAIL_EXISTS: 'An account with this email already exists. Try logging in.',
  INVALID_LOGIN_CREDENTIALS: 'Incorrect email or password.',
  INVALID_PASSWORD: 'Incorrect email or password.',
  EMAIL_NOT_FOUND: 'Incorrect email or password.',
  INVALID_EMAIL: 'That email address looks invalid.',
  MISSING_PASSWORD: 'Please enter your password.',
  WEAK_PASSWORD: 'Password is too weak — use at least 8 characters.',
  TOO_MANY_ATTEMPTS_TRY_LATER:
    'Too many attempts. Please wait a moment and try again.',
  USER_DISABLED: 'This account has been disabled.',
};

export function firebaseMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  // Firebase suffixes some codes, e.g. "WEAK_PASSWORD : Password should be…".
  const key = String(code).split(' ')[0].split(':')[0].trim();
  return FIREBASE_MESSAGES[key] || fallback;
}

// Error carrying the raw Firebase code so callers can branch (e.g.
// EMAIL_EXISTS / auth/email-already-in-use → "log in instead").
export class AuthError extends Error {
  firebaseCode?: string;
  constructor(message: string, firebaseCode?: string) {
    super(message);
    this.firebaseCode = firebaseCode;
  }
}

// The SDK operations the flows need, injected so core.ts stays free of a direct
// firebase/auth import (keeps it unit-testable with fakes; the real wiring lives
// in ./firebase + ./entry). Each returns the signed-in user's ID token.
export interface SdkOps {
  signInEmail(email: string, password: string): Promise<{ idToken: string; uid: string; email: string | null }>;
  createEmail(email: string, password: string): Promise<{ idToken: string; uid: string; email: string | null }>;
  sendReset(email: string): Promise<void>;
}

// Firebase SDK error codes (auth/...) → human copy. The SDK uses different codes
// than the REST surface, so map both families.
const SDK_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'An account with this email already exists. Try logging in.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/missing-password': 'Please enter your password.',
  'auth/weak-password': 'Password is too weak — use at least 8 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
};

// Normalize any thrown SDK error into an AuthError with friendly copy + code.
export function toAuthError(err: unknown): AuthError {
  const code = (err as { code?: string })?.code;
  if (code && SDK_MESSAGES[code]) return new AuthError(SDK_MESSAGES[code], code);
  // Fall back to the REST-style mapper for legacy codes, then a generic line.
  const msg = firebaseMessage(code, 'Authentication failed. Please try again.');
  return new AuthError(msg, code);
}

async function backend(
  cfg: RuntimeAuthConfig,
  method: string,
  path: string,
  idToken: string,
  body?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(cfg.apiBase + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + idToken,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Could not reach your account (' + res.status + '). ' + text);
  }
  return res.json().catch(() => ({}));
}

// What the flows return: the signed-in user plus the app profile so callers can
// route by role after auth (see dashboardPath).
export interface AuthResult {
  uid: string;
  user: { roles: string[] };
}

// Register: create the Firebase account via the SDK (session → IndexedDB, seen
// by the SPA on the same origin), then record the app profile. /auth/register's
// schema requires password (min 8) and full_name (min 2) even though the account
// now exists — same contract the SPA uses; full_name falls back to the email
// local-part so it always clears the min-length check.
export async function registerUser(
  ops: SdkOps,
  cfg: RuntimeAuthConfig,
  opts: { email: string; password: string; fullName?: string },
): Promise<AuthResult> {
  let cred;
  try {
    cred = await ops.createEmail(opts.email, opts.password);
  } catch (err) {
    throw toAuthError(err);
  }
  const fullName = opts.fullName || opts.email.split('@')[0];
  const user = await backend(cfg, 'POST', '/auth/register', cred.idToken, {
    email: opts.email,
    password: opts.password,
    full_name: fullName,
  });
  return { uid: cred.uid, user };
}

// Login: sign in via the SDK, then GET /auth/me (auto-creates the profile on
// first hit and returns roles for routing).
export async function loginUser(
  ops: SdkOps,
  cfg: RuntimeAuthConfig,
  opts: { email: string; password: string },
): Promise<AuthResult> {
  let cred;
  try {
    cred = await ops.signInEmail(opts.email, opts.password);
  } catch (err) {
    throw toAuthError(err);
  }
  const user = await backend(cfg, 'GET', '/auth/me', cred.idToken);
  return { uid: cred.uid, user };
}

export async function sendReset(ops: SdkOps, email: string): Promise<void> {
  try {
    await ops.sendReset(email);
  } catch (err) {
    throw toAuthError(err);
  }
}

// Dashboard path by role — mirrors the SPA's routeByRole (frontend
// src/features/auth/utils.ts) so a landing sign-in lands the user in the same
// place a SPA sign-in would: admins → /admin, tutors → /tutor, everyone else
// (students) → /student/. `base` is the app mount ("/app"); the SPA owns these
// paths under it.
export function dashboardPath(roles: string[] | undefined, base: string): string {
  const b = base.replace(/\/$/, ''); // "/app/" → "/app"
  const r = roles || [];
  if (r.includes('admin')) return b + '/admin';
  if (r.includes('tutor')) return b + '/tutor';
  return b + '/student/';
}

// Lightweight strength score 0..3: length + variety (lower/upper/digit/symbol).
export function scorePassword(v: string): 0 | 1 | 2 | 3 {
  if (!v || v.length < 6) return 0;
  let variety = 0;
  if (/[a-z]/.test(v)) variety++;
  if (/[A-Z]/.test(v)) variety++;
  if (/\d/.test(v)) variety++;
  if (/[^A-Za-z0-9]/.test(v)) variety++;
  if (v.length >= 12 && variety >= 3) return 3;
  if (v.length >= 8 && variety >= 2) return 2;
  return 1;
}
