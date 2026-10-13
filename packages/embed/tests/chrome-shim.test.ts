/**
 * The site demo's `chrome` stand-in: the AI badge reads the sign-in from
 * storage, so the shim's storage must follow its own sign-in state, or the
 * demo shows a signed-out badge next to a signed-in account.
 */

import { installChromeShim } from '../src/chrome-shim';
import { mountAIBadge } from '../../shared/src/ai-balance/badge';

const flush = () => new Promise((r) => setTimeout(r, 0));
let uninstall = () => {};

function header(): HTMLElement {
    const top = document.createElement('div');
    top.id = 'vtt-header-top';
    document.body.appendChild(top);
    return top;
}

beforeEach(() => {
    delete (window as any).chrome;
    document.body.innerHTML = '';
});
afterEach(() => uninstall());

test('signed out, the badge is off; the demo sign-in turns it on', async () => {
    uninstall = installChromeShim({ signedIn: false } as any);
    const top = header();
    mountAIBadge(top);
    await flush();
    expect(top.classList.contains('vtt-ai-off')).toBe(true);

    top.querySelector<HTMLButtonElement>('#vtt-ai-badge button')!.click();
    top.querySelector<HTMLButtonElement>('.lg-ai-signin')!.click();
    await flush();
    await flush();
    expect(top.classList.contains('vtt-ai-off')).toBe(false);
});

test('signed in (the default), the badge is never off', async () => {
    uninstall = installChromeShim({} as any);
    const top = header();
    mountAIBadge(top);
    await flush();
    expect(top.classList.contains('vtt-ai-off')).toBe(false);
});

test('storage answers only the keys asked for', async () => {
    uninstall = installChromeShim({} as any);
    const local = (window as any).chrome.storage.local;
    expect(await local.get('auth.uid')).toEqual({ 'auth.uid': 'demo' });
    expect(await local.get(['prefs.v1'])).toEqual({});
});
