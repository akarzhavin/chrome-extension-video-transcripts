// The two Chrome APIs that hand a visitor off to lingogram.ai: a welcome tab
// on install, and the uninstall URL Chrome opens when the extension is
// removed. Neither is observable from inside the product — the uninstall page
// is loaded by the browser after our code is gone — so a wrong slug or a
// dropped setUninstallURL would fail silently and cost us every uninstall
// answer until someone noticed the feedback inbox was empty. These tests are
// the only place that contract is checked.

const onInstalledListeners: Array<(d: any) => void> = [];
const setUninstallURL = jest.fn();
const tabsCreate = jest.fn(() => Promise.resolve({} as any));

(global as any).chrome = {
    runtime: {
        onInstalled: {
            addListener: (fn: (d: any) => void) => onInstalledListeners.push(fn),
        },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
        setUninstallURL,
        getManifest: () => ({ version: '1.0.18' }),
    },
    tabs: { create: tabsCreate },
};

import { OPTED_OUT, installOnboarding } from '../src/onboarding';

// The build-time base URL the auth flow uses; onboarding.ts reads it through
// auth/config, which jest.setup.ts fills with the production default.
import { config } from '../src/auth/config';

/** Lets a test await the promise chains installOnboarding kicks off. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function fireInstalled(details: any): void {
    onInstalledListeners.forEach((fn) => fn(details));
}

beforeEach(() => {
    onInstalledListeners.length = 0;
    setUninstallURL.mockClear();
    tabsCreate.mockClear();
});

describe('setUninstallURL', () => {
    it('is registered at startup, before any event fires', () => {
        installOnboarding('youtube');
        expect(setUninstallURL).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['youtube'],
        ['rezka'],
        ['netflix'],
    ] as const)('points %s at /uninstall/ with its own ext slug', (ext) => {
        installOnboarding(ext);
        expect(setUninstallURL).toHaveBeenCalledWith(
            `${config.frontendBaseUrl}/uninstall/?ext=${ext}`,
        );
    });

    it('uses the same origin the auth flow does, so a preprod build stays on preprod', () => {
        installOnboarding('rezka');
        const url: string = setUninstallURL.mock.calls[0][0];
        expect(url.startsWith(config.frontendBaseUrl)).toBe(true);
    });

    // The site renders /uninstall/ per language under /<lang>/, but there is no
    // Accept-Language redirect, so the hardcoded link owns the English path.
    // A trailing-slash slip would 404 the page Chrome opens.
    it('keeps the trailing slash the site builds the page at', () => {
        installOnboarding('youtube');
        expect(setUninstallURL.mock.calls[0][0]).toContain('/uninstall/?');
    });
});

describe('welcome tab', () => {
    it('opens on install, carrying the same slug', () => {
        installOnboarding('rezka');
        fireInstalled({ reason: 'install' });
        expect(tabsCreate).toHaveBeenCalledWith({
            url: `${config.frontendBaseUrl}/welcome/?ext=rezka`,
        });
    });

    it('does not reopen on update', () => {
        installOnboarding('youtube');
        fireInstalled({ reason: 'update', previousVersion: '1.0.17' });
        expect(tabsCreate).not.toHaveBeenCalled();
    });

    it('fires the install hook before the tab, so the event beats teardown', () => {
        const order: string[] = [];
        tabsCreate.mockImplementation(() => {
            order.push('tab');
            return Promise.resolve({} as any);
        });
        installOnboarding('youtube', { onInstall: () => order.push('hook') });
        fireInstalled({ reason: 'install' });
        expect(order).toEqual(['hook', 'tab']);
    });

    it('passes the previous version to the update hook', () => {
        const onUpdate = jest.fn();
        installOnboarding('youtube', { onUpdate });
        fireInstalled({ reason: 'update', previousVersion: '1.0.17' });
        expect(onUpdate).toHaveBeenCalledWith('1.0.17');
    });

    it('survives an update event with no previousVersion', () => {
        const onUpdate = jest.fn();
        installOnboarding('youtube', { onUpdate });
        fireInstalled({ reason: 'update' });
        expect(onUpdate).toHaveBeenCalledWith('');
    });
});

describe('the analytics client id rides along on both onboarding URLs', () => {
    // Why this matters: /welcome/ and /uninstall/ are the two ends of the
    // funnel, and without a shared id an uninstall cannot be joined to the
    // install it ended. The switch still governs — Chrome opens the uninstall
    // page regardless of consent, so an opted-out install must not leak one.

    it('puts the id on the uninstall URL', async () => {
        installOnboarding('rezka', { clientId: async () => 'cid-abc' });
        await settle();
        expect(setUninstallURL).toHaveBeenLastCalledWith(
            `${config.frontendBaseUrl}/uninstall/?ext=rezka&cid=cid-abc`,
        );
    });

    it('registers a working uninstall URL before the id is known', () => {
        // Synchronously, on the very first call: a worker torn down mid-read
        // must not be left with no uninstall URL at all.
        installOnboarding('rezka', { clientId: async () => 'cid-abc' });
        expect(setUninstallURL.mock.calls[0][0]).toBe(
            `${config.frontendBaseUrl}/uninstall/?ext=rezka`,
        );
    });

    it('sends the placeholder, not the real id, when analytics is off', async () => {
        installOnboarding('rezka', { clientId: async () => OPTED_OUT });
        await settle();
        const url = setUninstallURL.mock.calls.at(-1)![0] as string;
        expect(url).toContain(`cid=${OPTED_OUT}`);
        expect(OPTED_OUT).not.toMatch(/^[0-9a-f-]{36}$/);
    });

    it('puts the id on the welcome tab too', async () => {
        installOnboarding('youtube', { clientId: async () => 'cid-abc' });
        fireInstalled({ reason: 'install' });
        await settle();
        expect(tabsCreate).toHaveBeenCalledWith({
            url: `${config.frontendBaseUrl}/welcome/?ext=youtube&cid=cid-abc`,
        });
    });

    it('still hands off when the id cannot be read', async () => {
        installOnboarding('rezka', {
            clientId: async () => {
                throw new Error('storage is gone');
            },
        });
        fireInstalled({ reason: 'install' });
        await settle();
        // The bare URL from the synchronous registration stands.
        expect(setUninstallURL).toHaveBeenLastCalledWith(
            `${config.frontendBaseUrl}/uninstall/?ext=rezka`,
        );
        expect(tabsCreate).toHaveBeenCalledWith({
            url: `${config.frontendBaseUrl}/welcome/?ext=rezka`,
        });
    });

    it('omits cid entirely for a build that passes no resolver', async () => {
        installOnboarding('rezka');
        fireInstalled({ reason: 'install' });
        await settle();
        expect(setUninstallURL).toHaveBeenLastCalledWith(
            `${config.frontendBaseUrl}/uninstall/?ext=rezka`,
        );
    });

    it('percent-encodes the id rather than trusting it', async () => {
        installOnboarding('rezka', { clientId: async () => 'a&b=c' });
        await settle();
        expect(setUninstallURL).toHaveBeenLastCalledWith(
            `${config.frontendBaseUrl}/uninstall/?ext=rezka&cid=a%26b%3Dc`,
        );
    });
});
