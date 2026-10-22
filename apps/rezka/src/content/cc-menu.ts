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
import { watchSpent, type AISpent } from '../../../../packages/shared/src/ai-balance/spent';
import type { SidebarUI } from '../../../../packages/shared/src/SidebarUI';
import { isContextOrphaned } from '../../../../packages/shared/src/content/orphan-notice';
import { msg } from '../../../../packages/shared/src/i18n';
import { labelForLanguage, nativeForLanguage, type LanguagePrefs } from '../../../../packages/shared/src/languages';
import type { AiControls } from '../../../../packages/shared/src/subtitle-ai/browser';
import { buildConfirm, confirmSkipped, costTitle, dismissOn } from '../../../../packages/shared/src/subtitle-ai/confirm';
import { AI_SUFFIX } from '../../../../packages/shared/src/subtitle-ai/controller';
import { trackLabel } from '../../../../packages/shared/src/track-label';

export { trackLabel };

export interface CcMenuHost {
    state: AppState;
    ui: Pick<SidebarUI, 'setMode' | 'toggleOverlay' | 'openSettings' | 'refresh'>;
    langPrefs(): LanguagePrefs | null;
}

const SWALLOWED = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'click'] as const;
// Inside our menu nothing reaches the player around it: a click or a space
// there would pause the video or hide its controls.
const KEPT_IN_MENU = [...SWALLOWED, 'dblclick', 'keydown', 'keyup', 'wheel'] as const;

/** The CC button an event landed on: the box holding `<player>_control_cc_bg` two levels down. */
function ccButtonOf(target: EventTarget | null): HTMLElement | null {
    let el = target instanceof Element ? target : null;
    for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
        if (el.querySelector(':scope > * > [id$="_control_cc_bg"]')) return el as HTMLElement;
    }
    return null;
}

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
    /** Not pressable now, and why: the AI credits spent until a reset. */
    spent?: AISpent | null;
}

export function installCcMenu(host: CcMenuHost, doc: Document = document): AiControls & { destroy(): void } {
    const { state, ui } = host;
    let aiStart: (() => void) | null = null;
    let aiOff = false;
    let aiStop: (() => void) | null = null;
    let menu: HTMLElement | null = null;
    let page: 'list' | 'confirm' = 'list';
    let button: HTMLElement | null = null;
    let undismiss = () => {};

    const ownTracks = () =>
        state.tracks.map((t, i) => ({ t, i })).filter(({ t }) => !t.name.endsWith(AI_SUFFIX));
    /** Where a track is now: stopping the AI translation drops its track and shifts the rest. */
    const indexOf = (name: string) => state.tracks.findIndex((t) => t.name === name);

    /** The track of the language being learned, which the AI translation translates. */
    const learningIndex = (): number => {
        const learning = host.langPrefs()?.learning;
        const word = learning ? labelForLanguage(learning) : '';
        return ownTracks().find(({ t }) => word && languageOf(t.name) === word)?.i ?? -1;
    };

    /** The first line: the one showing, else the language being learned, else the first. */
    const mainIndex = (): number => {
        const own = ownTracks();
        if (own.some(({ i }) => i === state.activeTrackIndex)) return state.activeTrackIndex;
        const learning = learningIndex();
        return learning !== -1 ? learning : own[0]?.i ?? -1;
    };

    const ensureOverlay = () => {
        if (!state.overlayEnabled) ui.toggleOverlay();
    };

    const items = (): Item[][] => {
        const own = ownTracks();
        const main = mainIndex();
        const shown = state.overlayEnabled;
        const dual = state.displayMode === 'dual';
        // One line, or none: a running translation only pauses (Single pauses
        // it), so coming back to two lines carries on without asking again.
        const singles: Item[] = own.map(({ t, i }) => ({
            label: trackLabel(t.name),
            checked: shown && !dual && state.activeTrackIndex === i,
            pick: () => {
                state.activeTrackIndex = i;
                ui.setMode('single');
                ensureOverlay();
                ui.refresh();
            },
        }));
        const pairs: Item[] = [];
        const mainTrack = state.tracks[main];
        if (mainTrack) {
            const first = mainTrack.name;
            for (const { t, i } of own) {
                if (i === main || languageOf(t.name) === languageOf(first)) continue;
                const second = t.name;
                pairs.push({
                    label: `${trackLabel(first)} + ${trackLabel(second)}`,
                    checked: shown && dual && !aiStop && state.secondaryTrackIndex === i,
                    // The site's own second line takes the AI translation's place,
                    // as its "on" does: the translation stops.
                    pick: () => {
                        aiStop?.();
                        state.activeTrackIndex = indexOf(first);
                        state.secondaryTrackIndex = indexOf(second);
                        ui.setMode('dual');
                        ensureOverlay();
                        ui.refresh();
                    },
                });
            }
        }
        // The AI pair always starts from the language being learned: that is
        // the track the translation is made from.
        const native = host.langPrefs()?.native;
        const source = state.tracks[learningIndex()];
        if (native && source && state.secondLineOnDemand) {
            pairs.push({
                label: `${trackLabel(source.name)} + ${nativeForLanguage(native)}`,
                ai: true,
                checked: shown && dual && !!aiStop,
                title: costTitle(),
                pick: () => pickAi(source.name),
                spent,
            });
        }
        const at = own.findIndex(({ i }) => i === state.activeTrackIndex);
        // Dual with nothing to put second shows one line: that line is the
        // checked one, not nothing.
        if (shown && dual && at !== -1 && !pairs.some((p) => p.checked)) singles[at].checked = true;
        const off: Item = {
            label: msg('rzCcOff', 'Off'),
            checked: !shown,
            // Only the on-screen lines go; the sidebar, and a running
            // translation, stay.
            pick: () => {
                if (state.overlayEnabled) ui.toggleOverlay();
            },
        };
        return [singles, pairs, [off]].filter((g) => g.length);
    };

    // The AI pair: Dual on the language being learned makes the offer, then
    // the offer is taken, after the one question unless the viewer said not to
    // ask.
    const pickAi = (sourceName: string): void | 'stay' => {
        state.activeTrackIndex = indexOf(sourceName);
        ui.setMode('dual');
        ensureOverlay();
        ui.refresh();
        if (aiStop) return;
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
        if (item.spent) {
            // Greyed, "після 02:00", the reason on hover; a press does nothing.
            const note = doc.createElement('span');
            note.className = 'vtt-cc-after';
            note.textContent = msg('ytAiAfter', 'after $1', [item.spent.until]);
            b.append(note);
            b.setAttribute('aria-disabled', 'true');
            b.title = item.spent.text;
            return b;
        }
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
        const source = state.tracks[learningIndex()];
        const native = host.langPrefs()?.native ?? '';
        const label = doc.createElement('span');
        label.textContent = `‹ ${source ? trackLabel(source.name) : ''} + ${nativeForLanguage(native)}`;
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

    // Arrow keys walk the menu's buttons, wrapping at both ends.
    const onArrow = (e: KeyboardEvent) => {
        if (!menu || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
        const all = [...menu.querySelectorAll<HTMLElement>('button')];
        if (!all.length) return;
        const down = e.key === 'ArrowDown';
        const at = all.indexOf(doc.activeElement as HTMLElement);
        const next = at === -1 ? (down ? 0 : all.length - 1) : (at + (down ? 1 : all.length - 1)) % all.length;
        all[next].focus();
        e.preventDefault();
    };
    const keepInMenu = (e: Event) => e.stopPropagation();

    const open = () => {
        if (!button) return;
        const root = playerRoot(button);
        menu = doc.createElement('div');
        menu.className = 'vtt-cc-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', msg('ytSidebarTitle', 'Subtitles'));
        menu.addEventListener('keydown', onArrow);
        for (const type of KEPT_IN_MENU) menu.addEventListener(type, keepInMenu);
        page = 'list';
        // Above the CC button, its right edge under the button's.
        const r = root.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        menu.style.right = `${Math.max(8, Math.round(r.right - b.right - 12))}px`;
        menu.style.bottom = `${Math.max(8, Math.round(r.bottom - b.top + 8))}px`;
        root.appendChild(menu);
        render();
        undismiss = dismissOn(doc, () => [menu, button], () => close());
        (menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>('.vtt-cc-item'))?.focus();
    };

    function close(): void {
        if (!menu) return;
        menu.remove();
        menu = null;
        page = 'list';
        undismiss();
    }

    // One listener for the whole page, ahead of the player's own: a press on
    // the CC button opens ours. Until a track loads there is nothing of ours
    // to pick, and the player's menu opens as before.
    const swallow = (e: Event) => {
        // Left behind by an extension reload: let go, so the fresh copy (or
        // the player) gets the button.
        if (isContextOrphaned()) return destroy();
        const cc = ccButtonOf(e.target);
        if (!cc || !ownTracks().length) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.type !== 'click') return;
        if (menu && button === cc) return close();
        close();
        button = cc;
        open();
    };
    for (const type of SWALLOWED) doc.addEventListener(type, swallow, true);

    const unsubscribe = state.subscribe(() => {
        if (menu && page === 'list') render();
    });
    /** The AI credits run out for now: the AI pair says until when, and does nothing. */
    let spent: AISpent | null = null;
    const unspent = watchSpent((now) => {
        spent = now;
        if (menu && page === 'list') render();
    });

    function destroy(): void {
        close();
        for (const type of SWALLOWED) doc.removeEventListener(type, swallow, true);
        unsubscribe();
        unspent();
    }

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
        destroy,
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
