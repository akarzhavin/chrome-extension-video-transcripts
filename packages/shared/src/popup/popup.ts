import { msg as i18nMsg } from '../i18n';
import {
    SUPPORTED_LANGUAGES,
    SupportedLanguage,
    loadLanguagePrefs,
    saveLanguagePrefs,
} from '../languages';

// Optional allow-list of language codes for the pickers. Set by initPopup; null
// means "all supported languages". Used so apps whose source only ships a few
// subtitle languages (e.g. Rezka) don't offer ones no title carries.
let allowedLanguageCodes: string[] | null = null;

function pickerLanguages(): SupportedLanguage[] {
    if (!allowedLanguageCodes) return SUPPORTED_LANGUAGES;
    const byCode = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));
    return allowedLanguageCodes
        .map((c) => byCode.get(c))
        .filter((l): l is SupportedLanguage => !!l);
}

interface AuthStatus {
    signedIn: boolean;
    email?: string;
    uid?: string;
    inboxCount?: number;
}

function send<T = unknown>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (res) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(res as T);
        });
    });
}

interface ViewState {
    status?: AuthStatus;
    loading?: boolean;
    error?: string;
}

function render(root: HTMLElement, state: ViewState): void {
    root.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = 'Lingogram';
    root.appendChild(title);

    if (state.loading) {
        const p = document.createElement('div');
        p.textContent = i18nMsg('ytPopupLoading', 'Loading…');
        root.appendChild(p);
        return;
    }

    if (state.status?.signedIn) {
        renderSignedIn(root, state.status);
    } else {
        renderSignedOut(root);
    }

    renderLanguageSettings(root);

    if (state.error) {
        const e = document.createElement('div');
        e.className = 'error';
        e.textContent = state.error;
        root.appendChild(e);
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

function renderSignedIn(root: HTMLElement, status: AuthStatus): void {
    const email = document.createElement('div');
    email.className = 'email';
    email.textContent = status.email ?? i18nMsg('ytPopupUnknownEmail', '(unknown email)');
    root.appendChild(email);

    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = i18nMsg('ytWordsSaved', '{count} words saved').replace('{count}', String(status.inboxCount ?? 0));
    root.appendChild(count);

    const out = document.createElement('button');
    out.className = 'secondary';
    out.textContent = i18nMsg('ytAuthSignOut', 'Sign out');
    out.addEventListener('click', async () => {
        out.disabled = true;
        try {
            await send({ action: 'AUTH_SIGN_OUT' });
        } catch (err) {
            render(root, { status, error: String(err) });
            return;
        }
        await refresh(root);
    });
    root.appendChild(out);
}

function renderSignedOut(root: HTMLElement): void {
    const primary = document.createElement('button');
    primary.className = 'primary';
    primary.textContent = i18nMsg('ytAuthSignInAction', 'Sign in on lingogram');
    primary.addEventListener('click', async () => {
        primary.disabled = true;
        try {
            const res = await send<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM' });
            if (!res.ok) throw new Error(res.error ?? i18nMsg('ytAuthOpenFailed', "Couldn't open the sign-in page. Try again."));
            window.close();
        } catch (err) {
            render(root, { error: String(err) });
            return;
        }
    });
    root.appendChild(primary);
}

function makeLangRow(labelText: string): { row: HTMLElement; select: HTMLSelectElement } {
    const row = document.createElement('label');
    row.className = 'lang-row';

    const span = document.createElement('span');
    span.textContent = labelText;
    row.appendChild(span);

    const select = document.createElement('select');
    select.className = 'lang-select';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = i18nMsg('ytPopupSelect', 'Select…');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    for (const lang of pickerLanguages()) {
        const opt = document.createElement('option');
        opt.value = lang.code;
        opt.textContent = lang.native === lang.label ? lang.label : `${lang.label} — ${lang.native}`;
        select.appendChild(opt);
    }

    row.appendChild(select);
    return { row, select };
}

function renderLanguageSettings(root: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'lang-settings';

    const heading = document.createElement('div');
    heading.className = 'lang-settings-title';
    heading.textContent = i18nMsg('ytGroupLanguages', 'Languages');
    section.appendChild(heading);

    const learning = makeLangRow(i18nMsg('ytPopupLearning', "I'm learning"));
    const native = makeLangRow(i18nMsg('ytPopupNative', 'My native language'));
    section.appendChild(learning.row);
    section.appendChild(native.row);
    root.appendChild(section);

    // Prefill from storage (async — selects render immediately, fill on resolve).
    void loadLanguagePrefs().then((prefs) => {
        if (!prefs) return;
        learning.select.value = prefs.learning;
        native.select.value = prefs.native;
    });

    const persist = () => {
        const l = learning.select.value;
        const n = native.select.value;
        if (!l || !n) return; // both required before we store anything
        void saveLanguagePrefs({ learning: l, native: n });
    };
    learning.select.addEventListener('change', persist);
    native.select.addEventListener('change', persist);
}

export function initPopup(opts?: { languages?: string[] }): void {
    allowedLanguageCodes = opts?.languages ?? null;
    const root = document.getElementById('root');
    if (!root) {
        console.error('[Lingogram] popup: #root not found');
        return;
    }
    refresh(root);
}
