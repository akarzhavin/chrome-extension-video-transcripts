/**
 * @jest-environment jsdom
 *
 * The diagnostics recorder's actions, as rows in the settings panel.
 *
 * They were a panel fixed over the page, and the cost was structural rather
 * than aesthetic: a floating control on a video player covers the player, and
 * the player is the thing a subtitle trace is being taken of.
 *
 * Two properties are worth a test. The rows must not exist for an app that
 * offers no recorder — that is every shipped build and both other sites — and
 * each row must call its own verb, because "Discard" wired to `clear` is
 * indistinguishable from "Download" wired to `clear` until someone loses a
 * recording.
 */

(global as any).chrome = {
    runtime: { id: 'test-extension-id', getManifest: () => ({ version: '0.0.0' }) },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};

import { AppState } from '../src/AppState';
import { SidebarUI } from '../src/SidebarUI';
import type { AppInterface } from '../src/types';

const baseApp: AppInterface = {
    updateHighlight: () => {},
    seekVideo: () => {},
};

const traceRows = (): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>('.vtt-trace-row')];

const rowLabelled = (text: string): HTMLElement | undefined =>
    traceRows().find((r) => (r.textContent ?? '').includes(text));

function build(app: AppInterface): SidebarUI {
    document.body.innerHTML = '';
    const ui = new SidebarUI(new AppState(), app);
    ui.init();
    return ui;
}

describe('an app with no recorder gets no rows', () => {
    test('nothing is rendered for a plain app', () => {
        // Settings opened, because that is where the rows get built — checking
        // before the open would pass for an app that DOES have a recorder.
        build(baseApp).openSettings();
        expect(traceRows()).toHaveLength(0);
    });

    test('nothing is rendered when traceActions answers null', () => {
        // The shape a production YouTube build takes: the method exists, the
        // recorder behind it does not.
        build({ ...baseApp, traceActions: () => null }).openSettings();
        expect(traceRows()).toHaveLength(0);
    });
});

describe('the recorder arrives after the sidebar is built', () => {
    // THE bug this file exists for, and the one the first version shipped with.
    //
    // The sidebar is constructed from the app's own constructor; the recorder
    // is stood up at the end of bootstrap and then awaits its storage hydrate.
    // So at panel-build time `traceActions()` answers null — and rows built at
    // that moment are no rows, for the life of the page. The controls simply
    // could not be found.
    //
    // Building them when settings open is what fixes it, and this test pins
    // that ordering rather than the fix's shape: the app below answers null
    // until a recorder is attached, exactly as the real one does.
    test('rows appear once settings are opened, not before', () => {
        let recorder: { sessions(): number; download(): void; copy(): Promise<boolean>; clear(): Promise<void> } | null = null;
        const ui = build({
            ...baseApp,
            traceActions: () => recorder,
        });

        // Panel built while the recorder is still null — the real order.
        expect(traceRows()).toHaveLength(0);

        recorder = {
            sessions: () => 2,
            download: () => {},
            copy: () => Promise.resolve(true),
            clear: () => Promise.resolve(),
        };
        ui.openSettings();

        expect(traceRows()).toHaveLength(3);
        expect(rowLabelled('Download')?.textContent).toContain('(2)');
    });

    test('a later open refreshes the count without stacking rows', () => {
        // The recorder keeps capturing while the panel is closed, so the count
        // has to be re-read — and re-reading must not append a second set.
        let sessions = 1;
        const ui = build({
            ...baseApp,
            traceActions: () => ({
                sessions: () => sessions,
                download: () => {},
                copy: () => Promise.resolve(true),
                clear: () => Promise.resolve(),
            }),
        });

        ui.openSettings();
        expect(rowLabelled('Download')?.textContent).toContain('(1)');

        sessions = 7;
        ui.toggleSettingsPanel();   // close
        ui.toggleSettingsPanel();   // open again

        expect(traceRows()).toHaveLength(3);
        expect(rowLabelled('Download')?.textContent).toContain('(7)');
    });
});

describe('with a recorder, each row calls its own verb', () => {
    const wire = () => {
        const calls = { download: 0, copy: 0, clear: 0 };
        const app: AppInterface = {
            ...baseApp,
            traceActions: () => ({
                sessions: () => 3,
                download: () => { calls.download++; },
                copy: () => { calls.copy++; return Promise.resolve(true); },
                clear: () => { calls.clear++; return Promise.resolve(); },
            }),
        };
        build(app).openSettings();
        return calls;
    };

    test('three rows appear', () => {
        wire();
        expect(traceRows()).toHaveLength(3);
    });

    test('Download calls download, and nothing else', () => {
        const calls = wire();
        rowLabelled('Download')?.click();
        expect(calls).toEqual({ download: 1, copy: 0, clear: 0 });
    });

    test('Copy calls copy, and nothing else', () => {
        const calls = wire();
        rowLabelled('Copy')?.click();
        expect(calls).toEqual({ download: 0, copy: 1, clear: 0 });
    });

    test('Discard calls clear, and nothing else', () => {
        // The one that costs a recording if it is miswired.
        const calls = wire();
        rowLabelled('Discard')?.click();
        expect(calls).toEqual({ download: 0, copy: 0, clear: 1 });
    });

    test('the session count is shown on the Download row', () => {
        // The only signal that says the recorder is capturing rather than
        // merely switched on.
        wire();
        expect(rowLabelled('Download')?.textContent).toContain('(3)');
    });

    test('a recorder with nothing captured does not download', () => {
        const calls = { download: 0 };
        build({
            ...baseApp,
            traceActions: () => ({
                sessions: () => 0,
                download: () => { calls.download++; },
                copy: () => Promise.resolve(true),
                clear: () => Promise.resolve(),
            }),
        }).openSettings();

        rowLabelled('Download')?.click();

        expect(calls.download).toBe(0);
        expect(rowLabelled('nothing recorded yet')).toBeDefined();
    });
});
