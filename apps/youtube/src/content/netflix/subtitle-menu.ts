// Netflix's audio & subtitles panel gets a small block of ours on top of its
// Subtitles column: only what this viewer needs, from the two languages they
// chose. The site has their language → the one pair. It has not → their
// language alone and the pair, both by AI. Plus a quiet link to the sidebar's
// language settings for any other pair. Netflix's own items stay as they are;
// picking one of them turns our on-screen lines off so its choice stands
// (while ours are on, the app keeps Netflix's own subtitles off).
//
// Netflix renders the panel with React and tags its parts with data-uia
// attributes (its test hooks, stable across releases). Our items copy the
// classes of Netflix's own so they read as part of the list; clones carry no
// React handlers, and our clicks stop at the block.

import type { AppState } from '../../../../../packages/shared/src/AppState';
import type { SidebarUI } from '../../../../../packages/shared/src/SidebarUI';
import { isContextOrphaned } from '../../../../../packages/shared/src/content/orphan-notice';
import { msg } from '../../../../../packages/shared/src/i18n';
import { nativeForLanguage, type LanguagePrefs } from '../../../../../packages/shared/src/languages';
import type { AiControls } from '../../../../../packages/shared/src/subtitle-ai/browser';
import { buildConfirm, confirmSkipped, costTitle } from '../../../../../packages/shared/src/subtitle-ai/confirm';

export interface NetflixMenuHost {
    state: AppState;
    ui: Pick<SidebarUI, 'setMode' | 'toggleOverlay' | 'openSettings' | 'refresh'>;
    langPrefs(): LanguagePrefs | null;
    /** The subtitle tracks this title ships: base code and Netflix's own name for it. */
    titleTracks(): { base: string; label: string }[];
    /** Put the viewer's own pair back on the two lines (the sidebar picker may have changed them). */
    showPair(): void;
}

const PANEL = '[data-uia="selector-audio-subtitle"]';
const OPENERS = '[data-uia*="audio-subtitle"]';
const BLOCK = 'vtt-nf-block';
// Presses that reach the panel around the block: Netflix would act on them.
const KEPT_IN_BLOCK = ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown'] as const;

const base = (code: string) => code.split(/[-_]/)[0].toLowerCase();

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

interface Item {
    label: string;
    ai: boolean;
    checked: boolean;
    pick(): void | 'stay';
}

export function installNetflixMenu(host: NetflixMenuHost, doc: Document = document): AiControls & { destroy(): void } {
    const { state, ui } = host;
    let aiStart: (() => void) | null = null;
    let aiOff = false;
    let aiStop: (() => void) | null = null;
    let confirming: boolean = false;
    let watched: Element | null = null;
    let panelObserver: MutationObserver | null = null;

    const ensureOverlay = () => {
        if (!state.overlayEnabled) ui.toggleOverlay();
    };

    const items = (): Item[] => {
        const prefs = host.langPrefs();
        if (!prefs) return [];
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
                checked: shown && dual && !aiStop,
                pick: () => {
                    aiStop?.();
                    host.showPair();
                    ui.setMode('dual');
                    ensureOverlay();
                    ui.refresh();
                },
            }];
        }
        if (!state.secondLineOnDemand || !state.secondLineLanguage) return [];
        return [
            {
                label: native,
                ai: true,
                checked: shown && !!aiStop && state.aiAlone && state.displayMode === 'single',
                pick: () => pickAi(true),
            },
            {
                label: `${learning} + ${native}`,
                ai: true,
                checked: shown && !!aiStop && dual,
                pick: () => pickAi(false),
            },
        ];
    };

    // Shown as asked: alone, the translation is Single on it; paired, Dual.
    const showAi = (alone: boolean) => {
        state.aiAlone = alone;
        ui.setMode(alone ? 'single' : 'dual');
        state.applyPreferences();
        ensureOverlay();
        ui.refresh();
    };

    // The offer stands only in Dual: Dual makes it, then it is taken, after
    // the one question unless the viewer said not to ask.
    const pickAi = (alone: boolean): void | 'stay' => {
        if (aiStop) return showAi(alone);
        ui.setMode('dual');
        const start = aiStart;
        if (!start) return;
        const go = () => {
            start();
            showAi(alone);
        };
        if (aiOff) return go();
        void confirmSkipped().then((skip) => {
            if (skip) return go();
            confirming = true;
            render(go);
        });
        return 'stay';
    };

    /** The block, built fresh; `go` set, the question in place of the items. */
    function build(list: HTMLUListElement, go?: () => void): HTMLElement | null {
        const all = items();
        if (!all.length && !go) return null;
        const block = doc.createElement('div');
        block.className = BLOCK;
        block.setAttribute('role', 'group');
        block.setAttribute('aria-label', 'Lingogram');
        for (const type of KEPT_IN_BLOCK) block.addEventListener(type, (e) => e.stopPropagation());

        const head = doc.createElement('div');
        head.className = 'vtt-nf-head';
        const name = doc.createElement('span');
        name.textContent = 'Lingogram';
        const choose = doc.createElement('button');
        choose.type = 'button';
        choose.className = 'vtt-nf-choose';
        choose.textContent = `${msg('ytNfChoosePair', 'Choose another pair')} ›`;
        choose.addEventListener('click', () => ui.openSettings());
        head.append(name, choose);
        block.append(head);

        if (go) {
            const parts = buildConfirm(doc, 'vtt-nf-confirm', (yes) => {
                confirming = false;
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
            block.append(box);
            return block;
        }

        const ours = doc.createElement('ul');
        ours.className = 'vtt-nf-list';
        ours.setAttribute('role', 'menu');
        // Copies of Netflix's own items, the selected one for a checked item:
        // its size, indent and check mark, whatever classes carry them.
        const plain = list.querySelector('li:not([data-uia*="selected"])') ?? list.querySelector('li');
        const selected = list.querySelector('li[data-uia*="selected"]') ?? plain;
        for (const item of all) ours.append(itemEl(item, item.checked ? selected : plain));
        block.append(ours);
        // The heading and the question scale with Netflix's item text.
        const size = labelOf(plain)?.ownerDocument.defaultView?.getComputedStyle(labelOf(plain)!).fontSize;
        if (size && parseFloat(size) > 0) block.style.setProperty('--vtt-nf-size', size);
        return block;
    }

    function itemEl(item: Item, proto: Element | null): HTMLLIElement {
        const li = (proto?.cloneNode(true) as HTMLLIElement | undefined) ?? doc.createElement('li');
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
        const pick = () => {
            if (item.pick() !== 'stay') render();
        };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            pick();
        });
        return li;
    }

    /** Puts the block (back) on top of the Subtitles column of the open panel. */
    function render(go?: () => void): void {
        const panel = doc.querySelector(PANEL);
        if (!panel) return;
        watch(panel);
        const list = subtitleList(panel);
        if (!list?.parentElement) return;
        if (confirming && !go) return;
        panel.querySelector(`.${BLOCK}`)?.remove();
        const block = build(list, go);
        if (block) list.parentElement.insertBefore(block, list);
    }

    // Netflix re-renders the panel on a pick, and may drop what it did not
    // render; put the block back when it goes. One observer, on the panel only.
    function watch(panel: Element): void {
        if (watched === panel) return;
        panelObserver?.disconnect();
        watched = panel;
        panelObserver = new MutationObserver(() => {
            if (!panel.isConnected) {
                panelObserver?.disconnect();
                watched = null;
                confirming = false;
                return;
            }
            if (!panel.querySelector(`.${BLOCK}`)) render();
        });
        panelObserver.observe(panel, { childList: true, subtree: true });
        // A pick among Netflix's own subtitles (other than Off) hands the
        // screen back to Netflix: our lines go, its own come.
        panel.addEventListener('click', (e) => {
            const li = (e.target as Element | null)?.closest('li');
            const list = subtitleList(panel);
            if (!li || !list || li.parentElement !== list) return;
            if (li === list.querySelector('li')) return; // Off
            state.aiAlone = false;
            if (state.overlayEnabled) ui.toggleOverlay();
        }, true);
    }

    // The panel opens from its button: look for it for a few frames after a
    // press or a hover there, instead of watching the whole page.
    let frames = 0;
    const poll = () => {
        if (doc.querySelector(PANEL)) return render();
        if (--frames > 0) requestAnimationFrame(poll);
    };
    const onOpener = (e: Event) => {
        if (isContextOrphaned()) return destroy();
        if (!(e.target as Element | null)?.closest?.(OPENERS)) return;
        const idle = frames <= 0;
        frames = 30;
        if (idle) requestAnimationFrame(poll);
    };
    const OPEN_EVENTS = ['pointerover', 'click', 'focusin', 'keydown'] as const;
    for (const type of OPEN_EVENTS) doc.addEventListener(type, onOpener, true);

    const unsubscribe = state.subscribe(() => {
        if (watched?.isConnected && !confirming) render();
    });

    function destroy(): void {
        for (const type of OPEN_EVENTS) doc.removeEventListener(type, onOpener, true);
        panelObserver?.disconnect();
        unsubscribe();
        doc.querySelector(`.${BLOCK}`)?.remove();
    }

    return {
        offer(start, off) {
            aiStart = start;
            aiOff = off;
            if (!start) confirming = false;
            if (watched?.isConnected && !confirming) render();
        },
        stop(stop) {
            aiStop = stop;
            if (watched?.isConnected && !confirming) render();
        },
        destroy,
    };
}
