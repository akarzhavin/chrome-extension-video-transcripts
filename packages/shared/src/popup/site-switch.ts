// The popup's one switch: word highlighting on the site of the current tab.
// On for every site until the learner turns it off here; the host then goes on
// the list in prefs (highlightOffHosts) and the page's content script follows
// it live. Where there is no such switch (not a web page, Lingogram's own site,
// no URL) the popup shows nothing, and when highlighting is off everywhere the
// row is there, without a switch, with the way back in a link.

import { highlightSiteOf, isHighlightOff, withHighlight } from '../highlight-hosts';
import { msg as i18nMsg } from '../i18n';
import { loadPrefs, savePrefs } from '../prefs';
import { inlineLink, staticRow, subLine } from './menu';
import { el, openManageSites } from './shared';

/**
 * The URL of the tab the popup was opened on. `tab.url` is readable there
 * through `activeTab` alone (the manifest has no `tabs` permission and no host
 * permission for arbitrary sites); when it is not, the answer is "no URL".
 */
async function currentTabUrl(): Promise<string | undefined> {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.url;
    } catch {
        return undefined;
    }
}

let rowCount = 0;

/** "Highlight on " + the host, which is the part that gives way to a long name. */
function siteLabel(site: string, id: string): HTMLElement {
    const [lead, tail = ''] = i18nMsg('popupHighlightOnSite', 'Highlight on {site}').split('{site}');
    const host = el('span', 'host', site);
    host.title = site;
    const label = el('span', 'l site');
    label.id = id;
    label.append(el('span', 'lead', lead), host, ...(tail ? [el('span', 'lead', tail)] : []));
    return label;
}

/** Fills `into` (an empty, hidden slot) when there is a row to show, and shows it. */
export async function renderSiteSwitch(into: HTMLElement): Promise<void> {
    const site = highlightSiteOf(await currentTabUrl());
    if (!site) return;
    const prefs = await loadPrefs();
    const manage = () => inlineLink(i18nMsg('popupManageSites', 'Manage sites'), () => void openManageSites());

    if (!prefs.pageHighlight) {
        // Off everywhere: nothing to switch here, only the way to the list.
        const label = el('span', 'l', i18nMsg('popupHighlightOffEverywhere', 'Highlighting is off on all websites'));
        into.append(staticRow('pen', label), subLine(manage()));
        into.hidden = false;
        return;
    }

    const labelId = `lg-hl-${++rowCount}-label`;
    const box = el('span', 'sw');
    const input = el('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.dataset.pref = 'highlightOffHosts';
    input.setAttribute('aria-labelledby', labelId);
    input.checked = !isHighlightOff(prefs.highlightOffHosts, site);
    box.append(input, el('span', 'sw-track'));
    into.appendChild(staticRow('pen', siteLabel(site, labelId), box));

    // "Off on this site. Manage sites" only while the switch is off.
    let sub: HTMLElement | null = null;
    const paintSub = () => {
        if (input.checked) {
            sub?.remove();
            sub = null;
        } else if (!sub) {
            sub = subLine(i18nMsg('popupHighlightOffHere', 'Off on this site.'), ' ', manage());
            into.appendChild(sub);
        }
    };
    paintSub();
    input.addEventListener('change', () => {
        const on = input.checked;
        paintSub();
        void loadPrefs().then((p) => savePrefs({ highlightOffHosts: withHighlight(p.highlightOffHosts, site, on) }));
    });
    into.hidden = false;
}
