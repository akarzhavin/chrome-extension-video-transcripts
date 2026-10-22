// The one question before AI translation spends credits: asked on the first
// turn-on, from the sidebar or a player menu, until the viewer ticks "Don't
// ask again". Both places read and write the same choice, on this device only.

import { formatTokens, tokensLeft } from '../ai-balance/format';
import { loadBalance } from '../ai-balance/store';
import { msg } from '../i18n';

const SKIP_KEY = 'aiConfirmSkip';

/** Whether the viewer ticked "Don't ask again"; false when storage cannot be read. */
export async function confirmSkipped(): Promise<boolean> {
    try {
        return (await chrome.storage.local.get(SKIP_KEY))[SKIP_KEY] === true;
    } catch {
        return false;
    }
}

export function skipConfirm(): void {
    try {
        void chrome.storage.local.set({ [SKIP_KEY]: true }).catch(() => undefined);
    } catch {
        /* orphaned context: asked again next time */
    }
}

/** "258k credits left today"; null signed out or before the first balance. */
export async function creditsLeftText(): Promise<string | null> {
    const b = await loadBalance();
    if (!b) return null;
    return msg('ytAiConfirmLeft', '$1 credits left today', [formatTokens(tokensLeft(b.day))]);
}

/** The question's controls, built for whichever surface shows them. */
export interface ConfirmParts {
    title: HTMLElement;
    left: HTMLElement;
    dontAsk: HTMLLabelElement;
    notNow: HTMLButtonElement;
    yes: HTMLButtonElement;
}

/**
 * Builds the question's text and buttons. `done(yes)` runs once, on either
 * button; a tick of "Don't ask again" is kept only with a yes.
 */
export function buildConfirm(doc: Document, idPrefix: string, done: (yes: boolean) => void): ConfirmParts {
    const title = doc.createElement('p');
    title.id = `${idPrefix}-title`;
    title.textContent = msg('ytAiConfirmTitle', 'Translating with AI uses credits.');

    const left = doc.createElement('p');
    left.hidden = true;
    void creditsLeftText().then((text) => {
        if (!text) return;
        left.textContent = text;
        left.hidden = false;
    });

    const dontAsk = doc.createElement('label');
    const box = doc.createElement('input');
    box.type = 'checkbox';
    dontAsk.append(box, msg('ytAiConfirmDontAsk', "Don't ask again"));

    const notNow = doc.createElement('button');
    notNow.type = 'button';
    notNow.textContent = msg('ytAiConfirmNotNow', 'Not now');

    const yes = doc.createElement('button');
    yes.type = 'button';
    yes.textContent = msg('ytAiConfirmYes', 'Translate');

    let answered = false;
    const answer = (y: boolean) => {
        if (answered) return;
        answered = true;
        if (y && box.checked) skipConfirm();
        done(y);
    };
    notNow.addEventListener('click', () => answer(false));
    yes.addEventListener('click', () => answer(true));
    return { title, left, dontAsk, notNow, yes };
}
