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

/** The clickable actions, without the status readout that sits beside them. */
const actionButtons = (): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>('button.vtt-trace-row')];

/**
 * The actions are icon buttons now, so their identity lives in `title` rather
 * than in visible text — which is precisely why each one still needs a test:
 * an unlabelled button wired to the wrong verb looks correct.
 */
const actionTitled = (title: string): HTMLElement | undefined =>
    actionButtons().find((b) => (b.title ?? '').toLowerCase().includes(title.toLowerCase()));

/** The count/feedback element: the one non-button in the cluster. */
const status = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('#vtt-trace-rows .vtt-trace-row:not(button)');

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

        expect(actionButtons()).toHaveLength(3);
        expect(status()?.textContent).toBe('2');
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
        expect(status()?.textContent).toBe('1');

        sessions = 7;
        ui.toggleSettingsPanel();   // close
        ui.toggleSettingsPanel();   // open again

        expect(actionButtons()).toHaveLength(3);
        expect(status()?.textContent).toBe('7');
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

    test('three actions appear', () => {
        wire();
        expect(actionButtons()).toHaveLength(3);
    });

    test('Download calls download, and nothing else', () => {
        const calls = wire();
        actionTitled('Download trace')?.click();
        expect(calls).toEqual({ download: 1, copy: 0, clear: 0 });
    });

    test('Copy calls copy, and nothing else', () => {
        const calls = wire();
        actionTitled('Copy trace')?.click();
        expect(calls).toEqual({ download: 0, copy: 1, clear: 0 });
    });

    test('Discard calls clear, and nothing else', () => {
        // The one that costs a recording if it is miswired.
        const calls = wire();
        actionTitled('Discard recording')?.click();
        expect(calls).toEqual({ download: 0, copy: 0, clear: 1 });
    });

    test('the row text still toggles the recorder once the actions are there', () => {
        // The regression putting the actions in the switch's own row caused,
        // and the reason the row carries an explicit `for`.
        //
        // A label with no `for` takes its control from the FIRST labelable
        // descendant. The action buttons sit before the checkbox, so the
        // implicit control silently became the Download button and the row's
        // own text stopped switching recording on. Measured before the fix:
        // the text toggled the switch with no recorder attached and stopped
        // the moment the buttons appeared — no error, nothing to see.
        wire();
        const box = document.getElementById('vtt-debug-toggle') as HTMLInputElement;
        const text = box.closest('label')!.querySelector('.vtt-privacy-text') as HTMLElement;
        const before = box.checked;

        text.click();

        expect(box.checked).toBe(!before);
    });

    test('clicking in the action cluster does not toggle the recorder', () => {
        // THE hazard of putting the actions in the switch's own row: that row
        // is a <label> for the checkbox, so a click anywhere inside it
        // activates the control. Un-guarded, a click that lands on the gap
        // between two icons — or on the session count — switches recording off
        // while the user is reaching for a button.
        //
        // The buttons themselves are safe without any help: a <button> is
        // interactive content and a label does not activate through one. The
        // padding around them is not, which is why the guard sits on the
        // container and this test clicks the container and the count.
        wire();
        const box = document.getElementById('vtt-debug-toggle') as HTMLInputElement;
        const before = box.checked;

        (document.getElementById('vtt-trace-rows') as HTMLElement).click();
        expect(box.checked).toBe(before);

        status()?.click();
        expect(box.checked).toBe(before);
    });

    test('the session count is shown in the cluster', () => {
        // The only signal that says the recorder is capturing rather than
        // merely switched on.
        wire();
        expect(status()?.textContent).toBe('3');
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

        actionTitled('Download trace')?.click();

        expect(calls.download).toBe(0);
        // And it says so. Without this the click is indistinguishable from a
        // dead button — the status is the only thing that answers.
        expect(status()?.textContent).toBe('none');
    });
});

// Word-save diagnostics (specs/save-diagnostics): the same rows also carry the
// save log. HDrezka has no subtitle recorder, so its video count is always 0 —
// a readout of videos alone would say "nothing recorded" over a log of saves,
// and the Download row would refuse to hand it over.
describe('word saves count as a recording', () => {
    const app = (sessions: number, saves: number, calls = { download: 0 }): AppInterface => ({
        ...baseApp,
        traceActions: () => ({
            sessions: () => sessions,
            saves: () => saves,
            download: () => { calls.download++; },
            copy: () => Promise.resolve(true),
            clear: () => Promise.resolve(),
        }),
    });

    test('saves alone (HDrezka): the readout shows them', () => {
        build(app(0, 4)).openSettings();
        expect(status()?.textContent).toBe('♥4');
        expect(status()?.title).toBe('4 word saves recorded');
    });

    test('videos and saves (YouTube): both are shown', () => {
        build(app(2, 1)).openSettings();
        expect(status()?.textContent).toBe('2 ♥1');
        expect(status()?.title).toBe('2 videos, 1 word save recorded');
    });

    test('Download goes ahead with saves and no videos', () => {
        const calls = { download: 0 };
        build(app(0, 3, calls)).openSettings();
        actionTitled('Download trace')?.click();
        expect(calls.download).toBe(1);
    });

    test('Download still refuses when there is neither', () => {
        const calls = { download: 0 };
        build(app(0, 0, calls)).openSettings();
        actionTitled('Download trace')?.click();
        expect(calls.download).toBe(0);
        expect(status()?.textContent).toBe('none');
    });
});
