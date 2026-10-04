/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://translate.google.com/"}
 *
 * The import on translate.google.com: an icon in the Saved panel's toolbar,
 * next to Google's "Export to Google Sheets" (jsname mAozAc), and a card that
 * follows the worker's state by asking for it (content scripts cannot read
 * session storage). A floating button stands in only when the Saved panel is
 * open and its toolbar is not the one we know. Texts are the English fallbacks.
 */

let state: unknown = null;
const sent: string[] = [];
let startReply: unknown = null;
(global as any).chrome = {
    runtime: {
        lastError: undefined,
        sendMessage: jest.fn((m: { action: string }, cb: (r: unknown) => void) => {
            sent.push(m.action);
            if (m.action === 'GT_IMPORT_STATE') cb({ ok: true, state });
            else if (m.action === 'GT_IMPORT_START') cb({ ok: true, state: startReply });
            else cb({ ok: true, state: null });
        }),
    },
    i18n: { getMessage: () => '' },
};

import { mountGtButton, type MountedButton } from '../src/gt-import/page-button';

const base = { toAdd: [], already: 0, removed: 0, skipped: 0, total: 0, done: 0, added: 0, existed: 0, refused: 0 };
const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
// The Saved toolbar as Google serves it (taken from the live page): each item
// is wrapped, and the Sheets button sits inside the owner of its tooltip. The
// tooltip's own box stays in that owner until first shown, then moves to body.
const toolbar = (tooltipBox: boolean) =>
    '<div class="toolbar">' +
    '<div><span><button aria-label="Search saved translations"></button></span></div>' +
    '<div id="ow8" jsaction="mouseover:kptBG(Fs81Kd); mouseout:o9UdU(Fs81Kd)" data-show-delay-ms="250">' +
    '<div jsname="Fs81Kd"><span jsslot=""><button jsname="mAozAc" aria-label="Export to Google Sheets (new tab)"></button></span></div>' +
    (tooltipBox ? '<div jsname="V6DMGe"><div>Export to Google Sheets (new tab)</div></div>' : '') +
    '</div>' +
    '<form style="display:none"></form>' +
    '<div><span><button aria-label="More options"></button></span></div></div>';
const TOOLBAR = toolbar(true);

let m: MountedButton | undefined;
const iconBtn = () => m!.icon()!.querySelector('button') as HTMLButtonElement;

function mount(html: string, path = '/') {
    m?.destroy(); // one button per page, as on the real one
    history.replaceState(null, '', path);
    document.body.innerHTML = html;
    state = null;
    startReply = null;
    sent.length = 0;
    m = mountGtButton(document)!;
}

afterEach(() => {
    m?.destroy();
    m = undefined;
});

describe('where it shows', () => {
    test('in the Saved toolbar, right after Google\'s Sheets button, in its colour', () => {
        mount(TOOLBAR, '/saved');
        const host = document.getElementById('lingogram-gt-import-icon')!;
        expect(host.previousElementSibling!.id).toBe('ow8');
        expect(host.parentElement!.className).toBe('toolbar');
        expect(iconBtn().getAttribute('aria-label')).toBe('Import to Lingogram');
        expect(iconBtn().title).toBe('Import to Lingogram');
        expect(m!.overlay.querySelector('.pill')).toBeNull();
    });

    test('a page that rebuilt its body gets the overlay back', () => {
        mount(TOOLBAR, '/saved');
        document.body.innerHTML = TOOLBAR;
        m!.check();
        expect(document.querySelectorAll('#lingogram-gt-import')).toHaveLength(1);
    });

    test('sits level with the Sheets button, nudged by the measured difference', () => {
        mount(TOOLBAR, '/saved');
        const sheets = document.querySelector('button[jsname="mAozAc"]')!;
        const icon = document.getElementById('lingogram-gt-import-icon')!;
        const rect = (top: number) => ({ top, height: 48, bottom: top + 48, left: 0, right: 48, width: 48, x: 0, y: top, toJSON() {} }) as DOMRect;
        sheets.getBoundingClientRect = () => rect(104);
        icon.getBoundingClientRect = () => rect(112 + (parseFloat(icon.style.top) || 0));
        m!.check();
        expect(icon.style.top).toBe('-8px');
        m!.check(); // level now: no further nudge
        expect(icon.style.top).toBe('-8px');
        // Google's row shifts by 6 px: the nudge follows from where it is.
        sheets.getBoundingClientRect = () => rect(110);
        m!.check();
        expect(icon.style.top).toBe('-2px');
    });

    test.each([
        ['before the tooltip was first shown', true],
        ['after it moved to body', false],
    ])('outside the Sheets tooltip\'s owner (%s): hovering ours does not show "Export to Google Sheets"', (_, box) => {
        mount(toolbar(box), '/saved');
        const icon = document.getElementById('lingogram-gt-import-icon')!;
        expect(document.getElementById('ow8')!.contains(icon)).toBe(false);
        expect(icon.closest('[jsaction*="mouseover"]')).toBeNull();
        expect(icon.previousElementSibling!.id).toBe('ow8');
    });

    test('mounted once; our roots are closed to the page', () => {
        mount(TOOLBAR, '/saved');
        expect(mountGtButton(document)).toBeNull();
        expect(document.getElementById('lingogram-gt-import')!.shadowRoot).toBeNull();
        expect(document.getElementById('lingogram-gt-import-icon')!.shadowRoot).toBeNull();
    });

    test('Saved panel closed: nothing of ours on the page, then or later', () => {
        jest.useFakeTimers();
        try {
            mount('<main></main>', '/');
            expect(m!.icon()).toBeNull();
            expect(m!.overlay.querySelector('.pill')).toBeNull();
            jest.advanceTimersByTime(5000);
            expect(m!.overlay.querySelector('.pill')).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    test('the panel reopened (Google re-renders it): the icon comes back after the new Sheets button', async () => {
        mount(TOOLBAR, '/saved');
        document.body.innerHTML = '<main></main>';
        m!.check();
        expect(m!.icon()).toBeNull();
        document.body.innerHTML = TOOLBAR;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await flush();
        expect(m!.icon()).not.toBeNull();
        expect(document.querySelectorAll('#lingogram-gt-import-icon')).toHaveLength(1);
    });

    test('Saved panel open but its toolbar changed: a floating button stands in after a moment', () => {
        jest.useFakeTimers();
        try {
            mount('<aside>Saved</aside>', '/saved');
            expect(m!.overlay.querySelector('.pill')).toBeNull();
            jest.advanceTimersByTime(3500);
            expect(m!.overlay.querySelector('.pill')!.textContent).toBe('Import to Lingogram');
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('what it does', () => {
    test('nothing under way: the click starts the import and shows its preview under the icon', async () => {
        mount(TOOLBAR, '/saved');
        startReply = { ...base, phase: 'preview', toAdd: ['a', 'b'], total: 2, already: 5 };
        iconBtn().click();
        await flush();
        expect(sent.slice(0, 2)).toEqual(['GT_IMPORT_STATE', 'GT_IMPORT_START']);
        expect(m!.overlay.textContent).toContain('New words to add: 2');
        expect(m!.overlay.textContent).toContain('Already in your list: 5');
        expect(m!.overlay.querySelector('.panel')!.classList.contains('anchored')).toBe(true);
        expect(iconBtn().getAttribute('aria-expanded')).toBe('true');
    });

    test('an import already under way is shown, not started again', async () => {
        mount(TOOLBAR, '/saved');
        state = { ...base, phase: 'writing', total: 300, done: 40 };
        iconBtn().click();
        await flush();
        expect(sent).not.toContain('GT_IMPORT_START');
        expect((m!.overlay.querySelector('progress') as HTMLProgressElement).value).toBe(40);
    });

    test('the card follows the worker while open, and folds when the import is dismissed', async () => {
        jest.useFakeTimers();
        try {
            mount(TOOLBAR, '/saved');
            state = { ...base, phase: 'writing', total: 3, done: 1 };
            iconBtn().click();
            await jest.advanceTimersByTimeAsync(10);
            state = { ...base, phase: 'done', total: 3, done: 3, added: 3 };
            await jest.advanceTimersByTimeAsync(800);
            expect(m!.overlay.textContent).toContain('Added 3 words.');
            state = null; // OK pressed, in the popup or here
            await jest.advanceTimersByTimeAsync(800);
            expect(m!.overlay.querySelector('.panel')).toBeNull();
            expect(iconBtn().getAttribute('aria-expanded')).toBe('false');
        } finally {
            jest.useRealTimers();
        }
    });

    test('the icon again, or the ×, folds the card and stops asking', async () => {
        jest.useFakeTimers();
        try {
            mount(TOOLBAR, '/saved');
            state = { ...base, phase: 'writing', total: 3, done: 1 };
            iconBtn().click();
            await jest.advanceTimersByTimeAsync(10);
            iconBtn().click();
            expect(m!.overlay.querySelector('.panel')).toBeNull();
            const asked = sent.length;
            await jest.advanceTimersByTimeAsync(3000);
            expect(sent.filter((a) => a !== 'GT_IMPORT_STATE').length).toBe(sent.slice(0, asked).filter((a) => a !== 'GT_IMPORT_STATE').length);
            expect(sent.length).toBe(asked);
            iconBtn().click();
            await jest.advanceTimersByTimeAsync(10);
            (m!.overlay.querySelector('.x') as HTMLButtonElement).click();
            expect(m!.overlay.querySelector('.panel')).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    test('closing Google\'s Saved panel folds the card; the import goes on in the worker', async () => {
        mount(TOOLBAR, '/saved');
        state = { ...base, phase: 'writing', total: 3, done: 1 };
        iconBtn().click();
        await flush();
        history.replaceState(null, '', '/');
        document.body.innerHTML = '<main></main>';
        m!.check();
        expect(m!.overlay.querySelector('.panel')).toBeNull();
        expect(sent).not.toContain('GT_IMPORT_RESET');
    });
});
