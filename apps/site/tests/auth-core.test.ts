/**
 * Pure auth logic: password strength, error-message mapping, dashboard routing,
 * and the register/login/reset flows. The Firebase SDK is injected as a fake
 * SdkOps; the backend profile call goes through a mocked fetch. No DOM, no net.
 */
import {
  EMAIL_RE,
  firebaseMessage,
  scorePassword,
  dashboardPath,
  registerUser,
  loginUser,
  sendReset,
  toAuthError,
  AuthError,
  RuntimeAuthConfig,
  SdkOps,
} from '../src/auth/core';

const CFG: RuntimeAuthConfig = {
  env: 'dev',
  apiKey: 'demo-key',
  identityToolkitUrl: 'http://idtk.test',
  apiBase: 'http://api.test',
};

// Fake SDK ops. `fail` makes an op reject with a Firebase-style {code} error.
function fakeOps(overrides: Partial<Record<keyof SdkOps, unknown>> = {}): SdkOps {
  const ok = { idToken: 'ID', uid: 'UID', email: 'a@b.co' };
  const reject = (v: unknown) => Promise.reject(v);
  return {
    signInEmail: async () => (overrides.signInEmail ? reject(overrides.signInEmail) : ok),
    createEmail: async () => (overrides.createEmail ? reject(overrides.createEmail) : ok),
    sendReset: async () => { if (overrides.sendReset) return reject(overrides.sendReset); },
  };
}

// A programmable fetch double for the backend (/auth/*) call.
function mockFetch(responses: Array<{ ok: boolean; body: any }>) {
  const calls: Array<{ url: string; init: any }> = [];
  let i = 0;
  const fn = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const r = responses[i++] ?? { ok: true, body: {} };
    return {
      ok: r.ok,
      status: r.ok ? 200 : 400,
      statusText: r.ok ? 'OK' : 'Bad Request',
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as any;
  });
  (global as any).fetch = fn;
  return { fn, calls };
}

afterEach(() => jest.restoreAllMocks());

describe('EMAIL_RE', () => {
  it('accepts valid emails', () => {
    expect(EMAIL_RE.test('jane@example.com')).toBe(true);
    expect(EMAIL_RE.test('a.b+c@sub.domain.io')).toBe(true);
  });
  it('rejects invalid emails', () => {
    for (const bad of ['', 'jane', 'jane@', '@x.com', 'a b@c.com', 'a@b']) {
      expect(EMAIL_RE.test(bad)).toBe(false);
    }
  });
});

describe('scorePassword', () => {
  it('0 for too short / empty', () => {
    expect(scorePassword('')).toBe(0);
    expect(scorePassword('abc')).toBe(0);
    expect(scorePassword('a1b2')).toBe(0);
  });
  it('1 (weak) for length only, low variety', () => {
    expect(scorePassword('abcdefg')).toBe(1);
  });
  it('2 (okay) for 8+ chars and 2+ classes', () => {
    expect(scorePassword('testpass1')).toBe(2);
  });
  it('3 (strong) for 12+ chars and 3+ classes', () => {
    expect(scorePassword('Testpass123!xy')).toBe(3);
  });
});

describe('firebaseMessage', () => {
  it('maps known codes to human copy', () => {
    expect(firebaseMessage('EMAIL_EXISTS', 'fb')).toMatch(/already exists/i);
    expect(firebaseMessage('INVALID_LOGIN_CREDENTIALS', 'fb')).toMatch(/incorrect/i);
  });
  it('handles suffixed codes (e.g. "WEAK_PASSWORD : ...")', () => {
    expect(firebaseMessage('WEAK_PASSWORD : Password should be…', 'fb')).toMatch(/too weak/i);
  });
  it('falls back for unknown codes / no code', () => {
    expect(firebaseMessage('SOMETHING_NEW', 'fallback')).toBe('fallback');
    expect(firebaseMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('dashboardPath', () => {
  it('routes each role to its dashboard under the app base', () => {
    expect(dashboardPath(['admin'], '/app/')).toBe('/app/admin');
    expect(dashboardPath(['tutor'], '/app/')).toBe('/app/tutor');
    expect(dashboardPath(['student'], '/app/')).toBe('/app/student/');
  });
  it('defaults to the student dashboard for unknown/empty roles', () => {
    expect(dashboardPath([], '/app/')).toBe('/app/student/');
    expect(dashboardPath(undefined, '/app/')).toBe('/app/student/');
  });
  it('admin/tutor win over student when multiple roles present', () => {
    expect(dashboardPath(['student', 'tutor'], '/app/')).toBe('/app/tutor');
    expect(dashboardPath(['student', 'admin'], '/app/')).toBe('/app/admin');
  });
  it('handles a base without a trailing slash', () => {
    expect(dashboardPath(['tutor'], '/app')).toBe('/app/tutor');
  });
});

describe('toAuthError (SDK code mapping)', () => {
  it('maps SDK codes to human copy + keeps the code', () => {
    const e = toAuthError({ code: 'auth/email-already-in-use' });
    expect(e).toBeInstanceOf(AuthError);
    expect(e.firebaseCode).toBe('auth/email-already-in-use');
    expect(e.message).toMatch(/already exists/i);
    expect(toAuthError({ code: 'auth/invalid-credential' }).message).toMatch(/incorrect/i);
  });
  it('falls back for unknown codes', () => {
    expect(toAuthError({ code: 'auth/whatever' }).message).toMatch(/authentication failed/i);
  });
});

describe('registerUser', () => {
  it('creates the account via SDK, then POSTs /auth/register WITH password + full_name', async () => {
    const { calls } = mockFetch([{ ok: true, body: { id: 'UID', roles: ['student'] } }]);
    const res = await registerUser(fakeOps(), CFG, { email: 'jane@example.com', password: 'testpass123', fullName: 'Jane' });
    expect(res.uid).toBe('UID');
    expect(res.user.roles).toEqual(['student']);
    // Only the backend call hits fetch (the SDK is injected, not fetched).
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://api.test/auth/register');
    expect(calls[0].init.headers.Authorization).toBe('Bearer ID');
    expect(JSON.parse(calls[0].init.body)).toEqual({ email: 'jane@example.com', password: 'testpass123', full_name: 'Jane' });
  });

  it('falls back full_name to the email local-part when name is empty', async () => {
    const { calls } = mockFetch([{ ok: true, body: {} }]);
    await registerUser(fakeOps(), CFG, { email: 'solo@example.com', password: 'testpass123' });
    expect(JSON.parse(calls[0].init.body).full_name).toBe('solo');
  });

  it('throws AuthError carrying auth/email-already-in-use so callers can offer login', async () => {
    const ops = fakeOps({ createEmail: { code: 'auth/email-already-in-use' } });
    await expect(
      registerUser(ops, CFG, { email: 'dup@example.com', password: 'testpass123' }),
    ).rejects.toMatchObject({ firebaseCode: 'auth/email-already-in-use' });
  });

  it('surfaces a human message, not the raw code', async () => {
    const ops = fakeOps({ createEmail: { code: 'auth/email-already-in-use' } });
    await expect(
      registerUser(ops, CFG, { email: 'dup@example.com', password: 'testpass123' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('when the profile call fails after the account is created, throws an actionable AuthError (not the raw backend/network error)', async () => {
    // The Firebase account is created (SDK ok), but /auth/register returns 500 —
    // the exact preprod failure (SA lacked firebaseauth.admin) that reached users
    // as "Failed to fetch". The account exists, so the message must point to login.
    mockFetch([{ ok: false, body: 'Internal Server Error' }]);
    const err: any = await registerUser(fakeOps(), CFG, { email: 'new@example.com', password: 'testpass123' })
      .then(() => { throw new Error('expected rejection'); }, (e) => e);
    // Actionable message pointing to login; the raw "Could not reach" is suppressed.
    expect(err.message).toMatch(/account was created.*try logging in/i);
    expect(err.message).not.toMatch(/could not reach/i);
    // Carries the stable code entry.ts routes to offerLoginInstead (not a bare
    // Error, and not the raw HTTP status which would miss the guard).
    expect(err).toBeInstanceOf(AuthError);
    expect(err.firebaseCode).toBe('backend/register-failed');
  });
});

describe('loginUser', () => {
  it('signs in via SDK, then GETs /auth/me (no register call)', async () => {
    const { calls } = mockFetch([{ ok: true, body: { id: 'UID', roles: ['tutor'] } }]);
    const res = await loginUser(fakeOps(), CFG, { email: 'jane@example.com', password: 'pw' });
    expect(res.uid).toBe('UID');
    expect(res.user.roles).toEqual(['tutor']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://api.test/auth/me');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers.Authorization).toBe('Bearer ID');
  });

  it('maps bad credentials to a friendly message', async () => {
    const ops = fakeOps({ signInEmail: { code: 'auth/invalid-credential' } });
    await expect(loginUser(ops, CFG, { email: 'a@b.co', password: 'nope' })).rejects.toThrow(/incorrect/i);
  });
});

describe('sendReset', () => {
  it('delegates to the SDK sendReset op', async () => {
    let got = '';
    const ops = fakeOps();
    ops.sendReset = async (email: string) => { got = email; };
    await sendReset(ops, 'jane@example.com');
    expect(got).toBe('jane@example.com');
  });
  it('wraps a thrown SDK error as a friendly AuthError', async () => {
    const ops = fakeOps({ sendReset: { code: 'auth/user-not-found' } });
    await expect(sendReset(ops, 'nope@example.com')).rejects.toThrow(/incorrect/i);
  });
});
