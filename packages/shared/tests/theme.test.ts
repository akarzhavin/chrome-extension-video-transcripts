/**
 * @jest-environment jsdom
 */
import { applyTheme, stopThemeTracking, themeAvailable } from '../src/content/theme';

// A controllable prefers-color-scheme, so a test can flip the OS mid-run.
function installMatchMedia(dark: boolean) {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    const mql = {
        matches: dark,
        addEventListener: jest.fn((_: string, l: any) => { listeners.push(l); }),
        removeEventListener: jest.fn((_: string, l: any) => {
            const i = listeners.indexOf(l);
            if (i >= 0) listeners.splice(i, 1);
        }),
    };
    (window as any).matchMedia = jest.fn(() => mql);
    return {
        mql,
        // Emit a change the way the browser would, only to live listeners.
        flipTo(nowDark: boolean) {
            mql.matches = nowDark;
            [...listeners].forEach((l) => l({ matches: nowDark } as MediaQueryListEvent));
        },
        get count() { return listeners.length; },
    };
}

const isLight = () => document.documentElement.classList.contains('vtt-light');

describe('panel theme', () => {
    beforeEach(() => {
        document.documentElement.className = '';
        stopThemeTracking();
    });

    test("'auto' follows the OS after the page has loaded", () => {
        const os = installMatchMedia(true);
        applyTheme('auto');
        expect(isLight()).toBe(false);
        os.flipTo(false);
        expect(isLight()).toBe(true);
    });

    test('stopThemeTracking drops the OS subscription', () => {
        // The listener is module-scoped, so it outlives the panel that created
        // it: after a destroy() an OS flip must no longer touch <html>, or the
        // global palette tokens get toggled on a page with no panel at all.
        const os = installMatchMedia(true);
        applyTheme('auto');
        expect(os.count).toBe(1);

        stopThemeTracking();
        expect(os.count).toBe(0);

        os.flipTo(false);
        expect(isLight()).toBe(false);
    });

    test('a second applyTheme replaces the listener instead of stacking one', () => {
        const os = installMatchMedia(true);
        applyTheme('auto');
        applyTheme('auto');
        expect(os.count).toBe(1);
    });

    test('pinning a theme unsubscribes from the OS', () => {
        const os = installMatchMedia(true);
        applyTheme('auto');
        applyTheme('light');
        expect(isLight()).toBe(true);
        expect(os.count).toBe(0);
        // An OS flip must not override a pinned choice.
        os.flipTo(true);
        expect(isLight()).toBe(true);
    });
});
