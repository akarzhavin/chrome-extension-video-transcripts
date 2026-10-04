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

import { renderGtImport } from '../src/popup/gt-import-view';

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
