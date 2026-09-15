/**
 * @jest-environment jsdom
 */

/**
 * The dev-only "Record subtitle diagnostics" row in the settings panel.
 *
 * Two claims, and the second is the one that matters: the row must exist in a
 * dev build, and it must not be CONSTRUCTED in a production one. Not hidden,
 * not disabled — absent, so the minifier can drop the builder with it.
 */

const prefsStore: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { id: 'test-extension-id', onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
    storage: {
        local: {
            get: jest.fn((key: string) =>
                Promise.resolve(key in prefsStore ? { [key]: prefsStore[key] } : {})),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(prefsStore, items);
                return Promise.resolve();
            }),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};
(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();
(window as any).Element.prototype.scrollTo = jest.fn();
(window as any).isTopWindow = true;

import { SidebarUI } from '../src/SidebarUI';
import { AppState } from '../src/AppState';
import { loadPrefs } from '../src/prefs';
import type { AppInterface } from '../src/types';

/** Build a real sidebar and hand back the settings panel's debug row, if any. */
function buildSidebar(): { toggle: HTMLInputElement | null; panel: HTMLElement | null } {
    document.body.innerHTML = '';
    const state = new AppState();
    const app: AppInterface = { seekVideo: jest.fn(), updateHighlight: jest.fn() };
    const ui = new SidebarUI(state, app);
    ui.init();
    return {
        toggle: document.getElementById('vtt-debug-toggle') as HTMLInputElement | null,
        panel: document.getElementById('vtt-settings-panel'),
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    for (const k of Object.keys(prefsStore)) delete prefsStore[k];
    (global as any).__EXT_ENV__ = 'dev';
});

afterAll(() => {
    (global as any).__EXT_ENV__ = 'dev';
});

describe('in a dev build', () => {
    test('the row is in the settings panel', () => {
        const { toggle, panel } = buildSidebar();

        expect(panel).not.toBeNull();
        expect(toggle).not.toBeNull();
        expect(toggle!.type).toBe('checkbox');
        expect(panel!.contains(toggle!)).toBe(true);
    });

    test('it is the LAST row, below the product settings it is not one of', () => {
        const { toggle, panel } = buildSidebar();

        const rows = Array.from(panel!.querySelectorAll('.vtt-panel-row'));
        const last = rows[rows.length - 1];
        expect(last.contains(toggle!)).toBe(true);
    });

    test('it paints the default immediately, then corrects from storage', async () => {
        // Seeded rather than hardcoded off: on a dev build the default is ON,
        // and a switch that renders off for a frame reads as "the recorder is
        // not running" at exactly the moment someone is checking whether it is.
        prefsStore['prefs.v1'] = { debugMode: false };

        const { toggle } = buildSidebar();
        expect(toggle!.checked).toBe(true); // the dev default, before storage answers
        await flush();

        expect(toggle!.checked).toBe(false); // the stored opt-out wins
    });

    test('a stored opt-in is reflected too', async () => {
        prefsStore['prefs.v1'] = { debugMode: true };

        const { toggle } = buildSidebar();
        await flush();

        expect(toggle!.checked).toBe(true);
    });

    test('flipping it writes the preference', async () => {
        const { toggle } = buildSidebar();
        await flush();

        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change'));
        await flush();

        expect((await loadPrefs()).debugMode).toBe(true);
    });

    test('flipping it back writes false rather than removing the field', async () => {
        prefsStore['prefs.v1'] = { debugMode: true };
        const { toggle } = buildSidebar();
        await flush();

        toggle!.checked = false;
        toggle!.dispatchEvent(new Event('change'));
        await flush();

        expect((await loadPrefs()).debugMode).toBe(false);
    });

    test('its tooltip warns that the report is a credential', () => {
        const { toggle } = buildSidebar();
        const row = toggle!.closest('.vtt-panel-row') as HTMLElement;

        // The file carries signed caption URLs and pot tokens. The warning
        // lives where the feature is turned on, not only in a doc.
        expect(row.title).toMatch(/do not share/i);
    });

    test('it adds no i18n key, so the 54 locales stay in step', () => {
        // locale-coverage.test.ts fails every non-en locale when a key is added
        // to en alone. A dev-only string read by one person on one machine is
        // not worth 53 locale edits — the backend switch says `backend: …` for
        // the same reason.
        const { toggle } = buildSidebar();
        const row = toggle!.closest('.vtt-panel-row') as HTMLElement;

        expect(row.textContent).toContain('Record subtitle diagnostics');
    });
});

describe('in a production build', () => {
    test('the row is never constructed', () => {
        (global as any).__EXT_ENV__ = 'prod';

        const { toggle, panel } = buildSidebar();

        // Absent, not hidden: a row that shipped disabled would still be in the
        // DOM for anyone reading the page, and its builder would still be in
        // the bundle.
        expect(panel).not.toBeNull(); // the panel itself still exists
        expect(toggle).toBeNull();
    });

    test('no leftover row occupies the slot', () => {
        (global as any).__EXT_ENV__ = 'prod';

        const { panel } = buildSidebar();

        const texts = Array.from(panel!.querySelectorAll('.vtt-panel-row')).map((r) => r.textContent ?? '');
        expect(texts.some((t) => t.includes('diagnostics'))).toBe(false);
    });
});
