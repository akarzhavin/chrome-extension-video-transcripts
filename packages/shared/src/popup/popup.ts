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
import { accent, menuRow } from './menu';
import { renderSiteSwitch } from './site-switch';

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
    root.className = 'menu';

    const title = el('h1', 'mhd');
    title.append(iconImage(18), document.createTextNode('Lingogram'));
    root.appendChild(title);

    if (state.loading) {
        root.appendChild(el('div', 'mload dim', i18nMsg('ytPopupLoading', 'Loading…')));
        return;
    }

    renderState(root, state.status);
    renderSetupLink(root);

    // The highlight row, for the site of this tab. Out of the layout until the
    // tab and the prefs have answered, and for good where there is no such row.
    const highlight = el('div', 'highlight');
    highlight.hidden = true;
    root.appendChild(highlight);
    void renderSiteSwitch(highlight);

    root.appendChild(el('div', 'msep'));
    root.appendChild(settingsRow(state.status));

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
    const wordsPage = () => openAndClose(chrome.runtime.getURL(WORDS_PAGE));
    switch (stateOf(status)) {
        case 'account':
            root.appendChild(
                menuRow({
                    icon: 'book',
                    label: i18nMsg('popupMenuVocabulary', 'My vocabulary'),
                    value: String(status?.inboxCount ?? 0),
                    chevron: true,
                    onClick: () => openAndClose(vocabUrl()),
                }),
            );
            return;
        case 'device': {
            root.appendChild(
                menuRow({
                    icon: 'book',
                    label: i18nMsg('settingsMyWords', 'My words'),
                    value: String(status?.inboxCount ?? 0),
                    chevron: true,
                    onClick: wordsPage,
                }),
            );
            const row = menuRow({
                icon: 'user',
                label: [
                    accent(i18nMsg('popupSignInLead', 'Sign in')),
                    document.createTextNode(` ${i18nMsg('popupSignInTail', 'to keep them on every device.')}`),
                ],
                onClick: () => void signIn(root, row, status),
            });
            root.appendChild(row);
            return;
        }
        case 'reauth': {
            const notice = el(
                'div',
                'mnote',
                i18nMsg('popupSignedOutNotice', 'You were signed out. New words are kept on this device until you sign in again.'),
            );
            root.appendChild(notice);
            const row = menuRow({
                icon: 'user',
                label: i18nMsg('accountSignInAgain', 'Sign in again'),
                accent: true,
                onClick: () => void signIn(root, row, status),
            });
            root.appendChild(row);
            if ((status?.localCount ?? 0) > 0) {
                root.appendChild(
                    menuRow({
                        icon: 'book',
                        label: i18nMsg('popupMenuWaiting', 'Words waiting on this device'),
                        value: String(status?.localCount ?? 0),
                        chevron: true,
                        onClick: wordsPage,
                    }),
                );
            }
            return;
        }
        case 'empty': {
            const intro = el('div', 'mintro');
            intro.appendChild(el('b', undefined, i18nMsg('popupEmptyTitle', 'Save words as you watch')));
            intro.appendChild(
                el(
                    'span',
                    undefined,
                    i18nMsg('popupEmptyText', 'Click a word in the subtitles, then Save. It is kept here, in this browser.'),
                ),
            );
            root.appendChild(intro);
            const row = menuRow({
                icon: 'user',
                label: i18nMsg('accountSignInOnLingogram', 'Sign in on Lingogram'),
                accent: true,
                onClick: () => void signIn(root, row, status),
            });
            root.appendChild(row);
            return;
        }
    }
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
function settingsRow(status?: AuthStatus): HTMLElement {
    return menuRow({
        icon: 'sliders',
        label: i18nMsg('popupSettingsLink', 'Settings'),
        onClick: () => {
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
        },
    });
}

// "Finish setup" while the welcome page has not been finished — the way back to
// a skipped sign-in. Added only once storage answers, and the slot stays out of
// the layout until then.
function renderSetupLink(root: HTMLElement): void {
    if (!edition) return;
    const slot = el('div', 'setup');
    slot.hidden = true;
    root.appendChild(slot);
    void loadWelcomeState().then((w) => {
        if (w.finished) return;
        slot.appendChild(
            menuRow({
                icon: 'flag',
                label: i18nMsg('popupFinishSetup', 'Finish setup'),
                onClick: () => {
                    void chrome.tabs.create({ url: welcomeUrl(edition ?? '', chrome.runtime.id) });
                    window.close();
                },
            }),
        );
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
