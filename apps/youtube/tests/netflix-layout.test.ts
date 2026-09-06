/**
 * @jest-environment jsdom
 */

/**
 * Behaviour map §36: on Netflix the panel makes room for itself — the player
 * narrows — rather than being laid over the picture.
 *
 * Nothing checked it. `injectNetflixLayout` appeared in no test at all, so
 * deleting the rule would have gone unnoticed until someone opened a film and
 * found the panel covering it.
 *
 * These assert the EFFECT through getComputedStyle rather than the text of the
 * rule: a check that compares the stylesheet to a copy of itself passes for any
 * selector, including one that matches nothing. jsdom resolves `:has()`, which
 * is what makes that possible here — verified before this file was written.
 *
 * No Netflix account and no network: the layout is a stylesheet the module
 * injects, and the page it applies to is stood up here.
 */

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage: jest.fn(),
        getManifest: () => ({ version: '1.0.0' }),
        lastError: undefined,
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { bootstrapNetflix } from '../src/content/netflix/app';

/** A Netflix watch page, reduced to the parts the layout rule names. */
function netflixPage(): HTMLElement {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div class="watch-video"></div><div id="vtt-sidebar"></div>';
    document.body.className = '';
    return document.querySelector('.watch-video') as HTMLElement;
}

const player = () => document.querySelector('.watch-video') as HTMLElement;
const sidebar = () => document.getElementById('vtt-sidebar') as HTMLElement;
const widthOf = (el: HTMLElement) => getComputedStyle(el).width;

/**
 * bootstrapNetflix() also constructs the app, which mounts the shared panel and
 * starts listening. Only the stylesheet is under test here, so failures from
 * the rest are swallowed — the assertions read the document, not the return.
 */
function injectLayout(): void {
    try {
        bootstrapNetflix();
    } catch {
        // The app half needs a real player; the stylesheet is already in.
    }
}

describe('the panel makes room for itself on Netflix', () => {
    beforeEach(() => {
        netflixPage();
    });

    it('narrows the player while the panel is open', () => {
        injectLayout();
        document.body.classList.add('vtt-sidebar-active');

        expect(widthOf(player())).toBe('calc(100vw - 320px)');
    });

    /**
     * The three arms that must NOT narrow it. Each is a state where the panel
     * is not taking up side room, and narrowing anyway would leave a black band
     * beside the picture.
     */
    it('leaves the player alone before the panel is up', () => {
        injectLayout();
        // No vtt-sidebar-active on the body yet.
        expect(widthOf(player())).not.toBe('calc(100vw - 320px)');
    });

    it('leaves the player alone once the panel is collapsed', () => {
        injectLayout();
        document.body.classList.add('vtt-sidebar-active');
        sidebar().classList.add('collapsed');

        expect(widthOf(player())).not.toBe('calc(100vw - 320px)');
    });

    it('leaves the player alone in fullscreen, where the panel floats over it', () => {
        injectLayout();
        document.body.classList.add('vtt-sidebar-active');
        sidebar().classList.add('fullscreen');

        expect(widthOf(player())).not.toBe('calc(100vw - 320px)');
    });

    /**
     * Netflix's own control bar sits along the bottom in fullscreen, and the
     * gap the shared stylesheet leaves is too small for it — the panel would
     * cover the play button.
     *
     * Read from the injected rule rather than through getComputedStyle: jsdom
     * mangles a nested max() while resolving it ("max((120px * 12vh) * ,)"), so
     * a computed-style assertion here would be comparing against a parser bug.
     * Measured before this was written. The floor matters as much as the
     * proportion — 12vh alone collapses to nothing on a short window.
     */
    it('lifts the panel clear of the control bar in fullscreen', () => {
        injectLayout();
        const css = document.getElementById('nflx-vtt-layout')!.textContent ?? '';

        expect(css).toContain('#vtt-sidebar.fullscreen');
        expect(css).toContain('max(120px, 12vh)');
    });
});
