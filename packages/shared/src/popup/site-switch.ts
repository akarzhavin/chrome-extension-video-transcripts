// The popup's one switch: word highlighting on the site of the current tab.
// On for every site until the learner turns it off here; the host then goes on
// the list in prefs (highlightOffHosts) and the page's content script follows
// it live. Where there is no such switch (not a web page, Lingogram's own site,
// no URL) the popup shows nothing, and when highlighting is off everywhere the
// row is there, disabled, with the way back in a hint.

import { highlightSiteOf, isHighlightOff, withHighlight } from '../highlight-hosts';
import { msg as i18nMsg } from '../i18n';
import { loadPrefs, savePrefs } from '../prefs';
import { el } from './shared';
import { makeSwitch } from './switches';

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

/** "Highlight words on " + the host, which is the part that gives way to a long name. */
function setLabel(label: HTMLElement, site: string): void {
    const [lead, tail = ''] = i18nMsg('popupHighlightOnSite', 'Highlight words on {site}').split('{site}');
    const host = el('span', 'host', site);
    host.title = site;
    label.classList.add('site');
    label.replaceChildren(el('span', 'lead', lead), host, ...(tail ? [el('span', 'lead', tail)] : []));
}

/** Fills `into` (an empty, hidden slot) when there is a switch to show, and shows it. */
export async function renderSiteSwitch(into: HTMLElement): Promise<void> {
    const site = highlightSiteOf(await currentTabUrl());
    if (!site) return;
    const prefs = await loadPrefs();
    const globallyOff = !prefs.pageHighlight;

    const { row, input } = makeSwitch({
        label: site,
        hint: globallyOff
            ? i18nMsg('popupHighlightOffEverywhere', 'Highlighting is off on all websites. Turn it on in Settings.')
            : undefined,
        pref: 'highlightOffHosts',
        initial: !globallyOff && !isHighlightOff(prefs.highlightOffHosts, site),
    });
    setLabel(row.querySelector('.row-label') as HTMLElement, site);
    if (globallyOff) {
        input.disabled = true;
        input.checked = false;
        row.classList.add('disabled');
    } else {
        input.addEventListener('change', () => {
            const on = input.checked;
            void loadPrefs().then((p) => savePrefs({ highlightOffHosts: withHighlight(p.highlightOffHosts, site, on) }));
        });
    }
    into.appendChild(row);
    into.hidden = false;
}
