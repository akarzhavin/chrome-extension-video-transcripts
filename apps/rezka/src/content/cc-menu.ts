// HDrezka's CC button opens our menu instead of the player's: one line or
// two, from the tracks the page loaded, plus the AI translation of the second
// line when the site has none in the viewer's language. The player's own
// subtitles stay off; every choice here drives the on-screen overlay.
//
// The player (Playerjs) builds its controls from unnamed <pjsdiv>s; the CC
// button is the one place with a stable id, `<player>_control_cc_bg`. Until a
// track has loaded the player's own menu still opens, so the "load them by
// hand" steps of the no-subtitles notice keep working.

import type { AppState } from '../../../../packages/shared/src/AppState';
import type { SidebarUI } from '../../../../packages/shared/src/SidebarUI';
import { msg } from '../../../../packages/shared/src/i18n';
import { labelForLanguage, nativeForLanguage, type LanguagePrefs } from '../../../../packages/shared/src/languages';
import type { AiControls } from '../../../../packages/shared/src/subtitle-ai/browser';
import { buildConfirm, confirmSkipped } from '../../../../packages/shared/src/subtitle-ai/confirm';
import { AI_SUFFIX } from '../../../../packages/shared/src/subtitle-ai/controller';
import { trackLabel } from '../../../../packages/shared/src/track-label';

export { trackLabel };

export interface CcMenuHost {
    state: AppState;
    ui: Pick<SidebarUI, 'setMode' | 'toggleOverlay' | 'openSettings' | 'refresh'>;
    langPrefs(): LanguagePrefs | null;
}

const CC_BG = '[id$="_control_cc_bg"]';
const SWALLOWED = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'click'] as const;

/** The language word every track name starts with ("English — …", "Russian 2"). */
function languageOf(name: string): string {
    return name.split(' — ')[0].replace(/ \d+$/, '');
}

interface Item {
    label: string;
    ai?: boolean;
    checked: boolean;
    title?: string;
    /** 'stay': the menu stays open, for the question it is about to ask. */
    pick(): void | 'stay';
}

export function installCcMenu(host: CcMenuHost, doc: Document = document): AiControls & { destroy(): void } {
    const { state, ui } = host;
    let aiStart: (() => void) | null = null;
    let aiOff = false;
    let aiStop: (() => void) | null = null;
    let menu: HTMLElement | null = null;
    let page: 'list' | 'confirm' = 'list';
    let button: HTMLElement | null = null;
    const bound = new WeakSet<Element>();

    const ownTracks = () =>
        state.tracks.map((t, i) => ({ t, i })).filter(({ t }) => !t.name.endsWith(AI_SUFFIX));

    /** The first line: the one showing, else the language being learned, else the first. */
    const mainIndex = (): number => {
        const own = ownTracks();
        if (own.some(({ i }) => i === state.activeTrackIndex)) return state.activeTrackIndex;
        const learning = host.langPrefs()?.learning;
        const word = learning ? labelForLanguage(learning) : '';
        return own.find(({ t }) => word && languageOf(t.name) === word)?.i ?? own[0]?.i ?? -1;
    };

    const ensureOverlay = () => {
        if (!state.overlayEnabled) ui.toggleOverlay();
    };
    // Any other choice ends a running translation, as the sidebar's "on" does.
    const stopAi = () => aiStop?.();

    const items = (): Item[][] => {
        const own = ownTracks();
        const main = mainIndex();
        const shown = state.overlayEnabled;
        const dual = state.displayMode === 'dual';
        const singles: Item[] = own.map(({ t, i }) => ({
            label: trackLabel(t.name),
            checked: shown && !dual && state.activeTrackIndex === i,
            pick: () => {
                stopAi();
                state.activeTrackIndex = i;
                ui.setMode('single');
                ensureOverlay();
                ui.refresh();
            },
        }));
        const mainTrack = state.tracks[main];
        const pairs: Item[] = [];
        if (mainTrack) {
            const head = trackLabel(mainTrack.name);
            for (const { t, i } of own) {
                if (i === main || languageOf(t.name) === languageOf(mainTrack.name)) continue;
                pairs.push({
                    label: `${head} + ${trackLabel(t.name)}`,
                    checked: shown && dual && !aiStop && state.secondaryTrackIndex === i,
                    pick: () => {
                        stopAi();
                        state.activeTrackIndex = main;
                        state.secondaryTrackIndex = i;
                        ui.setMode('dual');
                        ensureOverlay();
                        ui.refresh();
                    },
                });
            }
            const native = host.langPrefs()?.native;
            if (native && state.secondLineOnDemand) {
                pairs.push({
                    label: `${head} + ${nativeForLanguage(native)}`,
                    ai: true,
                    checked: shown && dual && !!aiStop,
                    title: capitalize(msg('ytAiOfferCost', 'uses AI credits')),
                    pick: () => pickAi(main),
                });
            }
        }
        // Dual with nothing to put second shows one line: that line is the
        // checked one, not nothing.
        const at = own.findIndex(({ i }) => i === state.activeTrackIndex);
        if (shown && dual && at !== -1 && !pairs.some((p) => p.checked)) singles[at].checked = true;
        const off: Item = {
            label: msg('rzCcOff', 'Off'),
            checked: !shown,
            pick: () => {
                stopAi();
                if (state.overlayEnabled) ui.toggleOverlay();
            },
        };
        return [singles, pairs, [off]].filter((g) => g.length);
    };

    // The AI pair: Dual on the first line makes the offer, then the offer is
    // taken, after the one question unless the viewer said not to ask.
    const pickAi = (main: number): void | 'stay' => {
        if (aiStop) {
            ui.setMode('dual');
            ensureOverlay();
            return;
        }
        state.activeTrackIndex = main;
        ui.setMode('dual');
        ensureOverlay();
        ui.refresh();
        const start = aiStart;
        if (!start) return;
        if (aiOff) return start();
        void confirmSkipped().then((skip) => {
            if (skip) {
                start();
                close();
            } else {
                page = 'confirm';
                render();
            }
        });
        return 'stay';
    };

    const render = () => {
        if (!menu) return;
        menu.replaceChildren();
        if (page === 'confirm') return renderConfirm(menu);
        const head = doc.createElement('div');
        head.className = 'vtt-cc-head';
        const title = doc.createElement('span');
        title.textContent = msg('ytSidebarTitle', 'Subtitles');
        const settings = doc.createElement('button');
        settings.type = 'button';
        settings.className = 'vtt-cc-settings';
        settings.textContent = `${msg('ytSettingsTitle', 'Settings')} ›`;
        settings.addEventListener('click', () => {
            close();
            ui.openSettings();
        });
        head.append(title, settings);
        menu.append(head);
        items().forEach((group, n) => {
            if (n > 0) {
                const sep = doc.createElement('div');
                sep.className = 'vtt-cc-sep';
                sep.setAttribute('role', 'separator');
                menu!.append(sep);
            }
            for (const item of group) menu!.append(itemButton(item));
        });
    };

    const itemButton = (item: Item): HTMLButtonElement => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'vtt-cc-item';
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', String(item.checked));
        if (item.title) b.title = item.title;
        const label = doc.createElement('span');
        label.textContent = item.label;
        b.append(label);
        if (item.ai) b.append(aiChip());
        b.addEventListener('click', () => {
            if (item.pick() !== 'stay') close();
        });
        return b;
    };

    const aiChip = () => {
        const chip = doc.createElement('span');
        chip.className = 'vtt-cc-ai';
        chip.textContent = 'AI';
        return chip;
    };

    const renderConfirm = (box: HTMLElement) => {
        const back = doc.createElement('button');
        back.type = 'button';
        back.className = 'vtt-cc-head vtt-cc-back';
        const main = state.tracks[mainIndex()];
        const native = host.langPrefs()?.native ?? '';
        const label = doc.createElement('span');
        label.textContent = `‹ ${main ? trackLabel(main.name) : ''} + ${nativeForLanguage(native)}`;
        back.append(label, aiChip());
        back.addEventListener('click', () => {
            page = 'list';
            render();
        });
        const parts = buildConfirm(doc, 'vtt-cc-confirm', (yes) => {
            if (yes) {
                aiStart?.();
                close();
            } else {
                page = 'list';
                render();
            }
        });
        const body = doc.createElement('div');
        body.className = 'vtt-cc-confirm';
        body.setAttribute('role', 'group');
        body.setAttribute('aria-labelledby', parts.title.id);
        const actions = doc.createElement('div');
        actions.className = 'vtt-cc-actions';
        parts.yes.className = 'vtt-cc-yes';
        actions.append(parts.notNow, parts.yes);
        body.append(parts.title, parts.left, parts.dontAsk, actions);
        box.append(back, body);
        parts.yes.focus();
    };

    const onOutside = (e: Event) => {
        const t = e.target as Node | null;
        if (t && (menu?.contains(t) || button?.contains(t))) return;
        close();
    };
    const onKey = (e: KeyboardEvent) => {
        if (!menu) return;
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const all = [...menu.querySelectorAll<HTMLElement>('button')];
        const at = all.indexOf(doc.activeElement as HTMLElement);
        const next = all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
        next?.focus();
        e.preventDefault();
    };

    const open = () => {
        if (!button) return;
        const root = playerRoot(button);
        menu = doc.createElement('div');
        menu.className = 'vtt-cc-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', msg('ytSidebarTitle', 'Subtitles'));
        page = 'list';
        // Above the CC button, its right edge under the button's.
        const r = root.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        menu.style.right = `${Math.max(8, Math.round(r.right - b.right - 12))}px`;
        menu.style.bottom = `${Math.max(8, Math.round(r.bottom - b.top + 8))}px`;
        root.appendChild(menu);
        render();
        doc.addEventListener('pointerdown', onOutside, true);
        doc.addEventListener('keydown', onKey, true);
        (menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>('.vtt-cc-item'))?.focus();
    };

    function close(): void {
        if (!menu) return;
        menu.remove();
        menu = null;
        page = 'list';
        doc.removeEventListener('pointerdown', onOutside, true);
        doc.removeEventListener('keydown', onKey, true);
    }

    // Until a track loads there is nothing of ours to pick: the player's menu
    // opens as before.
    const swallow = (e: Event) => {
        if (!ownTracks().length) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.type !== 'click') return;
        if (menu) close();
        else open();
    };

    const bind = () => {
        const bg = doc.querySelector(CC_BG);
        const holder = bg?.parentElement?.parentElement;
        if (!holder || bound.has(holder)) return;
        if (button && button !== holder) close();
        bound.add(holder);
        button = holder;
        for (const type of SWALLOWED) holder.addEventListener(type, swallow, true);
    };
    // The player rebuilds its controls on a new translator or episode.
    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            bind();
        });
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    bind();

    const unsubscribe = state.subscribe(() => {
        if (menu && page === 'list') render();
    });

    return {
        offer(start, off) {
            aiStart = start;
            aiOff = off;
            if (menu && page === 'list') render();
            // Withdrawn while the question is up: nothing left to confirm.
            if (!start && page === 'confirm') close();
        },
        stop(stop) {
            aiStop = stop;
            if (menu && page === 'list') render();
        },
        destroy() {
            close();
            observer.disconnect();
            unsubscribe();
        },
    };
}

/** The player's box: the menu goes inside it, so it stays on screen in fullscreen. */
function playerRoot(button: HTMLElement): HTMLElement {
    let el: HTMLElement | null = button;
    let best: HTMLElement = button.ownerDocument.body;
    while (el && el !== el.ownerDocument.body) {
        if (el.id.startsWith('oframe')) return el;
        if (el.tagName === 'PJSDIV' && getComputedStyle(el).position !== 'static' && el.offsetWidth > 200) best = el;
        el = el.parentElement;
    }
    return best;
}

function capitalize(s: string): string {
    return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}
