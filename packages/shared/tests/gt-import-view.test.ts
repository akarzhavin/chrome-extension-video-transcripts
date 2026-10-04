/**
 * @jest-environment jsdom
 *
 * The popup's import block: it paints the worker's state and sends the three
 * messages. Texts are the English fallbacks (getMessage returns '').
 */

const session: Record<string, unknown> = {};
const sent: unknown[] = [];
let onChanged: ((c: Record<string, { newValue?: unknown }>, area: string) => void) | null = null;
(global as any).chrome = {
    storage: {
        session: { get: jest.fn(async (k: string) => (k in session ? { [k]: session[k] } : {})) },
        onChanged: { addListener: jest.fn((l: any) => (onChanged = l)), removeListener: jest.fn() },
    },
    runtime: { sendMessage: jest.fn((m: unknown, cb?: () => void) => { sent.push(m); cb?.(); }), lastError: undefined },
    i18n: { getMessage: () => '' },
};

import { paintImport, renderGtImport } from '../src/popup/gt-import-view';
import type { ImportState } from '../src/gt-import/runner';

const base = { toAdd: [], already: 0, removed: 0, skipped: 0, total: 0, done: 0, added: 0, existed: 0, refused: 0 };
const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount(): Promise<HTMLElement> {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    renderGtImport(root);
    await flush();
    return root;
}

beforeEach(() => {
    for (const k of Object.keys(session)) delete session[k];
    sent.length = 0;
});

test('idle: one button that starts the read', async () => {
    const root = await mount();
    const b = root.querySelector('button')!;
    expect(b.textContent).toBe('Import from Google Translate');
    b.click();
    expect(sent).toEqual([{ action: 'GT_IMPORT_START' }]);
});

test('preview: the counts, then Add / Cancel', async () => {
    session['gtImport.v1'] = { ...base, phase: 'preview', toAdd: ['a', 'b'], total: 2, already: 90, removed: 3, skipped: 32 };
    const root = await mount();
    expect(root.textContent).toContain('New words to add: 2');
    expect(root.textContent).toContain('Already in your list: 90');
    expect(root.textContent).toContain('Removed earlier, not brought back: 3');
    expect(root.textContent).toContain('Skipped (other languages or too long): 32');
    const [add, cancel] = Array.from(root.querySelectorAll('button'));
    expect(add.textContent).toBe('Add words: 2');
    add.click();
    cancel.click();
    expect(sent).toEqual([{ action: 'GT_IMPORT_CONFIRM' }, { action: 'GT_IMPORT_RESET' }]);
});

test('writing: follows the worker live, and a reopened popup asks it to resume', async () => {
    session['gtImport.v1'] = { ...base, phase: 'writing', total: 300, done: 136 };
    const root = await mount();
    expect(sent).toEqual([{ action: 'GT_IMPORT_CONFIRM' }]);
    expect((root.querySelector('progress') as HTMLProgressElement).value).toBe(136);
    onChanged!({ 'gtImport.v1': { newValue: { ...base, phase: 'done', total: 300, done: 300, added: 300 } } }, 'session');
    expect(root.textContent).toContain('Words added: 300');
    expect(root.querySelector('progress')).toBeNull();
});

test('reading: a reopened popup asks the worker to carry on, so a stopped read does not hang there', async () => {
    session['gtImport.v1'] = { ...base, phase: 'reading' };
    const root = await mount();
    expect(root.textContent).toContain('Reading your Google Translate list…');
    expect(sent).toEqual([{ action: 'GT_IMPORT_START' }]);
});

test('preview and done: nothing is resent on open', async () => {
    session['gtImport.v1'] = { ...base, phase: 'done', total: 2, done: 2, added: 2 };
    await mount();
    expect(sent).toEqual([]);
});

test('daily limit: says how far it got', async () => {
    session['gtImport.v1'] = { ...base, phase: 'error', error: 'daily_limit', total: 300, done: 120 };
    const root = await mount();
    expect(root.querySelector('.error')!.textContent).toBe(
        'Daily limit reached. Saved 120 of 300; run the import again tomorrow for the rest.',
    );
});

/**
 * Not signed in. The card used to say "Sign in to Lingogram first." in error
 * red with an OK that only closed it: a dead end on translate.google.com, where
 * the popup's sign-in button is out of sight. It now leads with what the
 * learner came for, their phrases, and starts the sign-in itself. The card's
 * own × closes it, so there is no OK.
 */
describe('not signed in', () => {
    const signedOut = { ...base, phase: 'error', error: 'not_signed_in', found: 334 } as unknown as ImportState;
    const paint = (s: ImportState): HTMLElement => {
        const box = document.createElement('div');
        paintImport(box, s);
        return box;
    };
    const labels = (box: HTMLElement) => Array.from(box.querySelectorAll('button')).map((b) => b.textContent);

    test('leads with the number of phrases waiting, then says why to sign in', () => {
        const box = paint(signedOut);
        const lines = Array.from(box.querySelectorAll('.gt-line')).map((d) => d.textContent);
        expect(lines).toEqual(['Phrases ready to import: 334', 'Sign in to save them to your Lingogram vocabulary.']);
    });

    test('has one button, and it starts the sign-in flow', () => {
        const box = paint(signedOut);
        expect(labels(box)).toEqual(['Sign in to import']);
        box.querySelector('button')!.click();
        expect(sent).toContainEqual({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'gt_import' });
    });

    test('clears the refused import, so the next click starts a fresh one', () => {
        paint(signedOut).querySelector('button')!.click();
        expect(sent).toContainEqual({ action: 'GT_IMPORT_RESET' });
    });

    test('is not painted as an error', () => {
        expect(paint(signedOut).querySelector('.error')).toBeNull();
    });

    test('without a count it still offers the sign-in', () => {
        const box = paint({ ...signedOut, found: undefined } as unknown as ImportState);
        expect(box.textContent).toContain('Sign in to save them to your Lingogram vocabulary.');
        expect(labels(box)).toEqual(['Sign in to import']);
    });

    test('a real failure is still painted as an error, with OK only', () => {
        const box = paint({ ...signedOut, error: 'write_failed' } as unknown as ImportState);
        expect(box.querySelector('.error')).not.toBeNull();
        expect(labels(box)).toEqual(['OK']);
    });
});
