/**
 * @jest-environment jsdom
 */

import { SidebarUI } from '../src/SidebarUI';
import { AppState } from '../src/AppState';
import { Subtitle, AppInterface } from '../src/types';
import { loadPrefs } from '../src/prefs';

// Mock chrome API. Includes a minimal storage.local so prefs.loadPrefs (used by
// the fullscreen-exit restore path) reads from this backing store.
const prefsStore: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn()
    },
    storage: {
        local: {
            get: jest.fn((key: string) =>
                Promise.resolve(key in prefsStore ? { [key]: prefsStore[key] } : {})),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(prefsStore, items);
                return Promise.resolve();
            }),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};

// jsdom implements neither scroll method. scrollIntoView was already stubbed;
// scrollTo was missed when scrollActiveIntoView switched to it, which is why
// highlightSubtitle has been failing on `list.scrollTo is not a function`
// rather than on anything it asserts.
(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();
(window as any).Element.prototype.scrollTo = jest.fn();
(window as any).isTopWindow = true;

describe('SidebarUI', () => {
    let state: AppState, ui: SidebarUI, mockApp: AppInterface;

    beforeEach(() => {
        document.body.innerHTML = '<div id="vtt-list"></div><div id="vtt-sidebar"></div>';
        state = new AppState();
        mockApp = { seekVideo: jest.fn(), updateHighlight: jest.fn() };
        ui = new SidebarUI(state, mockApp);
        ui.elements = {
            list: document.getElementById('vtt-list') as HTMLDivElement,
            sidebar: document.getElementById('vtt-sidebar') as HTMLDivElement,
            overlayBtn: { classList: { toggle: jest.fn() } } as any,
            dualBtn: { classList: { toggle: jest.fn() } } as any,
            // A real <button>: it carries aria-expanded and takes focus, neither
            // of which a bare style stub can do.
            settingsBtn: document.createElement('button'),
            mainSelect: { innerHTML: '', appendChild: jest.fn() } as any,
            subSelect: { innerHTML: '', appendChild: jest.fn() } as any
        };
    });

    test('highlightSubtitle should find the correct subtitle for time', () => {
        const subs: Subtitle[] = [
            { startTime: 0, endTime: 2, text: 'First' },
            { startTime: 3, endTime: 5, text: 'Second' }
        ];
        state.addTrack('English', subs);
        
        if (ui.elements.list) {
            ui.elements.list.innerHTML = `
                <div class="vtt-item" data-index="0">First</div>
                <div class="vtt-item" data-index="1">Second</div>
            `;
        }

        ui.highlightSubtitle(1);
        expect(state.currentIndex).toBe(0);
        expect(ui.elements.list?.querySelector('[data-index="0"]')?.classList.contains('active-sub')).toBe(true);

        ui.highlightSubtitle(4);
        expect(state.currentIndex).toBe(1);
        expect(ui.elements.list?.querySelector('[data-index="1"]')?.classList.contains('active-sub')).toBe(true);
    });

    test('updateOverlay should create overlay if enabled', () => {
        state.overlayEnabled = true;
        state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);

        const video = document.createElement('video');
        const container = document.createElement('div');
        container.appendChild(video);
        document.body.appendChild(container);

        ui.updateOverlay(0);

        const overlay = document.getElementById('vtt-video-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay?.textContent).toBe('Hello');
    });

    test('settings takeover: hides list via class, swaps header title, restores on exit', () => {
        const panel = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = 'Subtitles';
        ui.elements.settingsPanel = panel as HTMLDivElement;
        ui.elements.titleEl = title as HTMLHeadingElement;

        ui.toggleSettingsPanel();
        expect(panel.classList.contains('open')).toBe(true);
        expect(ui.elements.sidebar?.classList.contains('vtt-settings-open')).toBe(true);
        expect(title.textContent).toBe('Settings');

        ui.toggleSettingsPanel();
        expect(panel.classList.contains('open')).toBe(false);
        expect(ui.elements.sidebar?.classList.contains('vtt-settings-open')).toBe(false);
        expect(title.textContent).toBe('Subtitles');
    });

    // Exits from settings are the header back chip and the gear toggle; the
    // Done button this test also covered was removed (see the comment above
    // header.appendChild(settingsPanel) in SidebarUI.init), leaving the test
    // asserting on a null element.
    test('back chip and gear toggle both exit settings mode', () => {
        // Full init() so the real header/panel wiring is exercised.
        document.body.innerHTML = '';
        const freshUi = new SidebarUI(new AppState(), mockApp);
        expect(freshUi.init()).toBe(true);

        const sidebar = document.getElementById('vtt-sidebar')!;
        const panel = document.getElementById('vtt-settings-panel')!;
        const backBtn = document.getElementById('vtt-back-btn')!;
        const gear = document.getElementById('vtt-settings-btn') as HTMLElement;
        expect(backBtn.textContent).toContain('Subtitles'); // labeled destination

        gear.click();
        expect(panel.classList.contains('open')).toBe(true);
        backBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(panel.classList.contains('open')).toBe(false);
        expect(sidebar.classList.contains('vtt-settings-open')).toBe(false);

        gear.click();
        expect(panel.classList.contains('open')).toBe(true);
        gear.click();
        expect(panel.classList.contains('open')).toBe(false);
    });

    test('the mode segment is three radios with exactly one checked', () => {
        document.body.innerHTML = '';
        const freshState = new AppState();
        const freshUi = new SidebarUI(freshState, mockApp);
        expect(freshUi.init()).toBe(true);
        freshState.addTrack('A', [{ text: 'one two', startTime: 0, endTime: 1 } as Subtitle]);
        freshState.addTrack('B', [{ text: 'uno', startTime: 0, endTime: 1 } as Subtitle]);
        freshUi.updateControls();

        const seg = document.querySelector('.vtt-modeseg') as HTMLElement;
        const radios = seg.querySelectorAll('[role="radio"]');
        expect(radios).toHaveLength(3);

        const checked = () =>
            Array.from(radios).filter((r) => r.getAttribute('aria-checked') === 'true');
        // Default mode is dual; the thumb must say so — single is a mode of its
        // own now, not the "nothing selected" look.
        expect(checked()).toHaveLength(1);
        expect(seg.dataset.sel).toBe('dual');

        (document.getElementById('vtt-qm-single') as HTMLButtonElement).click();
        expect(freshState.displayMode).toBe('single');
        expect(seg.dataset.sel).toBe('single');
        expect(checked()).toHaveLength(1);

        (document.getElementById('vtt-qm-guess') as HTMLButtonElement).click();
        expect(freshState.displayMode).toBe('guess');
        expect(seg.dataset.sel).toBe('guess');
        expect(checked()).toHaveLength(1);
    });

    test('collapsing the sidebar exits settings, re-expanding shows the transcript', () => {
        document.body.innerHTML = '';
        const freshUi = new SidebarUI(new AppState(), mockApp);
        expect(freshUi.init()).toBe(true);

        const sidebar = document.getElementById('vtt-sidebar')!;
        const panel = document.getElementById('vtt-settings-panel')!;

        (document.getElementById('vtt-settings-btn') as HTMLElement).click();
        expect(panel.classList.contains('open')).toBe(true);

        freshUi.toggleCollapsed();
        expect(sidebar.classList.contains('collapsed')).toBe(true);
        expect(panel.classList.contains('open')).toBe(false);
        expect(sidebar.classList.contains('vtt-settings-open')).toBe(false);

        // Re-expanding lands on the transcript, not a stale settings panel.
        freshUi.toggleCollapsed();
        expect(sidebar.classList.contains('collapsed')).toBe(false);
        expect(panel.classList.contains('open')).toBe(false);

        // Expanding must NOT close settings (only collapsing does): open
        // settings on the expanded sidebar and collapse via fullscreen enter.
        (document.getElementById('vtt-settings-btn') as HTMLElement).click();
        expect(panel.classList.contains('open')).toBe(true);
        freshUi.setupFullscreenHandling();
        const fsEl = document.createElement('div');
        document.body.appendChild(fsEl);
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fsEl });
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(panel.classList.contains('open')).toBe(false);
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    });

    describe('guess mode: reveal vs quick-add on the overlay', () => {
        // The reported bug: reveal and the quick-add pill both branched on "is
        // something selected", in opposite directions, so a click that grazed a
        // glyph boundary raised the pill instead of uncovering the word. A click
        // on a masked word must now always reveal.
        const buildGuessOverlay = () => {
            state.overlayEnabled = true;
            state.displayMode = 'guess';
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'alpha beta gamma' } as Subtitle]);
            const video = document.createElement('video');
            const container = document.createElement('div');
            container.appendChild(video);
            document.body.appendChild(container);
            // The reveal handler reads state.currentIndex, which only
            // highlightSubtitle sets; without it the click no-ops on -1.
            state.currentIndex = 0;
            ui.updateOverlay(0);
            return document.getElementById('vtt-video-overlay') as HTMLElement;
        };
        const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        afterEach(() => window.getSelection()?.removeAllRanges());

        test('updateOverlay leaves the DOM alone while nothing changed', () => {
            // timeupdate calls this ~4×/sec. Recreating identical children made
            // the lit capsule flicker under a resting cursor (fresh node = one
            // frame without :hover, transition replays) — so an unchanged
            // signature must keep the very same nodes.
            const overlay = buildGuessOverlay();
            const before = overlay.querySelector('.vtt-next-word');
            ui.updateOverlay(0);
            ui.updateOverlay(0);
            expect(overlay.querySelector('.vtt-next-word')).toBe(before);

            // A reveal changes the signature, so now the children must rebuild.
            state.revealNextWord(0);
            ui.updateOverlay(0);
            expect(overlay.querySelector('.vtt-next-word')).not.toBe(before);
        });

        test('pointerdown alone reveals — the press must not depend on the click arriving', () => {
            // The overlay rebuilds its DOM every ~250ms; when a rebuild lands
            // mid-press Chrome drops the click entirely (measured: 22 of 40
            // trusted clicks delivered). The press itself is the reveal.
            const overlay = buildGuessOverlay();
            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            masked.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            expect(state.getRevealedCount(0)).toBe(2);
        });

        test('a full press (pointerdown then click) reveals exactly once', () => {
            const overlay = buildGuessOverlay();
            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            masked.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            masked.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(state.getRevealedCount(0)).toBe(2); // not 3
        });

        test('a right-button press does not reveal', () => {
            const overlay = buildGuessOverlay();
            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            masked.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }));
            expect(state.getRevealedCount(0)).toBe(1);
        });

        test('a click on a masked word reveals the next one', () => {
            const overlay = buildGuessOverlay();
            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            expect(state.getRevealedCount(0)).toBe(1);

            click(masked);
            expect(state.getRevealedCount(0)).toBe(2);
        });

        test('a click anywhere on the line reveals — the line is the target', () => {
            const overlay = buildGuessOverlay();
            // Not a word: the caption box itself, and the container around it.
            const box = overlay.querySelector('.vtt-overlay-main') as HTMLElement;
            click(box);
            expect(state.getRevealedCount(0)).toBe(2);

            click(overlay);
            expect(state.getRevealedCount(0)).toBe(3);
        });

        test('exactly one word is lit as next, and it moves with the reveal', () => {
            const overlay = buildGuessOverlay();
            const lit = () => overlay.querySelectorAll<HTMLElement>('.vtt-next-word');
            expect(lit()).toHaveLength(1);
            // 'alpha' is free, so 'beta' (index 1) is what opens next.
            expect(lit()[0].textContent).not.toBe('beta');
            const before = lit()[0].dataset.hidden;
            expect(before).toBe('beta');

            click(overlay);
            const after = lit();
            expect(after).toHaveLength(1);
            // The frontier advanced onto the following word.
            expect(after[0].dataset.hidden).toBe('gamma');
        });

        test('the last word revealed leaves nothing lit', () => {
            const overlay = buildGuessOverlay();
            click(overlay);
            click(overlay); // three tokens, first is free
            expect(state.isFullyRevealed(0)).toBe(true);
            expect(document.querySelectorAll('.vtt-next-word')).toHaveLength(0);
        });

        test('a masked word still reveals while text elsewhere is selected', () => {
            const overlay = buildGuessOverlay();
            // Plant a selection on the already-revealed word — this is what used
            // to silently swallow the reveal.
            const revealed = overlay.querySelector('.vtt-revealed-word') as HTMLElement;
            const range = document.createRange();
            range.selectNodeContents(revealed);
            const sel = window.getSelection()!;
            sel.removeAllRanges();
            sel.addRange(range);

            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            click(masked);
            expect(state.getRevealedCount(0)).toBe(2);
        });

        test('a click on revealed text stands down for a live selection', () => {
            const overlay = buildGuessOverlay();
            const revealed = overlay.querySelector('.vtt-revealed-word') as HTMLElement;
            const range = document.createRange();
            range.selectNodeContents(revealed);
            const sel = window.getSelection()!;
            sel.removeAllRanges();
            sel.addRange(range);

            click(revealed);
            expect(state.getRevealedCount(0)).toBe(1); // unchanged — pill wins here
        });

        test('a guess line announced as a button is reachable and operable by keyboard', () => {
            state.displayMode = 'guess';
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'alpha beta gamma' } as Subtitle]);
            ui.renderSubtitles();
            const item = ui.elements.list!.querySelector('.vtt-item[data-index="0"]') as HTMLElement;

            // role="button" without these promises a control that keyboard
            // users can neither focus nor activate.
            expect(item.getAttribute('role')).toBe('button');
            expect(item.getAttribute('tabindex')).toBe('0');

            const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
            item.dispatchEvent(enter);
            expect(state.getRevealedCount(0)).toBe(2);

            const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
            item.dispatchEvent(space);
            expect(state.getRevealedCount(0)).toBe(3);
            expect(space.defaultPrevented).toBe(true); // Space must not scroll
        });

        test('guess items carry no action row — the line itself is the only control', () => {
            state.displayMode = 'guess';
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'alpha beta gamma' } as Subtitle]);
            ui.renderSubtitles();
            const item = ui.elements.list!.querySelector('.vtt-item[data-index="0"]') as HTMLElement;

            click(item); // reveal one word — previously this spawned a Save row
            expect(item.querySelector('.vtt-guess-actions')).toBeNull();
            expect(item.querySelector('button')).toBeNull();
        });

        test('double-click is suppressed in guess mode but not in dual', () => {
            const overlay = buildGuessOverlay();
            const dbl = () => {
                const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 });
                overlay.dispatchEvent(e);
                return e.defaultPrevented;
            };
            expect(dbl()).toBe(true);

            // Elsewhere a double-click is a fair way to grab a word for the
            // dictionary, so it must survive.
            state.displayMode = 'dual';
            expect(dbl()).toBe(false);
        });
    });

    describe('overlay style presets', () => {
        const buildOverlay = () => {
            state.overlayEnabled = true;
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hi' } as Subtitle]);
            const video = document.createElement('video');
            const container = document.createElement('div');
            container.appendChild(video);
            document.body.appendChild(container);
            ui.updateOverlay(0);
            return document.getElementById('vtt-video-overlay') as HTMLElement;
        };

        test('applyOverlayStyle sets --vtt-overlay-* custom props from defaults', () => {
            const overlay = buildOverlay();
            // Defaults: medium size/offset/bg, white color.
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('24px');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bottom')).toBe('80px');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bg-opacity')).toBe('0.7');
            expect(overlay.style.getPropertyValue('--vtt-overlay-color')).toBe('#ffffff');
        });

        test('a size preset setter restyles the live overlay and persists the pref', async () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayFontSize('large');
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('32px');
            // Persisted via savePrefs (load→merge→set chain) → storage.local backing store.
            // Asserted through the resolved view rather than the raw blob: appearance
            // is stored per site (jsdom's host → the 'other' scope), and this test is
            // about the setter persisting, not about where the bytes sit.
            await new Promise((r) => setTimeout(r, 0));
            expect((await loadPrefs('other')).overlayFontSize).toBe('large');
        });

        test('an offset preset setter maps low/high tokens to px', () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayBottomOffset('low');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bottom')).toBe('40px');
            (ui as any).setOverlayBottomOffset('high');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bottom')).toBe('140px');
        });

        test('edge style maps tokens to text-shadow values', () => {
            const overlay = buildOverlay();
            // Default is 'shadow' (the pre-redesign hard-coded look).
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toBe('1px 1px 3px #000');
            (ui as any).setOverlayEdgeStyle('none');
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toBe('none');
            (ui as any).setOverlayEdgeStyle('outline');
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toContain('-1px -1px 0 #000');
        });

        test('applyOverlayStyle also styles the sidebar preview element', () => {
            const preview = document.createElement('div');
            ui.elements.previewEl = preview;
            (ui as any).setOverlayFontSize('large');
            expect(preview.style.getPropertyValue('--vtt-overlay-font-size')).toBe('32px');
            expect(preview.style.getPropertyValue('--vtt-overlay-edge')).toBe('1px 1px 3px #000');
        });

        test('reset restores all five defaults with a single storage write', async () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayFontSize('large');
            (ui as any).setOverlayEdgeStyle('outline');
            await new Promise((r) => setTimeout(r, 0));

            ((global as any).chrome.storage.local.set as jest.Mock).mockClear();
            (ui as any).resetOverlayStyle();
            await new Promise((r) => setTimeout(r, 0));

            expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
            const stored = (prefsStore['prefs.v1'] as any).byPlatform.other;
            expect(stored).toMatchObject({
                overlayFontSize: 'medium',
                overlayColor: '#ffffff',
                overlayBottomOffset: 'medium',
                overlayBgOpacity: 'medium',
                overlayEdgeStyle: 'shadow',
            });
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('24px');
        });

        test('updateOverlayPreview falls back to sample text and honors dual mode', () => {
            const preview = document.createElement('div');
            const main = document.createElement('div');
            const sub = document.createElement('div');
            ui.elements.previewEl = preview;
            ui.elements.previewMain = main;
            ui.elements.previewSub = sub;

            state.displayMode = 'dual';
            (ui as any).updateOverlayPreview();
            expect(main.textContent).toBe('The quick brown fox');
            expect(sub.textContent).toBe('Translation preview');
            expect(sub.style.display).toBe('');

            state.displayMode = 'single';
            (ui as any).updateOverlayPreview();
            expect(sub.style.display).toBe('none');

            state.overlayEnabled = false;
            (ui as any).updateOverlayPreview();
            expect(preview.classList.contains('vtt-preview-disabled')).toBe(true);
        });
    });

    describe('word-wrapping spans (data-word)', () => {
        // Every word lives in its own <span> so the quick-add overlay can snap
        // selection to word boundaries. data-word is the attribute quick-add
        // reads, so it carries the real word only while that word is visible;
        // a still-masked word is parked in data-hidden instead.

        test('buildMaskedContent keeps the hidden word out of data-word', () => {
            const container = ui.buildMaskedContent('hello world foo', 1);
            const spans = container.querySelectorAll('span');
            expect(spans).toHaveLength(3);

            expect(spans[0].dataset.word).toBe('hello');
            expect(spans[0].classList.contains('vtt-revealed-word')).toBe(true);

            // Masked: quick-add must not be able to offer an unseen word.
            expect(spans[1].dataset.word).toBeUndefined();
            expect(spans[1].dataset.hidden).toBe('world');
            expect(spans[1].classList.contains('vtt-masked-word')).toBe(true);
            // A neutral smudge, never the word: a blur is only paint, and
            // stand-in letters would survive it as readable nonsense. Longer
            // words still get wider panes, but not one glyph per letter.
            const mask = spans[1].textContent ?? '';
            expect(mask).not.toBe('world');
            expect(new Set(mask)).toHaveProperty('size', 1);
            expect(mask.length).toBeGreaterThan(0);

            expect(spans[2].dataset.word).toBeUndefined();
            expect(spans[2].dataset.hidden).toBe('foo');
        });

        test('punctuation stays plain text and the free word is a real word', () => {
            const container = ui.buildMaskedContent('- hello world', 1);
            const kids = container.querySelectorAll('span');
            expect(kids).toHaveLength(3);

            // The dash is visible filler — no capsule, no reveal target.
            expect(kids[0].className).toBe('vtt-guess-filler');
            expect(kids[0].textContent).toBe('-');

            // The free first word is "hello", not the dash.
            expect(kids[1].classList.contains('vtt-revealed-word')).toBe(true);
            expect(kids[1].textContent).toBe('hello');

            // And the lit target is the real second word.
            expect(kids[2].classList.contains('vtt-masked-word')).toBe(true);
            expect(kids[2].classList.contains('vtt-next-word')).toBe(true);
        });

        test('updateGuessItem keeps mapping right past filler tokens', () => {
            const subs: Subtitle[] = [{ startTime: 0, endTime: 1, text: '- alpha beta' }];
            state.addTrack('English', subs);
            state.displayMode = 'guess';
            ui.renderSubtitles();
            const item = ui.elements.list!.querySelector('.vtt-item[data-index="0"]') as HTMLElement;

            state.revealNextWord(0); // uncovers "beta", the 2nd maskable word
            ui.updateGuessItem(0);

            const words = item.querySelectorAll<HTMLElement>('.vtt-revealed-word');
            expect(Array.from(words).map((s) => s.textContent)).toEqual(['alpha', 'beta']);
            expect(item.querySelector('.vtt-guess-filler')?.textContent).toBe('-');
        });

        test('the frosted text never contains the word, and is stable across repaints', () => {
            // The blur is only paint: anything real under it could be selected
            // or copied straight back out, so no masked span may render the
            // word — including as a substring.
            const line = 'photosynthesis sustains everything';
            const container = ui.buildMaskedContent(line, 0);
            const masked = container.querySelectorAll<HTMLElement>('.vtt-masked-word');
            expect(masked).toHaveLength(3);
            masked.forEach((span) => {
                const shown = span.textContent ?? '';
                const real = span.dataset.hidden ?? '';
                expect(shown).not.toBe(real);
                expect(shown).not.toContain(real);
                expect(shown.trim().length).toBeGreaterThan(0);
            });

            // The overlay repaints ~4x/sec; unstable filler would make the line
            // shimmer, so the same word must always mask to the same letters.
            const again = ui.buildMaskedContent(line, 0);
            expect(again.textContent).toBe(container.textContent);
        });

        test('buildPlainItem wraps each word in a data-word span without a class', () => {
            const subs: Subtitle[] = [{ startTime: 0, endTime: 1, text: 'one two three' }];
            state.addTrack('English', subs);
            ui.renderSubtitles();

            const item = ui.elements.list?.querySelector('.vtt-item[data-index="0"]');
            const spans = item?.querySelectorAll('.vtt-main-text span[data-word]');
            expect(spans?.length).toBe(3);
            // Plain mode keeps class empty so existing CSS still styles the
            // parent .vtt-main-text — only data-word enables word-snap.
            expect(spans?.[0].className).toBe('');
            expect(Array.from(spans ?? []).map((s) => (s as HTMLElement).dataset.word)).toEqual([
                'one', 'two', 'three',
            ]);
        });

        test('updateGuessItem mutates spans in place, preserving DOM nodes (regression)', () => {
            // Critical for quick-add selection: replacing the .vtt-main-text
            // parent would orphan an active Range. We patch class/textContent
            // on the existing span elements instead.
            const subs: Subtitle[] = [{ startTime: 0, endTime: 1, text: 'alpha beta gamma' }];
            state.addTrack('English', subs);
            state.displayMode = 'guess';
            ui.renderSubtitles();

            const item = ui.elements.list?.querySelector('.vtt-item[data-index="0"]') as HTMLDivElement;
            const wordSpans = () =>
                item.querySelectorAll<HTMLSpanElement>('.vtt-masked-word, .vtt-revealed-word');
            const beta = wordSpans()[1];
            expect(beta.classList.contains('vtt-masked-word')).toBe(true);
            expect(beta.textContent).not.toBe('beta');
            expect(beta.dataset.word).toBeUndefined();

            // Reveal one more word so index 1 ("beta") flips revealed.
            state.revealNextWord(0);
            ui.updateGuessItem(0);

            const sameBeta = wordSpans()[1];
            expect(sameBeta).toBe(beta); // exact same node — not a replacement
            expect(sameBeta.classList.contains('vtt-revealed-word')).toBe(true);
            expect(sameBeta.textContent).toBe('beta');
            // Now visible, so quick-add may offer it.
            expect(sameBeta.dataset.word).toBe('beta');
            expect(sameBeta.dataset.hidden).toBeUndefined();
        });

        test('updateGuessItem re-masks, hiding data-word again', () => {
            const subs: Subtitle[] = [{ startTime: 0, endTime: 1, text: 'alpha beta gamma' }];
            state.addTrack('English', subs);
            state.displayMode = 'guess';
            ui.renderSubtitles();

            const item = ui.elements.list?.querySelector('.vtt-item[data-index="0"]') as HTMLDivElement;
            const wordSpans = () =>
                item.querySelectorAll<HTMLSpanElement>('.vtt-masked-word, .vtt-revealed-word');

            state.revealNextWord(0); // beta revealed
            ui.updateGuessItem(0);
            expect(wordSpans()[1].dataset.word).toBe('beta');

            // Back to the start of the line — beta must go dark again.
            state.resetGuessState();
            ui.updateGuessItem(0);

            const beta = wordSpans()[1];
            expect(beta.classList.contains('vtt-masked-word')).toBe(true);
            expect(beta.textContent).not.toBe('beta');
            expect(beta.dataset.word).toBeUndefined();
            expect(beta.dataset.hidden).toBe('beta');
        });
    });

    describe('pickScrollMode', () => {
        // Private method — accessed via `as any` to keep the API surface clean.
        const pickScrollMode = (target: number, from: number): 'smooth' | 'instant' =>
            (ui as any).pickScrollMode(target, from);

        test('instant when there is no previous subtitle (from === -1)', () => {
            expect(pickScrollMode(0, -1)).toBe('instant');
            expect(pickScrollMode(500, -1)).toBe('instant');
        });

        test('smooth for short hops within the threshold', () => {
            expect(pickScrollMode(5, 4)).toBe('smooth');   // forward by 1
            expect(pickScrollMode(5, 25)).toBe('smooth');  // backward by 20 — boundary, still smooth
            expect(pickScrollMode(25, 5)).toBe('smooth');  // forward by 20 — boundary, still smooth
            expect(pickScrollMode(5, 5)).toBe('smooth');   // same index (defensive)
        });

        test('instant for big jumps past the threshold', () => {
            expect(pickScrollMode(26, 5)).toBe('instant');  // forward by 21
            expect(pickScrollMode(5, 26)).toBe('instant');  // backward by 21
            expect(pickScrollMode(1000, 0)).toBe('instant');
        });
    });

    describe('setupFullscreenHandling', () => {
        // Drives a fullscreen enter→exit cycle by toggling document.fullscreenElement
        // and dispatching the event the handler listens for.
        const fireFullscreen = (el: Element | null): void => {
            Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el });
            document.dispatchEvent(new Event('fullscreenchange'));
        };
        const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

        beforeEach(() => {
            for (const k of Object.keys(prefsStore)) delete prefsStore[k];
        });

        // Regression: leaving fullscreen used to unconditionally remove 'collapsed',
        // re-opening a sidebar the user had deliberately collapsed.
        test('exiting fullscreen keeps the sidebar collapsed when the pref says so', async () => {
            prefsStore['prefs.v1'] = { displayMode: 'dual', overlayEnabled: true, sidebarCollapsed: true };
            const sidebar = ui.elements.sidebar as HTMLDivElement;
            ui.setupFullscreenHandling();

            const fsEl = document.createElement('div');
            document.body.appendChild(fsEl);

            fireFullscreen(fsEl); // enter → transient collapse
            expect(sidebar.classList.contains('fullscreen')).toBe(true);
            expect(sidebar.classList.contains('collapsed')).toBe(true);

            fireFullscreen(null); // exit → restore persisted state
            await flush();
            expect(sidebar.classList.contains('fullscreen')).toBe(false);
            expect(sidebar.classList.contains('collapsed')).toBe(true);
        });

        test('exiting fullscreen expands the sidebar when the pref is not collapsed', async () => {
            prefsStore['prefs.v1'] = { displayMode: 'dual', overlayEnabled: true, sidebarCollapsed: false };
            const sidebar = ui.elements.sidebar as HTMLDivElement;
            ui.setupFullscreenHandling();

            const fsEl = document.createElement('div');
            document.body.appendChild(fsEl);

            fireFullscreen(fsEl);
            expect(sidebar.classList.contains('collapsed')).toBe(true);

            fireFullscreen(null);
            await flush();
            expect(sidebar.classList.contains('collapsed')).toBe(false);
        });
    });

    // The player menu needs "open", not "flip": both toggleCollapsed() and
    // toggleSettingsPanel() would close an already-open panel.
    describe('openPanel / openSettings are not toggles', () => {
        let sidebar: HTMLElement;

        beforeEach(() => {
            document.body.innerHTML = '';
            ui = new SidebarUI(new AppState(), mockApp);
            expect(ui.init()).toBe(true);
            sidebar = document.getElementById('vtt-sidebar')!;
        });

        test('openPanel expands a collapsed sidebar and persists it', () => {
            ui.toggleCollapsed();
            expect(ui.isCollapsed()).toBe(true);
            ui.openPanel();
            expect(ui.isCollapsed()).toBe(false);
            expect(prefsStore['prefs.v1']).toMatchObject({ sidebarCollapsed: false });
        });

        test('openPanel on an already-open sidebar leaves it open', () => {
            expect(ui.isCollapsed()).toBe(false);
            ui.openPanel();
            expect(ui.isCollapsed()).toBe(false);
        });

        test('openSettings expands and opens settings from collapsed', () => {
            ui.toggleCollapsed();
            ui.openSettings();
            expect(ui.isCollapsed()).toBe(false);
            expect(document.getElementById('vtt-settings-panel')!.classList.contains('open')).toBe(true);
        });

        test('openSettings on already-open settings keeps them open', () => {
            ui.openSettings();
            ui.openSettings();
            expect(document.getElementById('vtt-settings-panel')!.classList.contains('open')).toBe(true);
        });

        test('the collapse tab is keyboard-operable and announces its state', () => {
            const tab = document.getElementById('vtt-toggle-btn')!;
            expect(tab.getAttribute('role')).toBe('button');
            expect(tab.getAttribute('tabindex')).toBe('0');
            expect(tab.getAttribute('aria-label')).toBeTruthy();

            tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            expect(ui.isCollapsed()).toBe(true);
            expect(tab.getAttribute('aria-expanded')).toBe('false');

            tab.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
            expect(ui.isCollapsed()).toBe(false);
            expect(tab.getAttribute('aria-expanded')).toBe('true');
        });
    });

    describe('onRefresh hooks', () => {
        test('fire on refresh, stop after unsubscribe, and survive a throwing peer', () => {
            const bad = jest.fn(() => { throw new Error('boom'); });
            const good = jest.fn();
            ui.onRefresh(bad);
            const off = ui.onRefresh(good);

            expect(() => ui.refresh()).not.toThrow();
            expect(good).toHaveBeenCalledTimes(1);

            off();
            ui.refresh();
            expect(good).toHaveBeenCalledTimes(1);
        });
    });

    // The player-bar button no longer mirrors overlay state — it opens a menu,
    // which is always available. The CC button beside it carries the overlay's
    // on/off and paints itself from an onRefresh hook; that's covered in
    // apps/youtube/tests/player-menu.test.ts.
});
