// The word screen — the full entry for one word, taking over the sidebar.
//
// A takeover in the settings mould (.vtt-lookup-open hides the transcript, the
// title becomes the word, "‹ Subtitles" walks back). Chosen over an inline
// expansion because the list auto-scrolls with playback — the video keeps
// playing — so an in-flow card rides out of view within two cues, and freezing
// the scroll would break the sync the transcript exists for.
//
// It renders into a panel the sidebar built and reaches everything else
// through WordScreenHost. That indirection is what lets a sidebar exist
// without this screen at all: the marketing-site embed reuses the sidebar but
// has no service worker to reach the dictionary through, so it constructs one
// with no word screen and never loads this file.
import { platformOf } from '../analytics';
import { createSavedWords } from './saved-words';
import { loadMirror, onMirrorChanged } from '../word-mirror';
import { msg } from '../i18n';
import { removeTerm, saveTerm, sendMessage } from '../content/quick-add-overlay';
import { HEART_SVG, ICON_EXTERNAL, posLabel } from './icons';
import { isContextual, hasLookupContent, oxfordLookupUrl, showsLemma } from './shape';
import { LookupResult } from './types';

/**
 * What the word screen needs from the sidebar hosting it.
 *
 * A hand-built object of closures rather than an interface the sidebar
 * implements: three of these are private methods there, and `implements` would
 * force them public — widening exactly the surface this module exists to
 * narrow. A closure grants the one capability without changing a declaration.
 *
 * The elements are GETTERS, never captured values: the sidebar reassigns its
 * element map wholesale on every registration and empties it on teardown, so a
 * captured node would go stale and would outlive the panel it belongs to.
 */
export interface WordScreenHost {
    /** The panel root. Carries .vtt-lookup-open; the takeover CSS keys on it. */
    sidebar(): HTMLDivElement | undefined;
    /** This screen's own panel, a child of #vtt-header. */
    panel(): HTMLDivElement | undefined;
    /** The header title — swaps between "Subtitles" and the word. */
    title(): HTMLHeadingElement | undefined;
    /** The "‹ Subtitles" chip, focused when the screen opens. */
    backBtn(): HTMLButtonElement | undefined;

    /** The chosen pair, or null before onboarding. Both halves are read. */
    langPrefs(): { learning: string; native: string } | null;

    isCollapsed(): boolean;
    openPanel(): void;
    /** Slide the panel away. Narrower than the host's setter: only true is ever wanted. */
    collapse(): void;
    toggleCollapsed(): void;

    /** Tear down whichever sibling takeover is open — screens never stack. */
    closeOtherTakeovers(): void;
    /** The transcript kept scrolling under the screen; catch it up on exit. */
    restoreTranscriptScroll(): void;
}

export class WordScreen {
    constructor(private readonly host: WordScreenHost) {
        // Seed from the mirror and then track it. Both are fire-and-forget:
        // the screen must be usable the instant it is constructed, and a word
        // opened before the seed lands simply renders from what is known then —
        // the subscription repaints nothing, but the next open reads the filled
        // view. Failing to load leaves an empty view, which is the pre-mirror
        // behaviour rather than a broken screen.
        this.seeded = loadMirror().then((m) => {
            this.savedWords.reset(m.words);
        });
        this.unsubscribeMirror = onMirrorChanged((m) => this.savedWords.reset(m.words));
    }

    /** Stops tracking the mirror. */
    dispose(): void {
        this.unsubscribeMirror?.();
        this.unsubscribeMirror = undefined;
    }

    private unsubscribeMirror?: () => void;
    // Resolves once the first mirror read has been applied. The article is
    // awaited on it before painting: a screen opened in the moments after the
    // content script installs would otherwise render an empty heart for a word
    // the learner has saved — the very lie the mirror exists to end — and then
    // never repaint, because nothing changed to repaint it. Waiting costs
    // nothing: the lookup round trip it sits beside is far slower.
    private seeded: Promise<void> = Promise.resolve();

    private seq = 0;
    // The same in-tab view the strip holds — see ./saved-words. One object,
    // so the heart on the card and the controls on this screen cannot end up
    // disagreeing about whether a word is saved.
    private savedWords = createSavedWords();
    // Whether opening the word screen is what expanded the sidebar. The tab's
    // cross closes the word screen either way; this decides whether it also
    // collapses the panel — closing must put things back the way they were.
    private openedPanel = false;

    open(term: string, context: string): void {
        const panel = this.host.panel();
        const sidebar = this.host.sidebar();
        if (!panel || !sidebar) return;
        // Remember what opening is about to change — but only on entry. A
        // second word opened from the overlay while the screen is already up
        // must not overwrite how the FIRST one found the panel.
        if (!sidebar.classList.contains('vtt-lookup-open')) {
            this.openedPanel = this.host.isCollapsed();
        }
        this.host.openPanel();
        // Takeovers do not stack: all three back chips sit absolute at the
        // same spot, so whichever screen is open leaves before this one shows.
        this.host.closeOtherTakeovers();
        sidebar.classList.add('vtt-lookup-open');
        const titleEl = this.host.title();
        if (titleEl) titleEl.textContent = term;
        this.renderPending(panel);
        this.host.backBtn()?.focus();
        void this.fetchArticle(term, context);
    }

    /**
     * The collapse tab while the word screen is up. Its glyph is a cross
     * there, and a cross means "close the word screen" — after which the
     * panel returns to how the word screen found it: it stays open when the
     * user was reading the transcript, and collapses again when the screen
     * had auto-expanded a collapsed sidebar (the pill's "More" over the
     * video). One tap always undoes the whole detour.
     */
    onToggleTab(): void {
        const sidebar = this.host.sidebar();
        if (sidebar?.classList.contains('vtt-lookup-open') && !this.host.isCollapsed()) {
            const collapse = this.openedPanel;
            this.close();
            if (collapse) this.host.collapse();
            return;
        }
        this.host.toggleCollapsed();
    }

    close(): void {
        const sidebar = this.host.sidebar();
        if (!sidebar?.classList.contains('vtt-lookup-open')) return;
        this.openedPanel = false;
        sidebar.classList.remove('vtt-lookup-open');
        this.seq++;
        this.host.panel()?.replaceChildren();
        const titleEl = this.host.title();
        if (titleEl) titleEl.textContent = msg('ytSidebarTitle', 'Subtitles');
        // The video kept playing while the screen was up; catch the list up.
        this.host.restoreTranscriptScroll();
    }

    private async fetchArticle(term: string, context: string): Promise<void> {
        const seq = ++this.seq;
        await this.seeded;
        const targetLang = this.host.langPrefs()?.native ?? '';
        if (!targetLang) {
            this.renderError();
            return;
        }
        try {
            const res = await sendMessage<{ ok: boolean; result?: LookupResult }>({
                action: 'LOOKUP_WORD',
                term,
                context,
                targetLang,
                detail: true,
                site: platformOf(location.hostname),
            });
            if (seq !== this.seq) return;
            if (res?.ok && res.result) this.renderArticle(term, context, res.result);
            else this.renderError();
        } catch {
            if (seq === this.seq) this.renderError();
        }
    }

    private renderPending(panel: HTMLDivElement): void {
        panel.replaceChildren();
        const line = document.createElement('div');
        line.className = 'vtt-lookup-article-pending';
        line.textContent = msg('ytLookupLoading', 'Looking up…');
        panel.appendChild(line);
    }

    private renderError(): void {
        const panel = this.host.panel();
        if (!panel) return;
        panel.replaceChildren();
        const line = document.createElement('div');
        line.className = 'vtt-lookup-article-pending';
        line.setAttribute('role', 'alert');
        line.textContent = msg('ytLookupError', "Couldn't load");
        panel.appendChild(line);
    }

    // The article layout: headword + lemma + source badge, the word-level
    // translations, the cue it came from, then parts of speech in server order
    // (the first tag is the one this cue uses) with numbered senses. The save
    // button lives in a pinned footer so it never depends on article length.
    private renderArticle(term: string, context: string, r: LookupResult): void {
        const panel = this.host.panel();
        if (!panel) return;
        panel.replaceChildren();

        const scroll = document.createElement('div');
        scroll.className = 'vtt-lookup-scroll';

        const head = document.createElement('div');
        head.className = 'vtt-lookup-article-head';
        const headword = document.createElement('span');
        headword.className = 'vtt-lookup-headword';
        headword.textContent = r.term || term;
        head.appendChild(headword);
        if (showsLemma(r)) {
            const lemma = document.createElement('span');
            lemma.className = 'vtt-lookup-lemma';
            lemma.textContent = r.lemma;
            head.appendChild(lemma);
        }
        // Heart at the word itself — the save action where the eye already
        // is. The labeled footer button stays; both run the same handler
        // (wired below, once both exist) so they can never disagree.
        const termKey = term.toLowerCase();
        const alreadySaved = this.savedWords.has(termKey);
        const headHeart = document.createElement('button');
        headHeart.type = 'button';
        headHeart.className = `vtt-lookup-head-heart${alreadySaved ? ' saved' : ''}`;
        headHeart.innerHTML = HEART_SVG;
        headHeart.setAttribute('aria-label',
            alreadySaved ? msg('ytLookupRemove', 'Remove') : msg('ytLookupSave', 'Save'));
        head.appendChild(headHeart);
        if (r.source) {
            const badge = document.createElement('span');
            const isDict = r.source === 'wiktionary' || r.source === 'cache';
            badge.className = `vtt-lookup-src ${isDict ? 'dict' : 'llm'}`;
            badge.textContent = isDict
                ? msg('ytLookupSrcDict', 'dictionary')
                : msg('ytLookupSrcAi', 'AI');
            head.appendChild(badge);
        }
        scroll.appendChild(head);

        if (r.translations.length) {
            const tr = document.createElement('div');
            tr.className = 'vtt-lookup-article-tr';
            tr.textContent = r.translations.join(' · ');
            scroll.appendChild(tr);
        }

        // The cue the word was selected from — shown so the reader can weigh
        // the senses against it. Only a model answer is actually ordered by
        // it; the dictionary's order is the word's dominant reading.
        const cueLine = pickCueLine(context, term);
        if (cueLine) {
            const ctx = document.createElement('blockquote');
            ctx.className = 'vtt-lookup-ctx';
            appendWithHighlight(ctx, cueLine, term);
            scroll.appendChild(ctx);
        }

        // The lead highlight is a CLAIM — "this is the sense the phrase uses" —
        // and only a context-aware answer (per-sense translations, i.e. the
        // model) can back it. Dictionary answers are ordered by dominance, not
        // by the sentence, so they get no highlight; when the AI answer lands
        // for signed-in users, the highlight returns and is finally true.
        const contextual = isContextual(r);
        r.parts_of_speech.forEach((p, pi) => {
            if (!p.senses.length) return;
            const group = document.createElement('div');
            group.className = 'vtt-lookup-group';
            const gh = document.createElement('div');
            gh.className = 'vtt-lookup-group-head';
            const tag = document.createElement('span');
            tag.className = `vtt-lookup-pos-tag${pi === 0 && contextual ? ' lead' : ''}`;
            tag.textContent = posLabel(p.tag);
            gh.appendChild(tag);
            if (p.label) {
                const label = document.createElement('span');
                label.className = 'vtt-lookup-pos-label';
                label.textContent = p.label;
                gh.appendChild(label);
            }
            group.appendChild(gh);
            p.senses.forEach((sense, si) => {
                const row = document.createElement('div');
                row.className = 'vtt-lookup-sense';
                const num = document.createElement('span');
                num.className = 'vtt-lookup-sense-num';
                num.textContent = String(si + 1);
                row.appendChild(num);
                const body = document.createElement('div');
                if (sense.translations.length) {
                    const str = document.createElement('div');
                    str.className = 'vtt-lookup-sense-tr';
                    str.textContent = sense.translations.join(' · ');
                    body.appendChild(str);
                }
                if (sense.definition) {
                    const def = document.createElement('div');
                    def.className = 'vtt-lookup-sense-def';
                    def.textContent = sense.definition;
                    body.appendChild(def);
                }
                const ex = sense.examples[0];
                if (ex?.text) {
                    const exEl = document.createElement('div');
                    exEl.className = 'vtt-lookup-sense-ex';
                    appendWithHighlight(exEl, ex.text, ex.highlight || term);
                    if (ex.translation) {
                        const ext = document.createElement('div');
                        ext.className = 'vtt-lookup-sense-ext';
                        ext.textContent = ex.translation;
                        exEl.appendChild(ext);
                    }
                    body.appendChild(exEl);
                }
                row.appendChild(body);
                group.appendChild(row);
            });
            scroll.appendChild(group);
        });

        if (!hasLookupContent(r)) {
            const none = document.createElement('div');
            none.className = 'vtt-lookup-article-pending';
            none.textContent = msg('ytLookupNone', 'No translation');
            scroll.appendChild(none);
        }

        panel.appendChild(scroll);

        const foot = document.createElement('div');
        foot.className = 'vtt-lookup-foot';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = `vtt-lookup-save${alreadySaved ? ' saved' : ''}`;
        save.innerHTML = `${HEART_SVG}<span>${
            alreadySaved ? msg('ytLookupRemove', 'Remove') : msg('ytLookupSave', 'Save')}</span>`;
        // One word, two faces, and now a TOGGLE. The guard that used to sit
        // here — "saving again is not un-saving" — was true while removal lived
        // only in the site's word list. It is the behaviour US2 changes: a
        // second press on a filled heart takes the word off the list.
        const paint = (isSaved: boolean): void => {
            const label = isSaved ? msg('ytLookupRemove', 'Remove') : msg('ytLookupSave', 'Save');
            headHeart.classList.toggle('saved', isSaved);
            headHeart.setAttribute('aria-label', label);
            save.classList.toggle('saved', isSaved);
            const span = save.querySelector('span');
            // The footer button says what pressing it DOES, so a saved word
            // offers "Remove" rather than stating "Saved" — US2 scenario 1.
            if (span) span.textContent = label;
        };

        const doSave = async (pressed: HTMLButtonElement): Promise<void> => {
            // Dispatch on the word's current state, not on whether it has ever
            // been saved: a word the mirror calls `removed` is saved again as
            // an ordinary save, and costs a unit of the daily cap like any
            // other (US2 scenario 4).
            const wasSaved = this.savedWords.has(termKey);
            pressed.disabled = true;
            const ok = wasSaved
                ? await removeTerm(termKey, [])
                : await saveTerm(termKey, context, []);
            pressed.disabled = false;
            if (!ok) return;
            if (wasSaved) this.savedWords.delete(termKey);
            else this.savedWords.add(termKey);
            paint(!wasSaved);
        };
        headHeart.addEventListener('click', () => void doSave(headHeart));
        save.addEventListener('click', () => void doSave(save));
        foot.appendChild(save);
        // A second opinion, one click away — but only when Oxford can give
        // one: the site is a dictionary OF English, so the link exists only
        // for an English learning language (see oxfordLookupUrl).
        const oxford = oxfordLookupUrl(term, this.host.langPrefs()?.learning ?? '');
        if (oxford) {
            const link = document.createElement('a');
            link.className = 'vtt-lookup-oxford';
            link.href = oxford;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.innerHTML = `<span>Oxford</span>${ICON_EXTERNAL}`;
            foot.appendChild(link);
        }
        panel.appendChild(foot);
    }
}

/**
 * The context is up to three subtitle lines (previous / holding / next). The
 * article quotes only the line that actually holds the word — that is the cue
 * the server sorted the senses by.
 */
function pickCueLine(context: string, term: string): string {
    const lines = context.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    const needle = term.toLowerCase();
    return lines.find((l) => l.toLowerCase().includes(needle)) ?? lines[Math.min(1, lines.length - 1)];
}

/**
 * Appends `text` with the first occurrence of `highlight` wrapped in <b> —
 * built from text nodes, never innerHTML: both strings are subtitle/model
 * content and must stay inert.
 */
function appendWithHighlight(el: HTMLElement, text: string, highlight: string): void {
    const needle = highlight.trim();
    const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
    if (at === -1) {
        el.appendChild(document.createTextNode(text));
        return;
    }
    el.appendChild(document.createTextNode(text.slice(0, at)));
    const b = document.createElement('b');
    b.textContent = text.slice(at, at + needle.length);
    el.appendChild(b);
    el.appendChild(document.createTextNode(text.slice(at + needle.length)));
}
