/**
 * @jest-environment jsdom
 */

/**
 * The toolbar popup — §20.4, §23.3 and §1.6.
 *
 * The popup and the sidebar carry the same analytics switch, and the whole
 * point of the pair is that they are ONE preference: a user who opts out in
 * the popup and finds the sidebar still opted in has been told their choice
 * did not take. Nothing pinned the key they share, so the two could drift apart
 * silently — each surface passing its own tests while disagreeing.
 *
 * The page is loaded from popup.html rather than hand-written, so a mount point
 * renamed there fails here rather than in the field: the popup renders into
 * #root and finds nothing to render into if that id moves.
 */

const sendMessageMock = jest.fn();

const prefsStore: Record<string, unknown> = {};
const storageLocal = {
    get: jest.fn((keys: string | string[] | null) => {
        if (keys == null) return Promise.resolve({ ...prefsStore });
        const arr = typeof keys === 'string' ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in prefsStore) out[k] = prefsStore[k];
        return Promise.resolve(out);
    }),
    set: jest.fn((items: Record<string, unknown>) => {
        Object.assign(prefsStore, items);
        return Promise.resolve();
    }),
};

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: sendMessageMock,
        lastError: undefined,
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' }, // English fallbacks
    storage: { local: storageLocal, onChanged: { addListener: jest.fn() } },
};

import { readFileSync } from 'fs';
import { join } from 'path';
import { PREFS_KEY } from '../src/prefs';
import { SUPPORTED_LANGUAGES } from '../src/languages';

/**
 * The popup's own markup. Only the body is taken: jsdom already owns the
 * document, and the <script> tag would try to fetch a build artefact.
 */
const POPUP_HTML = (() => {
    const file = readFileSync(join(__dirname, '../src/popup/popup.html'), 'utf8');
    const body = /<body>([\s\S]*?)<\/body>/.exec(file);
    if (!body) throw new Error('popup.html has no <body>');
    return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

beforeEach(() => {
    document.body.innerHTML = POPUP_HTML;
    sendMessageMock.mockReset();
    for (const k of Object.keys(prefsStore)) delete prefsStore[k];
    storageLocal.get.mockClear();
    storageLocal.set.mockClear();
    jest.resetModules();
});

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Answer AUTH_STATUS with the given status; everything else resolves empty. */
function withStatus(status: Record<string, unknown>): void {
    sendMessageMock.mockImplementation((msg: any, cb: any) => {
        if (typeof cb !== 'function') return;
        cb(msg?.action === 'AUTH_STATUS' ? status : {});
    });
}

/** Mount the popup and let its async prefills settle. */
async function mount(): Promise<void> {
    const { initPopup } = await import('../src/popup/popup');
    initPopup();
    await nextTick();
}

// The mount point is the contract between the html and the module. Asserted
// once, up front, so every check below is known to be running against the real
// page rather than an empty body that quietly renders nothing.
test('the popup page carries the mount point the module renders into', () => {
    expect(document.getElementById('root')).not.toBeNull();
});

describe("the popup's switch writes the same preference", () => {
    // §20.4, T5.8. Both surfaces write analyticsEnabled under prefs.v1. A
    // divergence here is invisible to the user until they check the other
    // surface and find their opt-out did not take.
    const checkbox = (): HTMLInputElement =>
        document.querySelector('.toggle-row input[type="checkbox"]') as HTMLInputElement;

    beforeEach(() => withStatus({ signedIn: false, inboxCount: 0 }));

    test('the key it writes under is prefs.v1', async () => {
        await mount();
        storageLocal.set.mockClear();

        const box = checkbox();
        box.checked = false;
        box.dispatchEvent(new Event('change'));
        await nextTick();

        const keys = storageLocal.set.mock.calls.flatMap((c) => Object.keys(c[0]));
        expect(keys).toContain(PREFS_KEY);
        expect(PREFS_KEY).toBe('prefs.v1');
    });

    test('the field it writes is analyticsEnabled', async () => {
        await mount();
        const box = checkbox();
        box.checked = false;
        box.dispatchEvent(new Event('change'));
        await nextTick();

        expect((prefsStore[PREFS_KEY] as any).analyticsEnabled).toBe(false);
    });

    // The read side of the same key: a value the sidebar wrote has to come back
    // here. Writing one key and reading another would pass the two checks above
    // and still leave the two surfaces disagreeing.
    test('it reads back what the other surface stored', async () => {
        prefsStore[PREFS_KEY] = { analyticsEnabled: false };
        await mount();
        expect(checkbox().checked).toBe(false);
    });

    test('and the other way round', async () => {
        prefsStore[PREFS_KEY] = { analyticsEnabled: true };
        await mount();
        expect(checkbox().checked).toBe(true);
    });
});

describe("the popup's loading and signed-in text", () => {
    // §23.3, T5.9. The status answer comes from the worker, which may be asleep
    // — so there is a real moment with no answer yet. Skipping the loading
    // state renders the signed-OUT view in that gap, which tells a signed-in
    // user they are signed out and offers them a sign-in button.
    test('it says it is loading before the status answers', async () => {
        // Deliberately never calls back: this is the state between opening the
        // popup and the worker replying.
        sendMessageMock.mockImplementation(() => {});
        const { initPopup } = await import('../src/popup/popup');
        initPopup();

        expect(document.getElementById('root')!.textContent).toContain('Loading…');
    });

    // What must NOT be on screen in that gap — the half that catches rendering
    // the signed-out view underneath the loading line.
    test('it offers no sign-in button while still loading', async () => {
        sendMessageMock.mockImplementation(() => {});
        const { initPopup } = await import('../src/popup/popup');
        initPopup();

        expect(document.querySelector('button.primary')).toBeNull();
    });

    test('once the answer arrives it shows the email and the count', async () => {
        withStatus({ signedIn: true, email: 'reader@example.com', inboxCount: 7 });
        await mount();

        const root = document.getElementById('root')!;
        expect(root.querySelector('.email')!.textContent).toBe('reader@example.com');
        expect(root.querySelector('.count')!.textContent).toBe('7 words saved');
        expect(root.textContent).not.toContain('Loading…');
    });

    // A signed-in account with nothing saved yet still gets a count, not a
    // blank: zero is a number the user can read.
    test('an empty inbox reads as zero words saved', async () => {
        withStatus({ signedIn: true, email: 'reader@example.com' });
        await mount();
        expect(document.querySelector('.count')!.textContent).toBe('0 words saved');
    });
});

describe('the language pickers offer every supported language', () => {
    // §1.6, T5.11. The count is the claim: 42, not "some". The map said 41,
    // which is how a check written from the map would have pinned the wrong
    // number (Article D).
    beforeEach(() => withStatus({ signedIn: false, inboxCount: 0 }));

    const options = (row = 0): HTMLOptionElement[] => {
        const selects = document.querySelectorAll('.lang-select');
        return [...(selects[row] as HTMLSelectElement).options];
    };

    test('there are forty-two of them', () => {
        expect(SUPPORTED_LANGUAGES).toHaveLength(42);
    });

    test('both pickers list all of them, after the placeholder', async () => {
        await mount();
        // Two rows: learning and native.
        expect(document.querySelectorAll('.lang-select')).toHaveLength(2);
        for (const row of [0, 1]) {
            expect(options(row)).toHaveLength(SUPPORTED_LANGUAGES.length + 1);
            expect(options(row)[0].value).toBe(''); // the "Select…" placeholder
        }
    });

    // Article D: the map says the options carry the language's own name alone.
    // They carry "English name — native name" whenever the two differ, and the
    // name alone when they are the same. Pinned as the code has it: what the
    // claim is really about is that a reader can find their language under the
    // name they call it.
    test("each option carries the language's own name", async () => {
        await mount();
        const byValue = new Map(options().map((o) => [o.value, o.textContent]));

        for (const lang of SUPPORTED_LANGUAGES) {
            expect(byValue.get(lang.code)).toContain(lang.native);
        }
    });

    test('a language whose two names differ shows both', async () => {
        await mount();
        const byValue = new Map(options().map((o) => [o.value, o.textContent]));
        const differing = SUPPORTED_LANGUAGES.find((l) => l.native !== l.label)!;

        expect(byValue.get(differing.code)).toBe(`${differing.label} — ${differing.native}`);
    });

    test('a language whose names match is not repeated', async () => {
        await mount();
        const byValue = new Map(options().map((o) => [o.value, o.textContent]));
        const same = SUPPORTED_LANGUAGES.find((l) => l.native === l.label)!;

        expect(byValue.get(same.code)).toBe(same.label);
    });
});
