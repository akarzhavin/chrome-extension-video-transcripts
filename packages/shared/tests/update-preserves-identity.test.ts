/** An UPDATE must leave the existing identity and install date untouched. */
const listeners: Array<(d: any) => void> = [];
const store: Record<string, unknown> = {
  'analytics.clientId': 'EXISTING-USER-UUID-1234',
  'analytics.installedAt': 1750000000000,
};
const tabsCreate = jest.fn();
(global as any).chrome = {
  runtime: {
    onInstalled: { addListener: (fn: any) => listeners.push(fn) },
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
    setUninstallURL: jest.fn(), getManifest: () => ({ version: '1.0.19' }),
  },
  tabs: { create: tabsCreate },
  storage: { local: {
    get: async (k: any) => (k === null ? { ...store } : { [k]: store[k as string] }),
    set: async (o: any) => { Object.assign(store, o); },
  } },
};
import { installOnboarding } from '../src/onboarding';
import { onboardingClientId, _resetAnalyticsCacheForTests } from '../src/analytics-bg';

test('an update keeps the id a long-time install already has', async () => {
  _resetAnalyticsCacheForTests();
  installOnboarding('rezka', { clientId: onboardingClientId, onUpdate: () => {} });
  listeners.forEach((fn) => fn({ reason: 'update', previousVersion: '1.0.18' }));
  await new Promise((r) => setTimeout(r, 0));

  expect(store['analytics.clientId']).toBe('EXISTING-USER-UUID-1234');
  expect(store['analytics.installedAt']).toBe(1750000000000);
  expect(tabsCreate).not.toHaveBeenCalled();   // no welcome tab on an update
});

test('and the uninstall URL carries that same existing id', async () => {
  _resetAnalyticsCacheForTests();
  const calls: string[] = [];
  (global as any).chrome.runtime.setUninstallURL = (u: string) => calls.push(u);
  installOnboarding('rezka', { clientId: onboardingClientId });
  await new Promise((r) => setTimeout(r, 0));
  expect(calls.at(-1)).toContain('cid=EXISTING-USER-UUID-1234');
});
