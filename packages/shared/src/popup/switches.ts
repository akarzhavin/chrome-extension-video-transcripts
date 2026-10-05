// The on/off switches the popup and the settings page share: one per video site
// of this edition, then "Highlight my words on websites". The settings page
// adds hints under them; the popup leaves them out.
//
// A real checkbox with role="switch", styled as a switch: it keeps the focus
// ring, the keyboard behaviour and the platform's own semantics, and the whole
// row is the click target through the wrapping <label>.

import { msg as i18nMsg } from '../i18n';
import { loadPrefs, savePrefs, sitePrefKey, type Prefs, type VideoSite } from '../prefs';
import type { Edition } from '../sibling';
import { ownSites, SITE_NAMES } from '../welcome/welcome';
import { el, fill, HIGHLIGHT_ANCHOR } from './shared';

export interface SwitchSpec {
    label: string;
    /** Under the label; the popup passes none. */
    hint?: string;
    /** The pref this switch writes; also its `data-pref` attribute. */
    pref: keyof Prefs;
    /** Matches DEFAULT_PREFS until storage answers. */
    initial: boolean;
    onChange?: (on: boolean) => void;
}

let switchCount = 0;

/** One switch row. The checkbox is returned so the caller can fill it from storage. */
export function makeSwitch(spec: SwitchSpec): { row: HTMLLabelElement; input: HTMLInputElement } {
    const n = ++switchCount;
    const row = el('label', 'row');

    const text = el('span', 'row-text');
    const label = el('span', 'row-label', spec.label);
    label.id = `lg-sw-${n}-label`;
    text.appendChild(label);

    const box = el('span', 'sw');
    const input = el('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = spec.initial;
    input.dataset.pref = spec.pref;
    input.setAttribute('aria-labelledby', label.id);
    if (spec.hint) {
        const hint = el('span', 'row-hint', spec.hint);
        hint.id = `lg-sw-${n}-hint`;
        text.appendChild(hint);
        input.setAttribute('aria-describedby', hint.id);
    }
    box.append(input, el('span', 'sw-track'));
    row.append(text, box);
    return { row, input };
}

/** The extra line a site switch earns on the settings page. */
export interface SwitchHints {
    youtube?: string;
    highlight?: string;
}

/**
 * Fill `into` with this edition's switches. After a video-site switch changes,
 * one line below them says the page has to be reloaded; it is not there before.
 */
export function renderSwitches(into: HTMLElement, edition: Edition | null, hints: SwitchHints = {}): void {
    const boxes: Array<{ pref: keyof Prefs; input: HTMLInputElement }> = [];
    let reload: HTMLElement | null = null;
    const showReload = () => {
        if (reload) return;
        reload = el('div', 'reload', i18nMsg('popupReloadHint', 'Reload the page to apply.'));
        reload.setAttribute('role', 'status');
        into.appendChild(reload);
    };

    const add = (spec: SwitchSpec) => {
        const { row, input } = makeSwitch(spec);
        // The popup's "Manage sites" opens the settings page scrolled here.
        if (spec.pref === 'pageHighlight') row.id = HIGHLIGHT_ANCHOR;
        input.addEventListener('change', () => {
            void savePrefs({ [spec.pref]: input.checked } as Partial<Prefs>);
            spec.onChange?.(input.checked);
        });
        into.appendChild(row);
        boxes.push({ pref: spec.pref, input });
    };

    if (edition) {
        for (const site of ownSites(edition)) {
            add({
                label: fill(i18nMsg('popupSubtitlesOn', 'Subtitles on {site}'), { site: SITE_NAMES[site] }),
                hint: site === 'youtube' ? hints.youtube : undefined,
                pref: sitePrefKey(site as VideoSite),
                initial: true,
                onChange: showReload,
            });
        }
    }
    add({
        label: i18nMsg('popupPageHighlightLabel', 'Highlight my words on websites'),
        hint: hints.highlight,
        pref: 'pageHighlight',
        initial: true,
    });

    void loadPrefs().then((p) => {
        for (const { pref, input } of boxes) input.checked = p[pref] as boolean;
    });
}
