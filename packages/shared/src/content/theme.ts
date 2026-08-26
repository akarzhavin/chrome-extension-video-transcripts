// Panel theme — the one place that decides whether the in-page UI is light.
//
// Everything downstream is CSS: styles.css keys its light palette off a single
// `vtt-light` class on <html>. This module owns when that class is on.
//
// 'auto' is the reason this is not two lines inline. It has to keep tracking
// the OS after the page has loaded — a user flipping their system to dark mode
// while a video plays should see the panel follow — so the media query is
// subscribed to, not merely sampled, and the subscription has to be torn down
// and rebuilt whenever the preference itself changes.
import { loadPrefs, type ThemeToken } from '../prefs';

const LIGHT_CLASS = 'vtt-light';
const DARK_QUERY = '(prefers-color-scheme: dark)';

// Kept at module scope so a second applyTheme() call replaces the first
// listener instead of stacking another one on top of it.
let mql: MediaQueryList | null = null;
let onSystemChange: ((e: MediaQueryListEvent) => void) | null = null;

function setLight(light: boolean): void {
    document.documentElement.classList.toggle(LIGHT_CLASS, light);
}

function systemPrefersDark(): boolean {
    // matchMedia is absent in some embedded webviews; treating that as "dark"
    // keeps the shipped default rather than flipping the UI on a probe failure.
    return typeof window.matchMedia !== 'function' || window.matchMedia(DARK_QUERY).matches;
}

function unsubscribe(): void {
    if (mql && onSystemChange) mql.removeEventListener('change', onSystemChange);
    mql = null;
    onSystemChange = null;
}

/** Apply a theme token, subscribing to the OS only while 'auto' is selected. */
export function applyTheme(theme: ThemeToken): void {
    unsubscribe();

    if (theme !== 'auto') {
        setLight(theme === 'light');
        return;
    }

    setLight(!systemPrefersDark());
    if (typeof window.matchMedia !== 'function') return;
    mql = window.matchMedia(DARK_QUERY);
    onSystemChange = (e) => setLight(!e.matches);
    mql.addEventListener('change', onSystemChange);
}

/**
 * Read the stored theme and apply it.
 *
 * Call as early as the content script runs: the class must land on <html>
 * before the panel is built, or it paints dark and then repaints. Storage is
 * async, so a pinned 'light' still shows one frame of dark — acceptable, since
 * the alternative is blocking UI construction on a storage read.
 */
export async function initTheme(): Promise<void> {
    try {
        const prefs = await loadPrefs();
        applyTheme(prefs.theme);
    } catch {
        // loadPrefs already falls back to defaults; a throw here means storage
        // is unreachable entirely, in which case the shipped dark panel — the
        // class simply never being added — is the right resting state.
    }
}
