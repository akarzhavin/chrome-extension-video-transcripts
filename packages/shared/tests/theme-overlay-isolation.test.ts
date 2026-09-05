/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
 *
 * The panel's theme and the captions' appearance are two separate settings —
 * behaviour map §10.13. Switching the panel between light and dark must leave
 * every caption variable exactly as the user set it.
 *
 * They are easy to conflate: both are "how it looks", and a light panel over
 * white captions is a plausible thing to want to fix in applyTheme. Doing so
 * would silently overwrite deliberate choices — a caption colour the user
 * picked for their own eyesight, reset by opening a menu.
 *
 * The address is set for the whole file because the dark-only site refuses the
 * theme outright (theme-netflix.test.ts covers that), which would make every
 * assertion here vacuously true.
 */
import { applyTheme, stopThemeTracking, themeAvailable } from '../src/content/theme';

// Every caption variable the panel writes, from the setProperty block in
// SidebarUI.applyOverlayStyle. Pinned as a list rather than discovered, so a
// variable that stops being written here fails loudly instead of quietly
// shrinking what this file checks.
const OVERLAY_VARS = [
    '--vtt-overlay-font-family',
    '--vtt-overlay-font-variant',
    '--vtt-overlay-font-size',
    '--vtt-overlay-color',
    '--vtt-overlay-sub-font-size',
    '--vtt-overlay-sub-color',
    '--vtt-overlay-text-opacity',
    '--vtt-overlay-bg-color',
    '--vtt-overlay-bg-opacity',
    '--vtt-overlay-bottom',
    '--vtt-overlay-nudge',
    '--vtt-overlay-inline-nudge',
];

// Values a user would recognise as theirs: a yellow caption at 150%, nudged
// off centre. Nothing here is a default, so an overwrite to any default shows.
const CHOSEN: Record<string, string> = {
    '--vtt-overlay-font-family': 'Georgia, serif',
    '--vtt-overlay-font-variant': 'normal',
    '--vtt-overlay-font-size': '36px',
    '--vtt-overlay-color': '#ffd700',
    '--vtt-overlay-sub-font-size': '30px',
    '--vtt-overlay-sub-color': '#00e5ff',
    '--vtt-overlay-text-opacity': '0.9',
    '--vtt-overlay-bg-color': '#0a1a3c',
    '--vtt-overlay-bg-opacity': '0.55',
    '--vtt-overlay-bottom': '12%',
    '--vtt-overlay-nudge': '3%',
    '--vtt-overlay-inline-nudge': '-2%',
};

/** The caption element, dressed as a user who has been through settings. */
function overlayWithChosenLook(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'vtt-video-overlay';
    for (const [k, v] of Object.entries(CHOSEN)) el.style.setProperty(k, v);
    document.body.appendChild(el);
    return el;
}

const snapshot = (el: HTMLElement): Record<string, string> =>
    Object.fromEntries(OVERLAY_VARS.map((v) => [v, el.style.getPropertyValue(v)]));

beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).matchMedia = jest.fn(() => ({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    }));
});

afterEach(() => {
    stopThemeTracking();
    document.documentElement.classList.remove('vtt-light');
    document.documentElement.removeAttribute('style');
});

test('the theme is available here — the premise the rest of this file rests on', () => {
    expect(themeAvailable()).toBe(true);
});

test('the chosen caption look survives a switch to light and back to dark', () => {
    const el = overlayWithChosenLook();
    const before = snapshot(el);
    // Pinned to the literals, not to whatever the element happens to hold:
    // comparing a snapshot with itself would pass over an empty element.
    expect(before).toEqual(CHOSEN);

    applyTheme('light');
    expect(document.documentElement.classList.contains('vtt-light')).toBe(true);
    expect(snapshot(el)).toEqual(CHOSEN);

    applyTheme('dark');
    expect(document.documentElement.classList.contains('vtt-light')).toBe(false);
    expect(snapshot(el)).toEqual(CHOSEN);
});

test('"auto" leaves them alone too', () => {
    const el = overlayWithChosenLook();
    applyTheme('auto');
    expect(snapshot(el)).toEqual(CHOSEN);
});

// The variables also have a home on <html>, where the panel's own tokens live.
// A theme that wrote captions globally would land here rather than on the
// element above, so the check that only watches the element would miss it.
test('no caption variable is written to the document root either', () => {
    for (const theme of ['light', 'dark', 'auto'] as const) applyTheme(theme);
    const root = document.documentElement.style;
    for (const v of OVERLAY_VARS) expect(root.getPropertyValue(v)).toBe('');
});
