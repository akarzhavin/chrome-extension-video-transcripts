/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.netflix.com/watch/80100172"}
 *
 * The theme control does not exist on the dark-only site — behaviour map
 * §10.37. `themeAvailable()` had no test of any kind: not one file in either
 * suite referenced it.
 *
 * Breaking it either paints a light panel over that site's black chrome, or
 * leaves a control there that changes nothing. The site itself is out of scope
 * for this work; this code is not, and the address is set for the whole file
 * because jsdom will not let a test move it afterwards.
 */
import { applyTheme, stopThemeTracking, themeAvailable } from '../src/content/theme';

function installMatchMedia(dark: boolean) {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    const mql = {
        matches: dark,
        addEventListener: jest.fn((_: string, l: any) => { listeners.push(l); }),
        removeEventListener: jest.fn(),
    };
    (window as any).matchMedia = jest.fn(() => mql);
    return { get count() { return listeners.length; } };
}

const isLight = () => document.documentElement.classList.contains('vtt-light');

afterEach(() => {
    stopThemeTracking();
    document.documentElement.classList.remove('vtt-light');
});

test('the theme is unavailable on the dark-only site', () => {
    expect(location.hostname).toBe('www.netflix.com'); // the premise, stated
    expect(themeAvailable()).toBe(false);
});

test('a stored light theme is ignored there, not honoured', () => {
    // Forced off rather than left alone: a previous page may have set it.
    document.documentElement.classList.add('vtt-light');
    applyTheme('light');
    expect(isLight()).toBe(false);
});

test('"auto" never subscribes to the operating system there', () => {
    const os = installMatchMedia(false); // the OS asks for light
    applyTheme('auto');
    expect(isLight()).toBe(false);
    expect(os.count).toBe(0);
});
