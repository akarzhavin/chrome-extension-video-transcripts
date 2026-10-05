import { msg as i18nMsg } from '../i18n';
import type { Edition } from '../sibling';
import { loadWelcomeState, welcomeUrl } from '../welcome/welcome';
import {
    el,
    iconImage,
    openTab,
    send,
    SETTINGS_PAGE,
    siteSettingsUrl,
    startSignIn,
    vocabUrl,
    WORDS_PAGE,
    type AuthStatus,
} from './shared';
import { renderSwitches } from './switches';

// Which edition this popup belongs to; null = not told (tests, old callers),
// and the edition-specific blocks (video sites, setup) are left out.
let edition: Edition | null = null;

interface ViewState {
    status?: AuthStatus;
    loading?: boolean;
    error?: string;
}

function render(root: HTMLElement, state: ViewState): void {
    root.innerHTML = '';

    const title = el('h1', 'hd');
    title.append(iconImage(22), document.createTextNode('Lingogram'));
    root.appendChild(title);

    if (state.loading) {
        root.appendChild(el('div', 'dim', i18nMsg('ytPopupLoading', 'Loading…')));
        return;
    }

    renderState(root, state.status);
    renderSetupLink(root);

    const switches = el('div', 'switches');
    renderSwitches(switches, edition);
    root.appendChild(switches);

    root.appendChild(el('hr', 'hairline'));
    root.appendChild(settingsLink(state.status));

    if (state.error) {
        root.appendChild(el('div', 'error', state.error));
    }
}

async function refresh(root: HTMLElement): Promise<void> {
    render(root, { loading: true });
    try {
        const status = await send<AuthStatus>({ action: 'AUTH_STATUS' });
        render(root, { status });
    } catch (err) {
        render(root, { error: String(err) });
    }
}

// The four things the popup can have to say. A learner who is signed in is an
// account whatever else is stored; one who is not is either expired (the red
// "!"), or holds words in this browser, or has none yet.
type PopupState = 'account' | 'reauth' | 'device' | 'empty';

function stateOf(status?: AuthStatus): PopupState {
    if (status?.signedIn) return 'account';
    if (status?.needsReauth) return 'reauth';
    return (status?.inboxCount ?? 0) > 0 ? 'device' : 'empty';
}

function renderState(root: HTMLElement, status?: AuthStatus): void {
    switch (stateOf(status)) {
        case 'account':
            root.appendChild(
                countCard(
                    status?.inboxCount ?? 0,
                    i18nMsg('popupWordsSavedCaption', 'words saved'),
                    i18nMsg('popupOpenVocabulary', 'Open my vocabulary'),
                    'primary',
                    () => openAndClose(vocabUrl()),
                ),
            );
            return;
        case 'device':
            root.appendChild(
                countCard(
                    status?.inboxCount ?? 0,
                    i18nMsg('popupWordsOnDevice', 'words saved on this device'),
                    i18nMsg('popupOpenMyWords', 'Open my words'),
                    'primary',
                    () => openAndClose(chrome.runtime.getURL(WORDS_PAGE)),
                ),
            );
            root.appendChild(signInLine(root, status));
            return;
        case 'reauth':
            root.appendChild(reauthNotice(root, status));
            if ((status?.localCount ?? 0) > 0) {
                root.appendChild(
                    countCard(
                        status?.localCount ?? 0,
                        i18nMsg('popupWordsWaiting', 'words waiting on this device'),
                        i18nMsg('popupOpenMyWords', 'Open my words'),
                        'secondary',
                        () => openAndClose(chrome.runtime.getURL(WORDS_PAGE)),
                    ),
                );
            }
            return;
        case 'empty': {
            const card = el('div', 'hero');
            card.appendChild(el('b', 'hero-title', i18nMsg('popupEmptyTitle', 'Save words as you watch')));
            card.appendChild(
                el(
                    'div',
                    'dim sm',
                    i18nMsg('popupEmptyText', 'Click a word in the subtitles, then Save. It is kept here, in this browser.'),
                ),
            );
            root.appendChild(card);
            const link = el('button', 'link left', i18nMsg('accountSignInOnLingogram', 'Sign in on Lingogram'));
            link.addEventListener('click', () => void signIn(root, link, status));
            root.appendChild(link);
            return;
        }
    }
}

/** The big number, what it counts, and the one button that goes with it. */
function countCard(
    count: number,
    caption: string,
    buttonText: string,
    kind: 'primary' | 'secondary',
    onClick: () => void,
): HTMLElement {
    const card = el('div', 'hero');
    const figure = el('div');
    figure.append(el('div', 'big', String(count)), el('div', 'dim', caption));
    const button = el('button', `${kind} block`, buttonText);
    button.addEventListener('click', onClick);
    card.append(figure, button);
    return card;
}

/** "Sign in" + "to keep them on every device." — the upgrade, with its reason. */
function signInLine(root: HTMLElement, status: AuthStatus | undefined): HTMLElement {
    const line = el('div', 'sm');
    const link = el('button', 'link', i18nMsg('popupSignInLead', 'Sign in'));
    link.addEventListener('click', () => void signIn(root, link, status));
    line.append(link, document.createTextNode(' '), el('span', 'dim', i18nMsg('popupSignInTail', 'to keep them on every device.')));
    return line;
}

function reauthNotice(root: HTMLElement, status: AuthStatus | undefined): HTMLElement {
    const box = el('div', 'warn');
    box.appendChild(
        el(
            'div',
            undefined,
            i18nMsg('popupSignedOutNotice', 'You were signed out. New words are kept on this device until you sign in again.'),
        ),
    );
    const button = el('button', 'primary', i18nMsg('accountSignInAgain', 'Sign in again'));
    button.addEventListener('click', () => void signIn(root, button, status));
    box.appendChild(button);
    return box;
}

async function signIn(root: HTMLElement, button: HTMLButtonElement, status: AuthStatus | undefined): Promise<void> {
    button.disabled = true;
    try {
        await startSignIn('popup');
        window.close();
    } catch (err) {
        render(root, { status, error: String(err) });
    }
}

function openAndClose(url: string): void {
    void openTab(url).then(() => window.close());
}

// "Settings": the site's page for this extension when signed in, otherwise the
// extension's own. The site's page needs an account to mean anything; the
// extension's works without one.
function settingsLink(status?: AuthStatus): HTMLElement {
    const link = el('button', 'link left', i18nMsg('popupSettingsLink', 'Settings'));
    link.addEventListener('click', () => {
        void (async () => {
            if (status?.signedIn && edition) {
                await openTab(siteSettingsUrl(edition));
            } else {
                try {
                    await chrome.runtime.openOptionsPage();
                } catch {
                    await openTab(chrome.runtime.getURL(SETTINGS_PAGE));
                }
            }
            window.close();
        })();
    });
    return link;
}

// "Finish setup" while the welcome page has not been finished — the way back to
// a skipped sign-in. Added only once storage answers, and the slot stays out of
// the layout until then.
function renderSetupLink(root: HTMLElement): void {
    if (!edition) return;
    const slot = el('div');
    slot.hidden = true;
    root.appendChild(slot);
    void loadWelcomeState().then((w) => {
        if (w.finished) return;
        const b = el('button', 'setup-link', i18nMsg('popupFinishSetup', 'Finish setup'));
        b.addEventListener('click', () => {
            void chrome.tabs.create({ url: welcomeUrl(edition ?? '', chrome.runtime.id) });
            window.close();
        });
        slot.appendChild(b);
        slot.hidden = false;
    });
}

export function initPopup(opts?: { edition?: Edition }): void {
    edition = opts?.edition ?? null;
    const root = document.getElementById('root');
    if (!root) {
        console.error('[Lingogram] popup: #root not found');
        return;
    }
    refresh(root);
}
