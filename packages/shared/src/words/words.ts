// "My words": the words kept in this browser, as a full-tab page (words.html).
// Reached from the popup without an account; a signed-in learner has the same
// list, and much more, on the site, so there it is a pointer plus whatever is
// still waiting to be uploaded.
//
// Words are read and changed only through the worker (LOCAL_WORDS_LIST,
// REMOVE_WORD, ...): the worker owns the store and its write queue.

import { msg as i18nMsg } from '../i18n';
import { loadLanguagePrefs } from '../languages';
import { LOCAL_WORDS_KEY, type LocalWord } from '../local-words';
import { el, fill, iconImage, openTab, send, SETTINGS_PAGE, startSignIn, vocabUrl, type AuthStatus } from '../popup/shared';
import { normalizeTerm } from '../word-key';
import { MIRROR_KEY } from '../word-mirror';
import { SITE_NAMES } from '../welcome/welcome';

/** Lookups in flight at once: a long list must not become a burst at the dictionary. */
const MAX_LOOKUPS = 2;
/** Translations shown after "·" and stored. */
const TRANSLATIONS_SHOWN = 3;

/** A save's `site` label as the page names it; other saves (web, unknown) name nothing. */
export function sourceName(site: string): string {
    return Object.prototype.hasOwnProperty.call(SITE_NAMES, site) ? SITE_NAMES[site as keyof typeof SITE_NAMES] : '';
}

interface LookupReply {
    ok?: boolean;
    result?: { translations?: string[] };
}

export function initWords(): void {
    const page = document.getElementById('page');
    if (!page) {
        console.error('[Lingogram] words: #page not found');
        return;
    }
    page.replaceChildren();
    document.title = i18nMsg('wordsTitle', 'My words');

    // --- the page's fixed parts; refresh() fills them -------------------------
    const head = el('header', 'page-head');
    const title = el('h1');
    title.append(iconImage(28), document.createTextNode(document.title));
    const count = el('span', 'dim sm head-count');
    count.hidden = true;
    const settings = el('a', 'link', i18nMsg('popupSettingsLink', 'Settings'));
    settings.href = SETTINGS_PAGE;
    head.append(title, count, settings);

    const notice = el('div');
    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = i18nMsg('wordsSearchPlaceholder', 'Search your words');
    search.setAttribute('aria-label', search.placeholder);
    search.hidden = true;
    const list = el('div', 'words');
    page.append(head, notice, search, list);

    // --- state ---------------------------------------------------------------
    let words: LocalWord[] = [];
    let status: AuthStatus | null = null;
    let native = '';
    let loaded = false;
    // term key -> the translation text of the row that shows it now.
    let translationCells = new Map<string, HTMLElement>();
    // Terms already asked for in this page session, by the same key the store
    // uses: a word is never looked up twice, whatever the outcome.
    const asked = new Set<string>();
    // What lookups found, until the stored copy comes back with them.
    const found = new Map<string, string>();
    const queue: string[] = [];
    let inFlight = 0;

    const signedIn = () => status?.signedIn === true;
    const wordByKey = (key: string) => words.find((w) => normalizeTerm(w.term) === key);

    // --- lookups -------------------------------------------------------------
    // The list is replaced wholesale on every refresh, so a lookup holds the
    // word's key, not the object it was queued with.
    async function lookup(key: string): Promise<void> {
        const w = wordByKey(key);
        // Removed while it waited in the queue.
        if (!w) return;
        try {
            const res = await send<LookupReply>({
                action: 'LOOKUP_WORD',
                term: w.term,
                context: '',
                targetLang: native,
                // Not a page of a site: the same label an unknown host gets.
                site: 'other',
            });
            // A failed or unconfigured lookup leaves the cell blank: nothing to
            // report, nothing to retry.
            if (!res?.ok) return;
            const text = (res.result?.translations ?? [])
                .filter((t) => t.trim() !== '')
                .slice(0, TRANSLATIONS_SHOWN)
                .join(', ');
            if (!text) return;
            found.set(key, text);
            const now = wordByKey(key);
            if (now) now.translation = text;
            const cell = translationCells.get(key);
            if (cell) cell.textContent = `· ${text}`;
            await send({ action: 'LOCAL_WORD_SET_TRANSLATION', term: w.term, translation: text });
        } catch {
            /* the cell stays blank */
        }
    }

    function pump(): void {
        while (inFlight < MAX_LOOKUPS && queue.length > 0) {
            const key = queue.shift()!;
            inFlight++;
            void lookup(key).finally(() => {
                inFlight--;
                pump();
            });
        }
    }

    function enqueueLookups(): void {
        // Without a native language there is nothing to translate into.
        if (!native) return;
        for (const w of words) {
            const key = normalizeTerm(w.term);
            if (w.translation || asked.has(key)) continue;
            asked.add(key);
            queue.push(key);
        }
        pump();
    }

    // --- drawing -------------------------------------------------------------
    function paintNotice(): void {
        notice.replaceChildren();
        if (signedIn()) {
            const card = el('div', 'note');
            const text = el('div', 'note-text');
            text.appendChild(el('b', undefined, i18nMsg('wordsAccountCard', 'Your words are in your Lingogram vocabulary.')));
            const open = el('button', 'primary', i18nMsg('popupOpenVocabulary', 'Open my vocabulary'));
            open.addEventListener('click', () => void openTab(vocabUrl()));
            card.append(text, open);
            notice.appendChild(card);
            return;
        }
        if (words.length === 0) return;
        const card = el('div', 'note');
        const text = el('div', 'note-text');
        text.appendChild(el('b', undefined, i18nMsg('wordsLocalNoticeTitle', 'These words are stored only in this browser.')));
        text.appendChild(
            el(
                'small',
                undefined,
                i18nMsg(
                    'wordsLocalNoticeText',
                    'Sign in to keep them on every device and practise them. They move to your account on their own.',
                ),
            ),
        );
        const button = el('button', 'primary', i18nMsg('accountSignInOnLingogram', 'Sign in on Lingogram'));
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await startSignIn('words');
            } catch (err) {
                button.disabled = false;
                notice.appendChild(el('div', 'error', String(err)));
            }
        });
        card.append(text, button);
        notice.appendChild(card);
    }

    function wordRow(w: LocalWord): HTMLElement {
        const row = el('div', 'word');
        const main = el('div', 'word-main');
        main.appendChild(el('b', 'term', w.term));
        main.appendChild(document.createTextNode(' '));
        const tr = el('span', 'tr', w.translation ? `· ${w.translation}` : '');
        main.appendChild(tr);
        translationCells.set(normalizeTerm(w.term), tr);

        const remove = el('button', 'secondary small', i18nMsg('wordsRemove', 'Remove'));
        remove.addEventListener('click', async () => {
            remove.disabled = true;
            row.querySelector('.error')?.remove();
            let ok = false;
            try {
                ok = (await send<{ ok?: boolean }>({ action: 'REMOVE_WORD', term: w.term, site: w.site }))?.ok === true;
            } catch {
                ok = false;
            }
            if (!ok) {
                remove.disabled = false;
                const err = el('div', 'error', i18nMsg('wordsRemoveFailed', "Couldn't remove the word. Try again."));
                err.setAttribute('role', 'alert');
                row.appendChild(err);
                return;
            }
            words = words.filter((x) => x !== w);
            paintList();
            void refresh();
        });

        row.append(main, remove);

        const source = sourceName(w.site);
        if (w.context || source) {
            const line = el('div', 'cx');
            if (w.context) line.appendChild(document.createTextNode(`“${w.context}”`));
            if (source) line.appendChild(el('span', 'src', w.context ? ` · ${source}` : source));
            row.appendChild(line);
        }
        return row;
    }

    function paintList(): void {
        translationCells = new Map();
        list.replaceChildren();
        count.textContent = fill(i18nMsg('wordsCount', '{count} words'), {
            count: signedIn() ? (status?.inboxCount ?? 0) : words.length,
        });
        count.hidden = !loaded;
        search.hidden = words.length === 0;
        paintNotice();

        if (words.length === 0) {
            // Signed in with nothing waiting: the card above is the whole page.
            if (loaded && !signedIn()) {
                const empty = el('div', 'empty');
                empty.appendChild(el('b', undefined, i18nMsg('wordsEmptyTitle', 'No words yet')));
                empty.appendChild(
                    el('div', 'dim', i18nMsg('wordsEmptyText', 'Click a word in the subtitles, then Save. Words you save show up here.')),
                );
                list.appendChild(empty);
            }
            return;
        }

        if (signedIn()) {
            list.appendChild(el('h2', 'group-label', i18nMsg('wordsWaitingHeading', 'Waiting to be added to your account')));
        }
        const q = search.value.trim().toLowerCase();
        for (const w of words) {
            if (q && !w.term.toLowerCase().includes(q) && !(w.translation ?? '').toLowerCase().includes(q)) continue;
            list.appendChild(wordRow(w));
        }
    }

    // --- loading -------------------------------------------------------------
    let token = 0;
    async function refresh(): Promise<void> {
        const mine = ++token;
        try {
            const [listed, auth, langs] = await Promise.all([
                send<{ ok?: boolean; words?: LocalWord[] }>({ action: 'LOCAL_WORDS_LIST' }),
                send<AuthStatus>({ action: 'AUTH_STATUS' }),
                loadLanguagePrefs(),
            ]);
            if (mine !== token) return; // a newer refresh is already on its way
            words = listed?.ok && listed.words ? listed.words : [];
            for (const w of words) {
                const text = found.get(normalizeTerm(w.term));
                if (!w.translation && text) w.translation = text;
            }
            status = auth;
            native = langs?.native ?? '';
        } catch (err) {
            if (mine !== token) return;
            list.replaceChildren(el('div', 'error', String(err)));
            return;
        }
        loaded = true;
        paintList();
        enqueueLookups();
    }

    search.addEventListener('input', paintList);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const keys = Object.keys(changes);
        if (keys.some((k) => k === LOCAL_WORDS_KEY || k === MIRROR_KEY || k.startsWith('auth.'))) void refresh();
    });
    void refresh();
}
