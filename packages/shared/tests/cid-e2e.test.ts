/**
 * analytics-bg and onboarding, wired together the way a background script
 * wires them — the seam neither module's own tests can see.
 *
 * The contract: the client id rides along to /welcome/ and /uninstall/, but an
 * install whose owner switched analytics off hands over a placeholder instead.
 * That case is not hypothetical — Chrome opens the uninstall URL whether or
 * not anyone consented, so this is the only thing standing between an opted-out
 * visitor and their identity landing in the site's request logs.
 */
const setUninstallURL = jest.fn();
const store: Record<string, unknown> = {};
(global as any).chrome = {
  runtime: {
    onInstalled: { addListener: () => {} },
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
    setUninstallURL, getManifest: () => ({ version: '1.0.18' }),
  },
  tabs: { create: jest.fn() },
  storage: {
    local: {
      get: async (k: string) => ({ [k]: store[k] }),
      set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
    },
  },
};
import { OPTED_OUT, installOnboarding } from '../src/onboarding';
import { markInstalled, onboardingClientId, _resetAnalyticsCacheForTests }
  from '../src/analytics-bg';

// The resolver a background script passes — the SHARED one, not a copy of its
// logic. A new edition wires `clientId: onboardingClientId` and is done; if
// this ever stops being a single shared function, these tests keep passing
// against the copy while a real edition drifts, so the import matters.
const resolver = onboardingClientId;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; _resetAnalyticsCacheForTests(); setUninstallURL.mockClear(); });

test('analytics ON: the real minted id reaches the uninstall URL', async () => {
  await markInstalled(Date.now());
  const minted = store['analytics.clientId'] as string;
  expect(minted).toMatch(/^[0-9a-f-]{36}$/);
  installOnboarding('rezka', { clientId: resolver });
  await settle();
  expect(setUninstallURL.mock.calls.at(-1)![0]).toContain(`cid=${minted}`);
});

test('analytics OFF: the placeholder goes instead, and the real id never appears', async () => {
  await markInstalled(Date.now());                    // id is minted regardless
  const minted = store['analytics.clientId'] as string;
  store['prefs.v1'] = { analyticsEnabled: false };    // ...then they opt out
  installOnboarding('rezka', { clientId: resolver });
  await settle();
  const url = setUninstallURL.mock.calls.at(-1)![0] as string;
  expect(url).toContain(`cid=${OPTED_OUT}`);
  expect(url).not.toContain(minted);
});

test('a brand-new edition inherits the rule by passing the shared resolver alone', async () => {
    // Stands in for tomorrow's apps/<something>/background.ts. It knows the
    // slug and nothing about consent, placeholders, or storage keys.
    await markInstalled(Date.now());
    store['prefs.v1'] = { analyticsEnabled: false };
    installOnboarding('netflix', { clientId: onboardingClientId });
    await settle();
    expect(setUninstallURL.mock.calls.at(-1)![0]).toContain(`cid=${OPTED_OUT}`);
});

test('the shared resolver falls to the placeholder when storage throws', async () => {
    const broken = { ...(global as any).chrome.storage.local };
    (global as any).chrome.storage.local.get = async () => { throw new Error('gone'); };
    await expect(onboardingClientId()).resolves.toBe(OPTED_OUT);
    (global as any).chrome.storage.local = broken;
});

test('concurrent callers agree on one id, and it is the one in storage', async () => {
    // markInstalled and the onboarding resolver both run in the install tick.
    // Without a shared in-flight promise each read empty storage, each minted,
    // and the later write replaced the earlier — so the welcome URL advertised
    // an id the extension no longer had. Caught in a real browser, not here.
    const [a, b] = await Promise.all([onboardingClientId(), onboardingClientId()]);
    expect(a).toBe(b);
    expect(store['analytics.clientId']).toBe(a);
});

test('install and the resolver together leave one id', async () => {
    await Promise.all([markInstalled(Date.now()), onboardingClientId()]);
    installOnboarding('rezka', { clientId: onboardingClientId });
    await settle();
    const url = setUninstallURL.mock.calls.at(-1)![0] as string;
    expect(url).toContain(`cid=${store['analytics.clientId']}`);
});
