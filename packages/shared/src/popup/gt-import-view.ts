// The popup's Google Translate import block. Renders the worker's import state
// (chrome.storage.session, see gt-import/runner.ts) and follows it live, so the
// popup can be closed mid-import and reopened on the same progress.

import { msg as i18nMsg } from '../i18n';
import { GT_IMPORT_KEYS } from '../auth/storage';
import type { ImportState } from '../gt-import/runner';

const KEY = GT_IMPORT_KEYS.state;

function t(key: string, fallback: string, vars: Record<string, number> = {}): string {
    let s = i18nMsg(key, fallback);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}

function send(action: string): Promise<unknown> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action }, (res) => {
            void chrome.runtime.lastError;
            resolve(res);
        });
    });
}

function button(text: string, cls: 'primary' | 'secondary', onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', () => {
        b.disabled = true;
        onClick();
    });
    return b;
}

function line(text: string, cls = 'gt-line'): HTMLElement {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
}

function errorText(s: ImportState): string {
    switch (s.error) {
        case 'no_list':
            return t(
                'gtImportErrNoList',
                'No saved phrases found. Open translate.google.com, sign in to Google and check the Saved list.',
            );
        case 'daily_limit':
            return t('gtImportErrDaily', 'Daily limit reached. Saved {done} of {total}; run the import again tomorrow for the rest.', {
                done: s.done,
                total: s.total,
            });
        default:
            return t('gtImportErrGeneric', "Something went wrong. Saved {done} of {total}. Try again.", {
                done: s.done,
                total: s.total,
            });
    }
}

/** Counts shared by the preview and the summary: what will not be written. */
function notWritten(s: ImportState): string[] {
    const out: string[] = [];
    if (s.already) out.push(t('gtImportAlready', 'Already in your list: {n}', { n: s.already }));
    if (s.removed) out.push(t('gtImportRemoved', 'Removed earlier, not brought back: {n}', { n: s.removed }));
    if (s.skipped) out.push(t('gtImportSkipped', 'Skipped (other languages or too long): {n}', { n: s.skipped }));
    return out;
}

/** Paints one import state into `box`; shared by the popup and the button on Google Translate. */
export function paintImport(box: HTMLElement, s: ImportState | null): void {
    box.replaceChildren();
    const title = document.createElement('div');
    title.className = 'lang-settings-title';
    title.textContent = t('gtImportTitle', 'Google Translate');
    box.appendChild(title);

    if (!s) {
        box.appendChild(line(t('gtImportHint', 'Bring the phrases you saved in Google Translate into Lingogram.'), 'toggle-hint'));
        box.appendChild(button(t('gtImportStart', 'Import from Google Translate'), 'secondary', () => void send('GT_IMPORT_START')));
        return;
    }

    switch (s.phase) {
        case 'reading':
            box.appendChild(line(t('gtImportReading', 'Reading your Google Translate list…')));
            return;
        case 'preview': {
            box.appendChild(line(t('gtImportToAdd', 'New words to add: {n}', { n: s.total }), 'gt-line gt-strong'));
            for (const l of notWritten(s)) box.appendChild(line(l));
            const row = document.createElement('div');
            row.className = 'gt-actions';
            if (s.total > 0) {
                row.appendChild(button(t('gtImportConfirm', 'Add words: {n}', { n: s.total }), 'primary', () => void send('GT_IMPORT_CONFIRM')));
            }
            row.appendChild(button(t('gtImportCancel', 'Cancel'), 'secondary', () => void send('GT_IMPORT_RESET')));
            box.appendChild(row);
            return;
        }
        case 'writing': {
            const bar = document.createElement('progress');
            bar.className = 'gt-progress';
            bar.max = Math.max(1, s.total);
            bar.value = s.done;
            box.appendChild(bar);
            box.appendChild(line(t('gtImportProgress', 'Saving {done} of {total}. You can close this window.', { done: s.done, total: s.total })));
            return;
        }
        case 'done': {
            box.appendChild(line(t('gtImportDone', 'Words added: {n}', { n: s.added }), 'gt-line gt-strong'));
            if (s.existed) box.appendChild(line(t('gtImportExisted', 'Already saved meanwhile: {n}', { n: s.existed })));
            if (s.refused) box.appendChild(line(t('gtImportRefused', "Couldn't save: {n}", { n: s.refused })));
            for (const l of notWritten(s)) box.appendChild(line(l));
            box.appendChild(button(t('gtImportClose', 'OK'), 'secondary', () => void send('GT_IMPORT_RESET')));
            return;
        }
        case 'error':
            if (s.error === 'not_signed_in') {
                // Not a failure: the learner has not signed in yet. The card
                // leads with their phrases and starts the sign-in itself (on
                // Google Translate the popup's button is out of sight). The
                // refused import is cleared, so the next click on the icon
                // starts a fresh one. No OK: the card's own × closes it.
                if (s.found) {
                    box.appendChild(line(t('gtImportFound', 'Phrases ready to import: {n}', { n: s.found }), 'gt-line gt-strong gt-big'));
                }
                box.appendChild(line(t('gtImportSignInWhy', 'Sign in to save them to your Lingogram vocabulary.')));
                box.appendChild(
                    button(t('gtImportSignIn', 'Sign in to import'), 'primary', () => {
                        void send('GT_IMPORT_RESET');
                        chrome.runtime.sendMessage({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'gt_import' }, () => {
                            void chrome.runtime.lastError;
                        });
                    }),
                );
                return;
            }
            box.appendChild(line(errorText(s), 'error'));
            box.appendChild(button(t('gtImportClose', 'OK'), 'secondary', () => void send('GT_IMPORT_RESET')));
            return;
    }
}

export function renderGtImport(root: HTMLElement): void {
    // The block is an extra: a storage area missing or throwing must cost this
    // block, never the account view rendered just above it.
    try {
        mount(root);
    } catch (err) {
        console.warn('[Lingogram] popup: import block unavailable', err);
    }
}

function mount(root: HTMLElement): void {
    const box = document.createElement('div');
    box.className = 'lang-settings gt-import';
    root.appendChild(box);

    const load = () =>
        chrome.storage.session.get(KEY).then((v) => (v as Record<string, ImportState | undefined>)[KEY] ?? null);

    load().then(
        (s) => {
            paintImport(box, s);
            // A 'writing' or 'reading' state left by a worker that was stopped
            // mid-step resumes here: the write from `done`, the read from the
            // start. With the worker still at it, either call is a no-op.
            if (s?.phase === 'writing') void send('GT_IMPORT_CONFIRM');
            if (s?.phase === 'reading') void send('GT_IMPORT_START');
        },
        () => box.remove(),
    );

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'session' || !(KEY in changes)) return;
        if (!box.isConnected) {
            chrome.storage.onChanged.removeListener(onChanged);
            return;
        }
        paintImport(box, (changes[KEY].newValue as ImportState | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
}
