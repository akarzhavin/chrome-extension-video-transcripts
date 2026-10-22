// Netflix's audio & subtitles panel gets a small block of ours on top of its
// Subtitles column: only what this viewer needs, from the two languages they
// chose. The site has their language → the one pair. It has not → their
// language alone and the pair, both by AI. Plus a quiet link to the sidebar's
// language settings for any other pair. Netflix's own list stays as it is,
// but its picks are ours: a language there is shown by the extension, one
// line, and Off turns our lines off. Netflix's own subtitles are never
// switched; its check marks follow what we show.
//
// Netflix renders the panel with React and tags its parts with data-uia
// attributes (its test hooks, stable across releases). Our items copy the
// classes of Netflix's own so they read as part of the list; clones carry no
// React handlers, and our clicks stop at the block.

import type { AppState } from '../../../../../packages/shared/src/AppState';
import { watchSpent, type AISpent } from '../../../../../packages/shared/src/ai-balance/spent';
import type { SidebarUI } from '../../../../../packages/shared/src/SidebarUI';
import { isContextOrphaned } from '../../../../../packages/shared/src/content/orphan-notice';
import { msg } from '../../../../../packages/shared/src/i18n';
import { labelForLanguage, nativeForLanguage, type LanguagePrefs } from '../../../../../packages/shared/src/languages';
import type { AiControls } from '../../../../../packages/shared/src/subtitle-ai/browser';
import { buildConfirm, confirmSkipped, costTitle } from '../../../../../packages/shared/src/subtitle-ai/confirm';
import { AI_SUFFIX } from '../../../../../packages/shared/src/subtitle-ai/controller';
import { trackLanguageCode } from '../../../../../packages/shared/src/track-label';
import { baseLang as base } from './subtitles';

export interface NetflixMenuHost {
    state: AppState;
    ui: Pick<SidebarUI, 'setMode' | 'toggleOverlay' | 'openSettings' | 'refresh'>;
    /** The viewer's own languages: what the block offers, whatever shows now. */
    langPrefs(): LanguagePrefs | null;
    /** This title's pair: the viewer's languages with its line picks over them. */
    pair(): LanguagePrefs | null;

    /** The subtitle tracks this title ships: base code and Netflix's own name for it. */
    titleTracks(): { base: string; label: string }[];
    /** Put the viewer's own pair back on the two lines (the sidebar picker may have changed them). */
    showPair(): void;
    /** Put one of the title's tracks on the first line (by base code), loading it if needed. */
    showTrack(base: string): void;
}

const PANEL = '[data-uia="selector-audio-subtitle"]';
const OPENERS = '[data-uia*="audio-subtitle"]';
const BLOCK = 'vtt-nf-block';
/** On <html> while the panel is open: the sidebar's tab steps aside (styles.css). */
const OPEN_CLASS = 'vtt-nf-panel-open';
// Presses that reach the panel around the block: Netflix would act on them.
// Keys are not among them: only the ones that pick (PICK_KEYS) are kept, so
// Tab and Escape still move focus and close the panel.
const PRESSES = ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'] as const;
const PICK_KEYS = ['Enter', ' '];


/** A node this file wrote: the block or a copied check mark (or inside one). */
function ours(node: Node): boolean {
    const el = node instanceof Element ? node : node.parentElement;
    return !!el?.closest(`.vtt-nf-block, .vtt-nf-check`);
}

/** The element holding an item's words: the deepest one whose text is all of the item's. */
function labelOf(li: Element | null): HTMLElement | null {
    if (!li) return null;
    const text = li.textContent?.trim();
    let found: HTMLElement | null = null;
    for (const el of li.querySelectorAll<HTMLElement>('*')) {
        if (el.textContent?.trim() === text && !el.querySelector('svg')) found = el;
    }
    return found;
}

/** Netflix's Subtitles list: the <ul> whose items are subtitle items, else the panel's last list. */
export function subtitleList(panel: Element): HTMLUListElement | null {
    const lists = [...panel.querySelectorAll('ul')];
    return lists.find((ul) => ul.querySelector('[data-uia*="subtitle"]')) ?? lists[lists.length - 1] ?? null;
}

/** The question about credits, and the item it was asked for. */
interface Ask {
    go: () => void;
    under: string;
}

interface Item {
    label: string;
    ai: boolean;
    checked: boolean;
    pick(): void | 'stay';
    /** Not pressable now, and why: the AI credits spent until a reset. */
    spent?: AISpent | null;
}

export function installNetflixMenu(host: NetflixMenuHost, doc: Document = document): AiControls & { destroy(): void } {
    const { state, ui } = host;
    let aiStart: (() => void) | null = null;
    let aiOff = false;
    let aiStop: (() => void) | null = null;
    /** The translation may be had here (AiControls.allowed). */
    let aiAllowed = false;
    /** The credits question while it is up: put back with the block if Netflix drops it. */
    let asking: Ask | null = null;
    let watched: Element | null = null;
    let panelObserver: MutationObserver | null = null;
    /** Undoes what watch() set up on the open panel: its listeners and observers. */
    let unwatch: (() => void) | null = null;
    /** The item a pointer went down on, by name: it may be re-rendered before the pointer comes up. */
    let pressed: string | null = null;
    /**
     * The words of the Netflix item last picked: of two items in the language
     * shown ("English", "English (CC)"), the one marked.
     */
    let netflixPick: string | null = null;
    let dead = false;
    /** The AI credits run out for now: the AI items say until when, and do nothing. */
    let spent: AISpent | null = null;
    /** Netflix's own check mark, copied onto the item we show. */
    let check: Element | null = null;

    const ensureOverlay = () => {
        if (!state.overlayEnabled) ui.toggleOverlay();
    };

    // The viewer's own pair, labelled and acted on as theirs: a pick of
    // another language for this title (its line picks) is not offered here,
    // and an item is checked only while the lines are theirs again.
    const items = (): Item[] => {
        const prefs = host.langPrefs();
        if (!prefs) return [];
        const now = host.pair() ?? prefs;
        const theirs = base(now.learning) === base(prefs.learning) && base(now.native) === base(prefs.native);
        const shipped = host.titleTracks();
        // Named as Netflix names them beside ours; the viewer's language, when
        // Netflix lacks it, in its own name.
        const nameOf = (code: string) =>
            shipped.find((t) => t.base === base(code))?.label ?? nativeForLanguage(code);
        const learning = nameOf(prefs.learning);
        const native = nameOf(prefs.native);
        const shown = state.overlayEnabled;
        const dual = state.displayMode === 'dual';
        if (shipped.some((t) => t.base === base(prefs.native))) {
            return [{
                label: `${learning} + ${native}`,
                ai: false,
                checked: theirs && shown && dual && !aiStop,
                pick: () => {
                    netflixPick = null;
                    aiStop?.();
                    host.showPair();
                    ui.setMode('dual');
                    ensureOverlay();
                    ui.refresh();
                },
            }];
        }
        // The viewer's language by AI: offered now, or one pick away while
        // another language is this title's second line.
        if (!(state.secondLineOnDemand || aiAllowed)) return [];
        return [
            {
                label: native,
                ai: true,
                checked: theirs && shown && !!aiStop && state.displayMode === 'single' && state.singleTrackName === aiName(prefs),
                pick: () => pickAi(true, native),
                spent,
            },
            {
                label: `${learning} + ${native}`,
                ai: true,
                checked: theirs && shown && !!aiStop && dual,
                pick: () => pickAi(false, `${learning} + ${native}`),
                spent,
            },
        ];
    };

    /** The AI translation's track, as the translator names it. */
    const aiName = (prefs: LanguagePrefs) => labelForLanguage(prefs.native) + AI_SUFFIX;

    // Shown as asked: alone, the translation is Single on it; paired, Dual.
    // The viewer's own pair first (a pick in Netflix's list, or another
    // second line, may stand for this title): the translation is into theirs.
    const showAi = (alone: boolean) => {
        const prefs = host.langPrefs();
        if (!prefs) return;
        netflixPick = null;
        host.showPair();
        state.setSingleTrack(alone ? aiName(prefs) : undefined);
        ui.setMode(alone ? 'single' : 'dual');
        ensureOverlay();
        ui.refresh();
    };

    // The offer stands only in Dual: Dual makes it, then it is taken, after
    // the one question unless the viewer said not to ask.
    const pickAi = (alone: boolean, label: string): void | 'stay' => {
        if (aiStop) return showAi(alone);
        // The viewer's own pair back, so the translation is wanted, then
        // Dual, which makes the offer.
        netflixPick = null;
        host.showPair();
        ui.setMode('dual');
        // A video translated before starts again on Dual, without an offer.
        if (aiStop) return showAi(alone);
        const start = aiStart;
        if (!start) return;
        // The offer may have been withdrawn or replaced while the question
        // was up: then nothing started, and nothing is shown as if it had.
        const go = () => {
            start();
            if (aiStop) showAi(alone);
            else render();
        };
        if (aiOff) return go();
        void confirmSkipped().then((skip) => {
            if (skip) return go();
            asking = { go, under: label };
            render();
        });
        return 'stay';
    };

    /** The block, built fresh; `ask` set, the question under the item that asked it. */
    function build(list: HTMLUListElement, ask: Ask | null): HTMLElement | null {
        // Without items (AI closed, its limit spent) the heading stays: the
        // link to any other pair is what is left to offer.
        if (!host.langPrefs()) return null;
        const all = items();
        const block = doc.createElement('div');
        block.className = BLOCK;
        block.setAttribute('role', 'group');
        block.setAttribute('aria-label', 'Lingogram');
        for (const type of PRESSES) block.addEventListener(type, (e) => e.stopPropagation());
        block.addEventListener('keydown', (e) => {
            if (PICK_KEYS.includes(e.key)) e.stopPropagation();
        });

        // Under our items, before the line: the way to any other pair.
        const head = doc.createElement('div');
        head.className = 'vtt-nf-head';
        const choose = doc.createElement('button');
        choose.type = 'button';
        choose.className = 'vtt-nf-choose';
        choose.textContent = `${msg('ytNfChoosePair', 'Choose another pair')} ›`;
        onPress(choose, 'choose', () => ui.openSettings('languages'));
        head.append(choose);

        const question = (go: () => void): HTMLElement => {
            const parts = buildConfirm(doc, 'vtt-nf-confirm', (yes) => {
                asking = null;
                if (yes) go();
                else render();
            });
            const box = doc.createElement('div');
            box.className = 'vtt-nf-confirm';
            box.setAttribute('role', 'group');
            box.setAttribute('aria-labelledby', parts.title.id);
            const row = doc.createElement('div');
            row.className = 'vtt-nf-confirm-row';
            const actions = doc.createElement('span');
            parts.yes.className = 'vtt-nf-yes';
            actions.append(parts.notNow, parts.yes);
            row.append(parts.dontAsk, actions);
            box.append(parts.title, parts.left, row);
            queueMicrotask(() => parts.yes.focus());
            return box;
        };

        const ours = doc.createElement('ul');
        ours.className = 'vtt-nf-list';
        ours.setAttribute('role', 'menu');
        // Copies of a plain Netflix item (its size and indent, whatever
        // classes carry them), check marks stripped; a checked one gets
        // Netflix's own mark, once.
        const plain = list.querySelector('li:not([data-uia*="selected"])') ?? list.querySelector('li');
        check ??= list.querySelector('svg:not(.vtt-nf-check)');
        for (const item of all) {
            ours.append(itemEl(item, plain));
            if (ask && item.label === ask.under) {
                const holder = doc.createElement('li');
                holder.setAttribute('role', 'none');
                holder.append(question(ask.go));
                ours.append(holder);
            }
        }
        // On the Subtitles heading's line, at its right: the sidebar's
        // settings, as they are. Kept in the block, placed on that line once
        // the block is in (see fitToNetflix): Netflix's heading is left alone.
        const options = doc.createElement('button');
        options.type = 'button';
        options.className = 'vtt-nf-options';
        const optionsText = doc.createElement('span');
        optionsText.textContent = msg('ytNfOptions', 'Options');
        options.append(optionsText);
        onPress(options, 'options', () => ui.openSettings());
        block.append(ours, head, options);
        // The heading and the question scale with Netflix's item text and
        // start where its words start.
        const words = labelOf(plain);
        const size = words ? getComputedStyle(words).fontSize : '';
        if (parseFloat(size) > 0) block.style.setProperty('--vtt-nf-size', size);
        if (words && plain) {
            const indent = words.getBoundingClientRect().left - plain.getBoundingClientRect().left;
            if (indent > 0) block.style.setProperty('--vtt-nf-indent', `${Math.round(indent)}px`);
        }
        return block;
    }

    // A press is a pointerdown and a pointerup on the control of the same
    // name: Netflix re-renders the column on mousedown, so the element under
    // the pointer is a fresh copy by mouseup and the browser sends no click
    // at all. A click with no pointer behind it (keyboard, assistive tech, a
    // script) still counts.
    function onPress(el: Element, name: string, act: () => void): void {
        el.addEventListener('pointerdown', () => {
            pressed = name;
        });
        el.addEventListener('pointerup', () => {
            if (pressed !== name) return;
            pressed = null;
            act();
        });
        el.addEventListener('click', (e) => {
            if ((e as MouseEvent).detail === 0) act();
        });
    }

    function itemEl(item: Item, proto: Element | null): HTMLLIElement {
        const li = (proto?.cloneNode(true) as HTMLLIElement | undefined) ?? doc.createElement('li');
        for (const svg of li.querySelectorAll('svg')) svg.remove();
        li.classList.remove('vtt-nf-shown');
        for (const el of [li, ...li.querySelectorAll('*')]) {
            el.removeAttribute('data-uia');
            el.removeAttribute('id');
        }
        li.classList.add('vtt-nf-item');
        li.setAttribute('role', 'menuitemradio');
        li.setAttribute('aria-checked', String(item.checked));
        li.tabIndex = 0;
        if (item.ai) li.title = costTitle();
        const label = labelOf(li) ?? li;
        label.textContent = item.label;
        if (item.ai) {
            const chip = doc.createElement('span');
            chip.className = 'vtt-nf-ai';
            chip.textContent = 'AI';
            label.append(chip);
        }
        if (item.checked && check) {
            const mark = check.cloneNode(true) as Element;
            mark.removeAttribute('data-uia');
            (li.firstElementChild ?? li).prepend(mark);
        }
        if (item.spent) {
            // Greyed, "after 02:00", the reason on hover; a press does nothing.
            const note = doc.createElement('span');
            note.className = 'vtt-nf-after';
            note.textContent = msg('ytAiAfter', 'after $1', [item.spent.until]);
            label.append(note);
            li.classList.add('vtt-nf-spent');
            li.setAttribute('aria-disabled', 'true');
            li.title = item.spent.text;
            return li;
        }
        const pick = () => {
            if (item.pick() !== 'stay') render();
        };
        onPress(li, item.label, pick);
        li.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            pick();
        });
        return li;
    }

    /**
     * Puts the block (back) on top of the Subtitles column of the open panel,
     * with the question if one is up. `whileAsking`: also rebuilt then (the
     * question is rebuilt with it and takes the focus again).
     */
    function render(whileAsking = true): void {
        if (dead) return;
        const panel = doc.querySelector<HTMLElement>(PANEL);
        if (!panel) return;
        watch(panel);
        const list = subtitleList(panel);
        if (!list?.parentElement) return;
        const old = panel.querySelector(`.${BLOCK}`);
        if (asking && !whileAsking && old) return;
        old?.remove();
        const block = build(list, asking);
        if (block) {
            list.parentElement.insertBefore(block, list);
            fitToNetflix(block, list);
        }
        check ??= list.querySelector('svg:not(.vtt-nf-check)');
        markNetflix(panel, list);
        clearOfSidebar(panel);
    }

    // Taken from Netflix's own column, as it is drawn at this size:
    // - our line under the block is Netflix's line before its other
    //   languages (its inset, its colour), when the list has one;
    // - Options sits on the Subtitles heading's baseline, its right edge
    //   where that line ends: its box gets the heading's font size, line
    //   height and top padding, so its small words land on the same line.
    function fitToNetflix(block: HTMLElement, list: Element): void {
        const rule = [...list.children].find((c) => c.tagName !== 'LI' && parseFloat(getComputedStyle(c).borderTopWidth) > 0);
        if (rule) {
            const cs = getComputedStyle(rule);
            block.style.setProperty('--vtt-nf-rule-x', cs.marginLeft);
            block.style.setProperty('--vtt-nf-rule-y', cs.marginTop);
            block.style.setProperty('--vtt-nf-rule-color', cs.borderTopColor);
        }
        const title = block.previousElementSibling;
        if (!title) return;
        const cs = getComputedStyle(title);
        block.style.setProperty('--vtt-nf-title-top', `${title.getBoundingClientRect().top - block.getBoundingClientRect().top}px`);
        block.style.setProperty('--vtt-nf-title-size', cs.fontSize);
        block.style.setProperty('--vtt-nf-title-line', cs.lineHeight);
        block.style.setProperty('--vtt-nf-title-pad', cs.paddingTop);
    }

    // With the sidebar open the player is narrower, but Netflix places the
    // panel as if it were not: the panel's right part (our link with it) was
    // cut off at the player's edge. The box around the panel is moved left by
    // the overlap, for as long as it is open. Not the panel itself: that box
    // clips it, and the panel's left part was cut off instead. Netflix places
    // the panel again once our block widens it, and the sidebar may open or
    // close: this runs again on each (see watch), from where Netflix put it.
    function clearOfSidebar(panel: HTMLElement): void {
        const box = panel.parentElement;
        const player = panel.closest('[data-uia="watch-video"]');
        if (!box || !player) return;
        const shift = parseFloat(box.style.translate) || 0;
        const edge = player.getBoundingClientRect();
        const r = box.getBoundingClientRect();
        const right = r.right - shift;
        const want = right <= edge.right ? 0 : -Math.round(Math.max(0, Math.min(right - edge.right + 8, r.left - shift - edge.left)));
        if (want !== shift) box.style.translate = want ? `${want}px 0` : '';
    }

    // Netflix re-renders the panel on a pick, and may drop what it did not
    // render; put the block back when it goes, and note when the panel goes.
    function watch(panel: HTMLElement): void {
        if (watched === panel) return;
        unwatch?.();
        watched = panel;
        // A question left up in a panel that closed does not carry over.
        asking = null;
        doc.documentElement.classList.add(OPEN_CLASS);
        const player = panel.closest('[data-uia="watch-video"]');
        const closed = () => {
            unwatch?.();
            unwatch = null;
            watched = null;
            asking = null;
            doc.documentElement.classList.remove(OPEN_CLASS);
        };
        panelObserver = new MutationObserver((records) => {
            if (!panel.isConnected) return closed();
            if (!panel.querySelector(`.${BLOCK}`)) return render();
            // Our own writes (the block, the copied check marks) are not news.
            if (records.every((r) => [...r.addedNodes, ...r.removedNodes].every(ours))) return;
            // Netflix re-rendered its list: put our marks back.
            const list = subtitleList(panel);
            if (list) markNetflix(panel, list);
        });
        // The panel's own subtree, for Netflix's re-renders; each box around
        // it up to the player, for its leaving (the box that goes may be any
        // of them). Not the player's whole subtree: every caption on screen
        // changes it.
        panelObserver.observe(panel, { childList: true, subtree: true });
        for (let up = panel.parentElement; up; up = up.parentElement) {
            panelObserver.observe(up, { childList: true });
            if (up === player || up === doc.body) break;
        }
        // Netflix places the panel by a style on the box around ours, again
        // once our block widens it; the player narrows and widens with the
        // sidebar.
        const place = () => clearOfSidebar(panel);
        const placed = new MutationObserver(place);
        const holder = panel.parentElement?.parentElement;
        if (holder) placed.observe(holder, { attributes: true, attributeFilter: ['style'] });
        const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
        sized?.observe(panel);
        if (player) sized?.observe(player);

        // Netflix's own items, taken over when we can show their language (or
        // they are its Off): the press never reaches Netflix, and is counted
        // on pointerup by the item's words, as ours are (Netflix re-renders
        // the list on mousedown). Others stay Netflix's.
        let down: string | null = null;
        const takenItem = (e: Event): { li: Element; off: boolean; words: string } | null => {
            if (!host.langPrefs()) return null;
            const li = (e.target as Element | null)?.closest('li');
            const list = subtitleList(panel);
            if (!li || !list || li.parentElement !== list) return null;
            const off = li === list.querySelector(':scope > li');
            const words = li.textContent?.trim() ?? '';
            return off || trackFor(words) ? { li, off, words } : null;
        };
        const take = (e: Event) => {
            const item = takenItem(e);
            if (!item) return;
            e.stopPropagation();
            e.preventDefault();
            if (e.type === 'pointerdown') down = item.words;
            const press = (e.type === 'pointerup' && down === item.words) || (e.type === 'click' && (e as MouseEvent).detail === 0);
            if (!press) return;
            down = null;
            pickNetflix(item.off ? null : item.words);
        };
        const key = (e: Event) => {
            if (!PICK_KEYS.includes((e as KeyboardEvent).key)) return;
            const item = takenItem(e);
            if (!item) return;
            e.stopPropagation();
            e.preventDefault();
            pickNetflix(item.off ? null : item.words);
        };
        for (const type of PRESSES) panel.addEventListener(type, take, true);
        panel.addEventListener('keydown', key, true);
        unwatch = () => {
            panelObserver?.disconnect();
            panelObserver = null;
            placed.disconnect();
            sized?.disconnect();
            for (const type of PRESSES) panel.removeEventListener(type, take, true);
            panel.removeEventListener('keydown', key, true);
        };
    }

    /** A Netflix item: its language alone, by us; null is its Off, our lines off. */
    function pickNetflix(words: string | null): void {
        if (words === null) {
            netflixPick = null;
            if (state.overlayEnabled) ui.toggleOverlay();
            return render();
        }
        const track = trackFor(words);
        if (!track) return;
        netflixPick = words;
        state.setSingleTrack(undefined);
        host.showTrack(track.base);
        ui.setMode('single');
        ensureOverlay();
        ui.refresh();
        render();
    }

    /** The title's track behind a Netflix item's words ("English (CC)", "Polish"). */
    function trackFor(words: string): { base: string; label: string } | undefined {
        const name = words.replace(/\s*\[?\(?CC\)?\]?$/i, '').trim().toLowerCase();
        const tracks = host.titleTracks();
        return tracks.find((t) => t.label.toLowerCase() === words.toLowerCase())
            ?? tracks.find((t) => t.label.toLowerCase().replace(/\s*\[?\(?cc\)?\]?$/, '').trim() === name);
    }

    /** Netflix's check marks show what we show: Off when our lines are off, the item we show alone. */
    function markNetflix(panel: Element, list: HTMLUListElement): void {
        list.classList.add('vtt-nf-sublist');
        const items = [...list.querySelectorAll(':scope > li')];
        const words = (li: Element) => li.textContent?.trim() ?? '';
        // One line of a site track (not the AI translation): the item of its
        // language, the one picked last if it is of that language (a pick
        // since made in the sidebar, or a new title, leaves it behind).
        const alone = () => {
            const main = state.tracks[state.activeTrackIndex];
            const code = main && !main.name.endsWith(AI_SUFFIX) ? trackLanguageCode(main.name) : null;
            if (!code) return undefined;
            const of = items.slice(1).filter((li) => trackFor(words(li))?.base === code);
            return of.find((li) => words(li) === netflixPick) ?? of[0];
        };
        const shown = !state.overlayEnabled
            ? items[0]
            : state.displayMode === 'single' ? alone() : undefined;
        for (const li of items) {
            const on = li === shown;
            if (li.classList.contains('vtt-nf-shown') !== on) li.classList.toggle('vtt-nf-shown', on);
            const mark = li.querySelector('.vtt-nf-check');
            if (on && !mark && check) {
                const copy = check.cloneNode(true) as Element;
                copy.classList.add('vtt-nf-check');
                copy.removeAttribute('data-uia');
                (li.firstElementChild ?? li).prepend(copy);
            } else if (!on) mark?.remove();
        }
    }

    // The panel opens from its button: look for it for a few frames after a
    // press or a hover there, instead of watching the whole page. Netflix
    // waits a moment on a hover before it opens the panel.
    let frames = 0;
    const poll = () => {
        const panel = doc.querySelector(PANEL);
        if (panel) {
            frames = 0;
            // Already there (the button hovered again): the block stands,
            // and a question up in it stays up.
            if (panel.querySelector(`.${BLOCK}`)) return;
            return render();
        }
        if (--frames > 0) requestAnimationFrame(poll);
    };
    const onOpener = (e: Event) => {
        if (isContextOrphaned()) return destroy();
        const target = e.target as Element | null;
        // The panel matches the openers' selector too ("selector-audio-subtitle"):
        // what happens inside it is watch()'s, not an opening.
        if (!target?.closest?.(OPENERS) || target.closest(PANEL)) return;
        const idle = frames <= 0;
        frames = 90;
        if (idle) requestAnimationFrame(poll);
    };
    const OPEN_EVENTS = ['pointerover', 'click', 'focusin', 'keydown'] as const;
    for (const type of OPEN_EVENTS) doc.addEventListener(type, onOpener, true);

    const unspent = watchSpent((now) => {
        spent = now;
        if (watched?.isConnected) render(false);
    });
    const unsubscribe = state.subscribe((e) => {
        if (e.type === 'reset') netflixPick = null;
        if (watched?.isConnected) render(false);
    });

    function destroy(): void {
        // A poll already queued must not build the block again.
        dead = true;
        for (const type of OPEN_EVENTS) doc.removeEventListener(type, onOpener, true);
        unwatch?.();
        unwatch = null;
        doc.documentElement.classList.remove(OPEN_CLASS);
        unsubscribe();
        unspent();
        doc.querySelector(`.${BLOCK}`)?.remove();
    }

    return {
        offer(start, off) {
            aiStart = start;
            aiOff = off;
            // The offer withdrawn: the question asked for it goes too.
            if (!start) asking = null;
            if (watched?.isConnected) render(false);
        },
        stop(stop) {
            aiStop = stop;
            if (watched?.isConnected) render(false);
        },
        allowed(on) {
            aiAllowed = on;
            if (watched?.isConnected) render(false);
        },
        destroy,
    };
}
