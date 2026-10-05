// The extension's own settings page (settings.html, the manifest's
// options_page). Everything that left the toolbar popup lives here, with room to
// say what each switch does. It works signed in or out: a signed-in learner has
// the same things on the site, and this page stays as the fallback.

import { trackVia } from '../analytics';
import { msg as i18nMsg } from '../i18n';
import {
    SUPPORTED_LANGUAGES,
    SupportedLanguage,
    loadLanguagePrefs,
    saveLanguagePrefs,
} from '../languages';
import { withHighlight } from '../highlight-hosts';
import { loadPrefs, onPrefsChanged, savePrefs } from '../prefs';
import type { Edition } from '../sibling';
import { renderGtImport } from '../popup/gt-import-view';
import { el, fill, HIGHLIGHT_ANCHOR, iconImage, send, startSignIn, WORDS_PAGE, type AuthStatus } from '../popup/shared';
import { makeSwitch, renderSwitches } from '../popup/switches';

export interface SettingsOptions {
    edition: Edition;
    /** Language codes the pickers offer; omitted = all supported ones (Rezka ships only a few). */
    languages?: string[];
}

function pickerLanguages(allowed: string[] | undefined): SupportedLanguage[] {
    if (!allowed) return SUPPORTED_LANGUAGES;
    const byCode = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));
    return allowed.map((c) => byCode.get(c)).filter((l): l is SupportedLanguage => !!l);
}

function group(label: string): HTMLElement {
    const g = el('section', 'group');
    g.appendChild(el('h2', 'group-label', label));
    return g;
}

function makeLangRow(labelText: string, languages: SupportedLanguage[]): { row: HTMLElement; select: HTMLSelectElement } {
    const row = el('label', 'row');
    const text = el('span', 'row-text');
    text.appendChild(el('span', 'row-label', labelText));
    const select = el('select', 'lang-select');

    const placeholder = el('option', undefined, i18nMsg('ytPopupSelect', 'Select…'));
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    for (const lang of languages) {
        const opt = el('option');
        opt.value = lang.code;
        opt.textContent = lang.native === lang.label ? lang.label : `${lang.label} — ${lang.native}`;
        select.appendChild(opt);
    }
    row.append(text, select);
    return { row, select };
}

function languageGroup(allowed: string[] | undefined): HTMLElement {
    const section = group(i18nMsg('ytGroupLanguages', 'Languages'));
    const languages = pickerLanguages(allowed);
    const learning = makeLangRow(i18nMsg('ytPopupLearning', "I'm learning"), languages);
    const native = makeLangRow(i18nMsg('ytPopupNative', 'My native language'), languages);
    section.append(learning.row, native.row);

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
        // 'popup' is the label for "chosen in the extension itself"; the page
        // that moved here was the popup, and no analytics reader tells the two apart.
        void saveLanguagePrefs({ learning: l, native: n }, 'popup');
    };
    learning.select.addEventListener('change', persist);
    native.select.addEventListener('change', persist);
    return section;
}

/**
 * "Not highlighted on:" and the sites turned off from the popup, each with the
 * way back. Not there while the list is empty. Kept current when the list
 * changes (a popup in another window, or a click here).
 */
function offHostsLine(): HTMLElement {
    const line = el('div', 'off-hosts');
    line.hidden = true;
    const paint = (hosts: string[]) => {
        line.replaceChildren();
        line.hidden = hosts.length === 0;
        if (hosts.length === 0) return;
        line.appendChild(document.createTextNode(i18nMsg('settingsHighlightOffOn', 'Not highlighted on:')));
        for (const host of hosts) {
            const chip = el('span', 'off-host');
            const remove = el('button', undefined, '×');
            remove.type = 'button';
            remove.setAttribute(
                'aria-label',
                fill(i18nMsg('settingsHighlightOnAgain', 'Highlight words on {site} again'), { site: host }),
            );
            remove.addEventListener('click', () => {
                void loadPrefs().then((p) => savePrefs({ highlightOffHosts: withHighlight(p.highlightOffHosts, host, true) }));
            });
            chip.append(el('span', undefined, host), remove);
            line.appendChild(chip);
        }
    };
    void loadPrefs().then((p) => paint(p.highlightOffHosts));
    onPrefsChanged((p) => paint(p.highlightOffHosts));
    return line;
}

function privacyGroup(): HTMLElement {
    const section = group(i18nMsg('ytGroupPrivacy', 'Privacy'));
    const { row, input } = makeSwitch({
        label: i18nMsg('ytPrivacyAnalyticsLabel', 'Share anonymous usage stats'),
        hint: i18nMsg(
            'ytPrivacyAnalyticsHint',
            'Counts like “subtitles loaded” and “word saved”. Never your account, the videos you watch, or the words you save.',
        ),
        pref: 'analyticsEnabled',
        // Optimistically matches DEFAULT_PREFS, corrected below once storage
        // resolves. Rendering unchecked first would flash "off" on a privacy
        // control, which reads far worse than the reverse.
        initial: true,
    });
    section.appendChild(row);
    void loadPrefs().then((p) => {
        input.checked = p.analyticsEnabled;
    });
    input.addEventListener('change', () => {
        const on = input.checked;
        // Sent BEFORE the preference is written, so this final hit still passes
        // the gate. Opting back in isn't tracked: analytics is already on for
        // everyone, so that event would only ever measure re-enables.
        if (!on) trackVia('analytics_opt_out');
        void savePrefs({ analyticsEnabled: on });
    });
    return section;
}

/** A row of the account group: what is true, and the one button that goes with it. */
function accountRow(title: string, hint: string | null, button: HTMLButtonElement, titleClass = ''): HTMLElement {
    const row = el('div', 'row');
    const text = el('div', 'row-text');
    text.appendChild(el('div', `row-label ${titleClass}`.trim(), title));
    if (hint) text.appendChild(el('div', 'row-hint', hint));
    row.append(text, button);
    return row;
}

// Two paints can be in flight at once (a storage change and a click both ask
// for one). Each builds its rows off to the side and swaps them in after its
// await, and only the latest one may: an older answer arriving late is dropped
// instead of adding a second set of rows.
const paintSeq = new WeakMap<HTMLElement, number>();

/** Fills the account group from the worker's answer; called again whenever the account changes. */
async function paintAccount(section: HTMLElement): Promise<void> {
    const mine = (paintSeq.get(section) ?? 0) + 1;
    paintSeq.set(section, mine);
    const label = section.querySelector('.group-label');
    const keepLabel = label ? [label] : [];

    let status: AuthStatus;
    try {
        status = await send<AuthStatus>({ action: 'AUTH_STATUS' });
    } catch (err) {
        if (paintSeq.get(section) === mine) section.replaceChildren(...keepLabel, el('div', 'error', String(err)));
        return;
    }
    if (paintSeq.get(section) !== mine) return;
    const rows: Node[] = [];

    const signInButton = (text: string): HTMLButtonElement => {
        const b = el('button', 'primary', text);
        b.addEventListener('click', async () => {
            b.disabled = true;
            try {
                await startSignIn('settings');
            } catch (err) {
                b.disabled = false;
                section.appendChild(el('div', 'error', String(err)));
            }
        });
        return b;
    };

    if (status.signedIn) {
        const out = el('button', 'secondary', i18nMsg('ytAuthSignOut', 'Sign out'));
        out.addEventListener('click', async () => {
            out.disabled = true;
            try {
                await send({ action: 'AUTH_SIGN_OUT' });
            } catch (err) {
                out.disabled = false;
                section.appendChild(el('div', 'error', String(err)));
                return;
            }
            await paintAccount(section);
        });
        const who = status.email ?? i18nMsg('ytPopupUnknownEmail', '(unknown email)');
        rows.push(accountRow(who, null, out, 'email'));
    } else if (status.needsReauth) {
        rows.push(
            accountRow(
                i18nMsg('settingsSignedOutTitle', 'You were signed out'),
                i18nMsg('settingsSignedOutHint', 'Sign in again to keep saving words.'),
                signInButton(i18nMsg('accountSignInAgain', 'Sign in again')),
            ),
        );
    } else {
        rows.push(
            accountRow(
                i18nMsg('settingsNotSignedIn', 'Not signed in'),
                i18nMsg('settingsNotSignedInHint', 'Your words are kept in this browser. Sign in to keep them on every device.'),
                signInButton(i18nMsg('accountSignInOnLingogram', 'Sign in on Lingogram')),
            ),
        );
    }
    section.replaceChildren(...keepLabel, ...rows);
}

export function initSettings(opts: SettingsOptions): void {
    const page = document.getElementById('page');
    if (!page) {
        console.error('[Lingogram] settings: #page not found');
        return;
    }
    page.replaceChildren();
    document.title = i18nMsg('settingsTitle', 'Settings');

    const head = el('header', 'page-head');
    const title = el('h1');
    title.append(iconImage(28), document.createTextNode(document.title));
    const words = el('a', 'link', i18nMsg('settingsMyWords', 'My words'));
    words.href = WORDS_PAGE;
    head.append(title, words);
    page.appendChild(head);

    page.appendChild(languageGroup(opts.languages));

    const works = group(i18nMsg('settingsGroupWorks', 'Where Lingogram works'));
    renderSwitches(works, opts.edition, {
        youtube: i18nMsg('settingsYoutubeHint', 'Dual subtitles and the word list next to the video.'),
        highlight: i18nMsg(
            'settingsHighlightHint',
            'Words you saved are marked on any page you read. Point at one to see its translation.',
        ),
    });
    works.appendChild(offHostsLine());
    page.appendChild(works);

    // The import paints its own small heading ("Google Translate"), styled like
    // the group labels around it.
    const gt = el('section', 'group');
    renderGtImport(gt);
    page.appendChild(gt);

    page.appendChild(privacyGroup());

    const account = group(i18nMsg('settingsGroupAccount', 'Account'));
    page.appendChild(account);
    void paintAccount(account);
    // "Manage sites" in the popup lands here: settings.html#highlight.
    if (location.hash === `#${HIGHLIGHT_ANCHOR}`) document.getElementById(HIGHLIGHT_ANCHOR)?.scrollIntoView();
    // Signing in happens in another tab; the page follows it without a reload.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('auth.'))) void paintAccount(account);
    });
}
