/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://example.com/neutral.html"}
 */

// The page, not the AI badge, has the worker ask the features (spec 032). Imported on a
// non-rezka URL so bootstrap() bails out, then a real VttApp is built.

const sendMessage = jest.fn();
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage,
        onMessage: { addListener: jest.fn() },
        onMessageExternal: { addListener: jest.fn() },
        onInstalled: { addListener: jest.fn() },
        setUninstallURL: jest.fn(),
        lastError: undefined,
    },
    tabs: { create: jest.fn(), sendMessage: jest.fn() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        sync: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { VttApp } from '../src/content/index';

const featureAsks = () => sendMessage.mock.calls.filter((c) => c[0]?.action === 'FEATURES_REFRESH').length;

test('the top window that owns the sidebar asks once as the page opens', () => {
    document.body.innerHTML = '';
    const app: any = new VttApp();
    expect(app.uiOwned).toBe(true);
    expect(featureAsks()).toBe(1);
});
