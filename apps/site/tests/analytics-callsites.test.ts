/**
 * The analytics call sites outside the analytics bundle: the hero demo and the
 * auth pages.
 *
 * Both are separate Vite builds that reach analytics.js only through the global
 * `window.lgTrack`, and both self-execute on import (the demo mounts a player,
 * entry.ts reads window.LINGOGRAM_AUTH and binds forms). Driving them through
 * a mocked Firebase SDK and a mocked embed package would mostly assert that the
 * mocks were wired correctly, so the split here is deliberate:
 *
 *  - the CONTRACT between those bundles and the analytics one is exercised for
 *    real, against the same modules analytics.js is built from, because that is
 *    where a mismatch actually bites (a renamed global silently stops every
 *    demo and auth event);
 *  - the call sites themselves are read as source, which is enough to pin the
 *    things that matter about them: the event names, that no PII rides along,
 *    that demo events are gated once per page load, and that the Google button
 *    picks its event name from the path.
 *
 * A source assertion is a weaker test than a behavioural one and is used here
 * only where the behavioural version would test the harness instead.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../src');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

const DEMO = read('demo/index.ts');
const ENTRY = read('auth/entry.ts');
const GOOGLE = read('auth/google.ts');
const ANALYTICS_ENTRY = read('analytics/index.ts');

describe('the window.lgTrack contract', () => {
  it('is the single name every other bundle calls through', () => {
    // Renaming this global in the analytics entry without touching the three
    // consumers would stop every demo and auth event with no error anywhere.
    expect(ANALYTICS_ENTRY).toContain('window.lgTrack = track');
    for (const [name, src] of [['demo', DEMO], ['entry', ENTRY], ['google', GOOGLE]] as const) {
      expect([name, /lgTrack\?\.\(/.test(src)]).toEqual([name, true]);
    }
  });

  it('is optional at every call site, so a page without analytics.js cannot break', () => {
    // auth.js is a module script: it runs after the analytics bundle's defer,
    // but a future page could load it alone. Every call uses ?. and sits inside
    // try/catch.
    for (const [name, src] of [['demo', DEMO], ['entry', ENTRY], ['google', GOOGLE]] as const) {
      expect([name, src.includes('lgTrack?.(')]).toEqual([name, true]);
    }
  });

  it('really is a no-op when the tag was never built', () => {
    // The behavioural half: boot the analytics entry with no LG_GA4 and confirm
    // the global still exists and still swallows the call.
    document.body.innerHTML = '';
    const calls: unknown[][] = [];
    (window as unknown as { gtag: unknown }).gtag = (...a: unknown[]) => calls.push(a);
    delete (window as unknown as { LG_GA4?: string }).LG_GA4;
    jest.isolateModules(() => {
      require('../src/analytics/index');
    });
    const lgTrack = (window as unknown as { lgTrack: (n: string, p?: unknown) => void }).lgTrack;
    expect(typeof lgTrack).toBe('function');
    expect(() => lgTrack('demo_word_saved')).not.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('demo events', () => {
  it('are gated once per event name per page load', () => {
    // The mode slider auto-advances on a timer and the demo remounts on
    // playback failure, so an ungated send would report engagement for a
    // visitor who touched nothing — inflating the very number this measures.
    expect(DEMO).toContain('const demoSent = new Set<string>()');
    expect(DEMO).toMatch(/if \(demoSent\.has\(name\)\) return;\s*\n\s*demoSent\.add\(name\);/);
  });

  it('keeps the gate OUTSIDE the mount, so a remount cannot re-arm it', () => {
    // If `demoSent` moved inside mountFile(), the YouTube→file fallback would
    // hand every visitor a second set of events. The Set must be declared
    // before both mount paths that close over it.
    const gate = DEMO.indexOf('const demoSent');
    const mountFile = DEMO.indexOf('const mountFile');
    const ytMount = DEMO.indexOf('youtubeVideoId: demoSubs.youtubeVideoId');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(mountFile);
    expect(gate).toBeLessThan(ytMount);
  });

  it('reports the two events the page is asking about', () => {
    expect(DEMO).toContain("trackDemo('demo_mode_change', { mode: m })");
    expect(DEMO).toContain("trackDemo('demo_word_saved')");
  });

  it('wires both mount paths, so the fallback is not a blind spot', () => {
    // mountFile() (local mp4) and the YouTube mount each get their own
    // callbacks; instrumenting only one would lose every visitor whose embed
    // was refused.
    expect(DEMO.match(/onModeChange: \(m\) => \{ trackDemo\('demo_mode_change'/g)).toHaveLength(2);
    expect(DEMO.match(/onWordSaved: \(\) => trackDemo\('demo_word_saved'\)/g)).toHaveLength(2);
  });

  it('never lets analytics break the demo', () => {
    expect(DEMO).toMatch(/catch \(e\) \{ \/\* analytics must never break the demo \*\/ \}/);
  });
});

describe('auth events', () => {
  it('reports sign_up and login with the method that was used', () => {
    expect(ENTRY).toContain("track('sign_up', 'password')");
    expect(ENTRY).toContain("track('login', 'password')");
    expect(GOOGLE).toContain("method: 'google'");
  });

  it('fires only after the attempt succeeded', () => {
    // Both calls sit after their await and before the redirect: a failed
    // attempt is not a login, and an early send would count one.
    const signUp = ENTRY.indexOf("track('sign_up', 'password')");
    const signUpRedirect = ENTRY.indexOf('location.href = dashboardPath(result.user?.roles', signUp);
    expect(signUp).toBeGreaterThan(-1);
    expect(signUpRedirect).toBeGreaterThan(signUp);

    const login = ENTRY.indexOf("track('login', 'password')");
    const loginRedirect = ENTRY.indexOf('location.href = dashboardPath(user?.roles', login);
    expect(login).toBeGreaterThan(-1);
    expect(loginRedirect).toBeGreaterThan(login);
  });

  it('picks the Google event name from the path, not from a guess', () => {
    // One button serves /login/ and /register/, including their localized
    // /<lang>/ forms, so the path is what distinguishes them. Firebase's own
    // isNewUser lives behind an import this bundle does not otherwise need.
    expect(GOOGLE).toContain("location.pathname.indexOf('/register') !== -1 ? 'sign_up' : 'login'");
  });

  it('carries the method and nothing else', () => {
    // The site tag and the account must stay unjoinable: /privacy/site/ says so
    // in as many words. This fails if a call site ever adds an email or a uid.
    expect(ENTRY).toMatch(/lgTrack\?\.\(name, \{ method \}\)/);
    expect(GOOGLE).toMatch(/lgTrack\?\.\(name, \{ method: 'google' \}\)/);
    for (const [name, src] of [['entry', ENTRY], ['google', GOOGLE]] as const) {
      const calls = [...src.matchAll(/lgTrack\?\.\([^)]*\)/g)].map((m) => m[0]);
      expect([name, calls.length > 0]).toEqual([name, true]);
      for (const call of calls) {
        expect([name, call, /email|uid|user_id|password/i.test(call)]).toEqual([name, call, false]);
      }
    }
  });
});
