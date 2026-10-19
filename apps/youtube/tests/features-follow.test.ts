// The page, not the AI badge, has the worker ask the features (spec 032): once as it opens, and on a
// return to the tab at most once a minute. The badge and the translation gate both read that answer.

const sendMessage = jest.fn();
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage,
        getManifest: () => ({ version: '1.0.0' }),
        lastError: undefined,
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { BaseVttApp } from '../src/content/app-base';

class TestApp extends BaseVttApp {
    constructor() {
        super();
        this.init();
    }
    getVideoId(): string | null {
        return 'vid1';
    }
    getOverlayParent(): HTMLElement | null {
        return null;
    }
    seekVideo(): void {}
    reprocessCurrentVideo(): void {}
    startSite(): void {}
}

const featureAsks = () => sendMessage.mock.calls.filter((c) => c[0]?.action === 'FEATURES_REFRESH').length;
const show = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
};

test('a page asks once as it opens, and again on a return to the tab after a minute', () => {
    const NOW = Date.UTC(2026, 9, 19, 7, 0, 0);
    jest.useFakeTimers({ now: NOW });
    try {
        document.body.innerHTML = '';
        new TestApp();
        expect(featureAsks()).toBe(1);
        jest.setSystemTime(NOW + 59_000);
        show('visible');
        expect(featureAsks()).toBe(1);
        jest.setSystemTime(NOW + 61_000);
        show('hidden');
        show('visible');
        expect(featureAsks()).toBe(2);
    } finally {
        jest.useRealTimers();
    }
});
