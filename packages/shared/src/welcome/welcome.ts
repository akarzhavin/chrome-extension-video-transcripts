// The welcome page: opened once, on install, as the extension's own page
// (welcome.html, built into the popup bundle). Three steps in a left menu —
// Language, Account, Settings — and only the first is required.
//
// It is an extension page, not a page on lingogram.ai, so it writes prefs
// directly and starts sign-in exactly as the popup does. The sign-in itself
// happens on lingogram.ai/extension-auth, which signs the learner in on the
// site AND hands the extension its token: one sign-in, both places. This page
// only follows the auth state as it lands in storage.

import { trackVia } from '../analytics';
import { config } from '../auth/config';
import { msg as i18nMsg } from '../i18n';
import {
    SUPPORTED_LANGUAGES,
    loadLanguagePrefs,
    saveLanguagePrefs,
    type SupportedLanguage,
} from '../languages';
import { loadPrefs, savePrefs, sitePrefKey, type VideoSite } from '../prefs';
import { askSiblingStatus, EDITION_IDS, type Edition } from '../sibling';
import { AUTH_UID_KEY, WELCOME_KEYS } from '../auth/storage';

export interface WelcomeOptions {
    edition: Edition;
    /** Language codes the pickers offer; all supported when absent. */
    languages?: string[];
}

export type StepId = 0 | 1 | 2;

export interface WelcomeState {
    step: StepId;
    /** Left the language step once: the pair is saved. */
    languageDone: boolean;
    skippedAccount: boolean;
    /** Pressed the last button. The popup stops offering "Finish setup". */
    finished: boolean;
}

const KEY = WELCOME_KEYS.state;

export const INITIAL_STATE: WelcomeState = { step: 0, languageDone: false, skippedAccount: false, finished: false };

export async function loadWelcomeState(): Promise<WelcomeState> {
    try {
        const v = (await chrome.storage.local.get(KEY)) as Record<string, unknown>;
        const raw = v[KEY] as Partial<WelcomeState> | undefined;
        if (!raw || typeof raw !== 'object') return { ...INITIAL_STATE };
        const step = raw.step === 1 || raw.step === 2 ? raw.step : 0;
        return {
            step,
            languageDone: raw.languageDone === true,
            skippedAccount: raw.skippedAccount === true,
            finished: raw.finished === true,
        };
    } catch {
        return { ...INITIAL_STATE };
    }
}

async function saveWelcomeState(s: WelcomeState): Promise<void> {
    try {
        await chrome.storage.local.set({ [KEY]: s });
    } catch {
        // best-effort: the page still works for this visit.
    }
}

export type StepStatus = 'current' | 'done' | 'skipped' | 'optional' | 'required';

/** What the menu row of each step says. Pure, for the tests. */
export function stepStatuses(s: WelcomeState, signedIn: boolean): StepStatus[] {
    const lang: StepStatus = s.languageDone ? 'done' : 'required';
    const account: StepStatus = signedIn ? 'done' : s.skippedAccount ? 'skipped' : 'optional';
    const settings: StepStatus = s.finished ? 'done' : 'optional';
    return [lang, account, settings];
}

/** Done steps out of three, for the progress bar. */
export function doneCount(s: WelcomeState, signedIn: boolean): number {
    return stepStatuses(s, signedIn).filter((x) => x === 'done').length;
}

/** The sites this edition runs on, and the one it does not. */
export function sitesOf(edition: Edition): { own: VideoSite[]; other: VideoSite[] } {
    return edition === 'youtube'
        ? { own: ['youtube', 'netflix'], other: ['rezka'] }
        : { own: ['rezka'], other: ['youtube', 'netflix'] };
}

/** The UI language's primary subtag if the pickers offer it, else ''. */
export function guessNative(uiLanguage: string, offered: readonly string[]): string {
    const code = uiLanguage.toLowerCase().split(/[-_]/)[0];
    return offered.includes(code) ? code : '';
}

const t = i18nMsg;

const SITE_NAME: Record<VideoSite, string> = { youtube: 'YouTube', netflix: 'Netflix', rezka: 'HDrezka' };
const FINISH_URL: Record<Edition, string> = { youtube: 'https://www.youtube.com/', rezka: '' };
const STORE_URL = (e: Edition) => `https://chromewebstore.google.com/detail/${EDITION_IDS[e]}`;

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function send<T>(msg: object): Promise<T | undefined> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(msg, (res) => {
            void chrome.runtime.lastError;
            resolve(res as T | undefined);
        });
    });
}

interface View {
    opts: WelcomeOptions;
    state: WelcomeState;
    email: string | null;
    siblingInstalled: boolean;
}

export async function initWelcome(opts: WelcomeOptions): Promise<void> {
    const root = document.getElementById('welcome-root');
    if (!root) return;
    document.title = t('welcomePageTitle', 'Welcome to Lingogram');
    const view: View = {
        opts,
        state: await loadWelcomeState(),
        email: await signedInEmail(),
        siblingInstalled: (await askSiblingStatus()) !== null,
    };
    const render = () => paint(root, view, update);
    const update = async (patch: Partial<WelcomeState>) => {
        view.state = { ...view.state, ...patch };
        await saveWelcomeState(view.state);
        render();
    };
    render();
    trackVia('welcome_step', { step: 'language', action: 'shown' });

    // Sign-in lands in storage from the handoff tab; follow it.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !(AUTH_UID_KEY in changes)) return;
        void signedInEmail().then((email) => {
            view.email = email;
            render();
        });
    });
}

async function signedInEmail(): Promise<string | null> {
    const res = await send<{ signedIn?: boolean; email?: string }>({ action: 'AUTH_STATUS' });
    return res?.signedIn ? res.email ?? '' : null;
}

function paint(root: HTMLElement, v: View, update: (p: Partial<WelcomeState>) => Promise<void>): void {
    root.replaceChildren(menu(v, update), main(v, update));
}

const STEP_LABELS = (): string[] => [
    t('welcomeStepLanguage', 'Language'),
    t('welcomeStepAccount', 'Account'),
    t('welcomeStepSettings', 'Settings'),
];

function statusText(s: StepStatus): string {
    switch (s) {
        case 'required':
            return t('welcomeStatusRequired', 'Required');
        case 'optional':
            return t('welcomeStatusOptional', 'Optional');
        case 'skipped':
            return t('welcomeStatusSkipped', 'Skipped');
        default:
            return '';
    }
}

function menu(v: View, update: (p: Partial<WelcomeState>) => Promise<void>): HTMLElement {
    const nav = el('nav', 'wl-menu');
    nav.setAttribute('aria-label', t('welcomeMenuLabel', 'Setup steps'));
    const brand = el('div', 'wl-brand');
    brand.append(el('span', 'wl-logo'), document.createTextNode('Lingogram'));

    const done = doneCount(v.state, v.email !== null);
    const progress = el('div', 'wl-progress');
    const bar = el('div', 'wl-bar');
    const fill = el('div', 'wl-bar-fill');
    fill.style.width = `${Math.round((done / 3) * 100)}%`;
    bar.appendChild(fill);
    progress.append(bar, el('span', 'wl-progress-text', t('welcomeProgress', '{done} of 3 done').replace('{done}', String(done))));

    const list = el('div', 'wl-steps');
    const statuses = stepStatuses(v.state, v.email !== null);
    STEP_LABELS().forEach((label, i) => {
        const st = statuses[i];
        const row = el('button', 'wl-step');
        row.type = 'button';
        if (v.state.step === i) {
            row.classList.add('is-current');
            row.setAttribute('aria-current', 'step');
        }
        const dot = el('span', `wl-dot${st === 'done' ? ' is-done' : ''}`, st === 'done' ? '✓' : String(i + 1));
        dot.setAttribute('aria-hidden', 'true');
        const sub = el('span', `wl-step-status${st === 'skipped' ? ' is-skipped' : ''}`, statusText(st));
        row.append(dot, el('span', 'wl-step-label', label), sub);
        row.addEventListener('click', () => void update({ step: i as StepId }));
        list.appendChild(row);
    });

    const about = el('a', 'wl-about', t('welcomeAbout', 'How Lingogram works'));
    about.href = `${config.frontendBaseUrl}/welcome/?ext=${v.opts.edition}`;
    about.target = '_blank';
    about.rel = 'noopener';

    nav.append(brand, progress, list, about);
    return nav;
}

function main(v: View, update: (p: Partial<WelcomeState>) => Promise<void>): HTMLElement {
    const m = el('main', 'wl-main');
    const box = el('div', 'wl-content');
    m.appendChild(box);
    if (v.state.step === 0) languageStep(box, v, update);
    else if (v.state.step === 1) accountStep(box, v, update);
    else settingsStep(box, v, update);
    return m;
}

function heading(box: HTMLElement, title: string, lead: string): void {
    box.append(el('h1', 'wl-title', title), el('p', 'wl-lead', lead));
}

function primaryButton(text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'wl-primary', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

function pickerLanguages(v: View): SupportedLanguage[] {
    const codes = v.opts.languages;
    if (!codes) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter((l) => codes.includes(l.code));
}

function languageSelect(label: string, langs: SupportedLanguage[], value: string): { row: HTMLElement; select: HTMLSelectElement } {
    const row = el('label', 'wl-field');
    row.appendChild(el('span', 'wl-field-label', label));
    const select = el('select', 'wl-select');
    const placeholder = el('option', undefined, t('ytPopupSelect', 'Select…'));
    placeholder.value = '';
    placeholder.disabled = true;
    select.appendChild(placeholder);
    for (const l of langs) {
        const o = el('option', undefined, l.native === l.label ? l.label : `${l.label} — ${l.native}`);
        o.value = l.code;
        select.appendChild(o);
    }
    select.value = value;
    row.appendChild(select);
    return { row, select };
}

function languageStep(box: HTMLElement, v: View, update: (p: Partial<WelcomeState>) => Promise<void>): void {
    heading(
        box,
        t('welcomeLangTitle', 'Which language are you learning?'),
        t('welcomeLangLead', 'Subtitles in this language come first, with a translation into yours below.'),
    );
    const langs = pickerLanguages(v);
    const learning = languageSelect(t('ytPopupLearning', "I'm learning"), langs, '');
    const native = languageSelect(t('ytPopupNative', 'My native language'), langs, '');
    const hint = el('span', 'wl-hint', t('welcomeLangHint', 'Native language guessed from your browser.'));
    const next = primaryButton(t('welcomeContinue', 'Continue'), () => {
        if (!learning.select.value || !native.select.value) return;
        void saveLanguagePrefs({ learning: learning.select.value, native: native.select.value }, 'welcome');
        trackVia('welcome_step', { step: 'language', action: 'done' });
        void update({ step: 1, languageDone: true });
    });
    const sync = () => {
        next.disabled = !learning.select.value || !native.select.value;
    };
    learning.select.addEventListener('change', sync);
    native.select.addEventListener('change', sync);
    box.append(learning.row, native.row, hint, next);

    void loadLanguagePrefs().then((p) => {
        const offered = langs.map((l) => l.code);
        learning.select.value = p?.learning && offered.includes(p.learning) ? p.learning : offered.includes('en') ? 'en' : '';
        native.select.value = p?.native ?? guessNative(chrome.i18n?.getUILanguage?.() ?? '', offered);
        sync();
    });
    sync();
}

function accountStep(box: HTMLElement, v: View, update: (p: Partial<WelcomeState>) => Promise<void>): void {
    heading(
        box,
        t('welcomeAccountTitle', 'Keep your words in one place'),
        t(
            'welcomeAccountLead',
            'With an account, the words you save stay in one list on lingogram.ai and in every browser. One sign-in covers both the site and the extension.',
        ),
    );
    if (v.email !== null) {
        box.appendChild(
            el('div', 'wl-ok', t('welcomeSignedIn', 'Signed in as {email} on lingogram.ai and in the extension').replace('{email}', v.email)),
        );
        box.appendChild(primaryButton(t('welcomeContinue', 'Continue'), () => void update({ step: 2 })));
        return;
    }
    const signIn = primaryButton(t('welcomeSignIn', 'Sign in or create an account'), () => {
        signIn.disabled = true;
        void send({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'welcome' }).then(() => {
            signIn.disabled = false;
        });
    });
    const skip = el('button', 'wl-secondary', t('welcomeSkip', 'Skip for now'));
    skip.type = 'button';
    skip.addEventListener('click', () => {
        trackVia('welcome_step', { step: 'account', action: 'skipped' });
        void update({ step: 2, skippedAccount: true });
    });
    box.append(signIn, skip, el('span', 'wl-hint', t('welcomeAccountHint', 'Subtitles and the transcript work without an account.')));
}

function switchRow(title: string, sub: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
    const row = el('label', 'wl-row');
    const text = el('span', 'wl-row-text');
    text.append(el('span', 'wl-row-title', title), el('span', 'wl-row-sub', sub));
    const box = el('input', 'wl-switch');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));
    row.append(text, box);
    return row;
}

function settingsStep(box: HTMLElement, v: View, update: (p: Partial<WelcomeState>) => Promise<void>): void {
    heading(
        box,
        t('welcomeSettingsTitle', 'Choose where Lingogram works'),
        t('welcomeSettingsLead', 'You can change any of this later in the extension menu.'),
    );
    const { own, other } = sitesOf(v.opts.edition);

    box.appendChild(el('div', 'wl-group-title', t('welcomeVideoSites', 'Video sites')));
    const sites = el('div', 'wl-group');
    const ownRows = own.map((site) => {
        const row = switchRow(SITE_NAME[site], t('welcomeSiteSub', 'Dual subtitles and the transcript'), true, (on) => {
            void savePrefs({ [sitePrefKey(site)]: on });
        });
        sites.appendChild(row);
        return { site, row };
    });
    // The other edition's sites: not a switch here — that edition is its own
    // extension. Its store page, or "Installed" when it answers the ping.
    const otherRow = el('div', 'wl-row');
    const otherText = el('span', 'wl-row-text');
    otherText.append(
        el('span', 'wl-row-title', other.map((s) => SITE_NAME[s]).join(', ')),
        el(
            'span',
            'wl-row-sub',
            v.siblingInstalled
                ? t('welcomeOtherInstalledSub', 'Its own Lingogram extension, already here')
                : t('welcomeOtherSub', 'Its own Lingogram extension, from the Chrome Web Store'),
        ),
    );
    otherRow.appendChild(otherText);
    if (v.siblingInstalled) {
        otherRow.appendChild(el('span', 'wl-installed', t('welcomeInstalled', 'Installed')));
    } else {
        const add = el('a', 'wl-secondary wl-add', t('welcomeAddToChrome', 'Add to Chrome'));
        add.href = STORE_URL(v.opts.edition === 'youtube' ? 'rezka' : 'youtube');
        add.target = '_blank';
        add.rel = 'noopener';
        otherRow.appendChild(add);
    }
    sites.appendChild(otherRow);
    box.appendChild(sites);

    box.appendChild(el('div', 'wl-group-title', t('welcomeAnyWebsite', 'Any website')));
    const web = el('div', 'wl-group');
    const highlight = switchRow(
        t('popupPageHighlightLabel', 'Highlight my words on websites'),
        t('popupPageHighlightHint', 'Words you saved are marked on any page you read. Checked on your device; nothing is sent.'),
        true,
        (on) => void savePrefs({ pageHighlight: on }),
    );
    web.appendChild(highlight);
    box.appendChild(web);

    const finishLabel =
        v.opts.edition === 'youtube' ? t('welcomeFinishYoutube', 'Finish and open YouTube') : t('welcomeFinish', 'Finish');
    box.appendChild(
        primaryButton(finishLabel, () => {
            trackVia('welcome_step', { step: 'settings', action: 'finished' });
            void update({ finished: true }).then(() => {
                const url = FINISH_URL[v.opts.edition];
                if (url) location.href = url;
                else window.close();
            });
        }),
    );

    // The switches render optimistically on (the defaults) and settle here.
    void loadPrefs().then((p) => {
        for (const { site, row } of ownRows) {
            (row.querySelector('input') as HTMLInputElement).checked = p[sitePrefKey(site)];
        }
        (highlight.querySelector('input') as HTMLInputElement).checked = p.pageHighlight;
    });
}
