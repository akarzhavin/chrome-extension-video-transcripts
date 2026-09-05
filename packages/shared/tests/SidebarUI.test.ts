/**
 * @jest-environment jsdom
 */

import { SidebarUI } from '../src/SidebarUI';
import { AppState } from '../src/AppState';
import { Subtitle, AppInterface } from '../src/types';
import { loadPrefs, savePrefs } from '../src/prefs';
import { WordScreen } from '../src/lookup/word-screen';
// The stylesheet is read directly for the one claim whose product half lives
// in CSS rather than in the module under test (the collapse chevron).
import { readFileSync } from 'fs';
import { join } from 'path';

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
        // With a word screen — the extension configuration. The suite below
        // covers a sidebar built without one.
        ui = new SidebarUI(state, mockApp, (host) => new WordScreen(host));
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

    describe('buildSecondaryTextElement', () => {
        const build = (texts: string[]) =>
            (ui as any).buildSecondaryTextElement(texts.map((text) => ({ text }))) as HTMLDivElement | null;

        test('joins paired cues with a space, not a separator character', () => {
            expect(build(['И если ты клеймишь его выбор,', 'то поддерживаешь'])?.textContent)
                .toBe('И если ты клеймишь его выбор, то поддерживаешь');
        });

        test('drops duplicated cue texts', () => {
            expect(build(['same line', 'same line', 'other'])?.textContent).toBe('same line other');
        });

        test('returns null when nothing is paired', () => {
            expect(build([])).toBeNull();
        });
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
        const checkedId = () => checked()[0]?.id;
        // Default mode is dual; the active pill must say so — single is a mode
        // of its own now, not the "nothing selected" look.
        expect(checked()).toHaveLength(1);
        expect(checkedId()).toBe('vtt-qm-dual');

        (document.getElementById('vtt-qm-single') as HTMLButtonElement).click();
        expect(freshState.displayMode).toBe('single');
        expect(checkedId()).toBe('vtt-qm-single');
        expect(checked()).toHaveLength(1);

        (document.getElementById('vtt-qm-guess') as HTMLButtonElement).click();
        expect(freshState.displayMode).toBe('guess');
        expect(checkedId()).toBe('vtt-qm-guess');
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

        test('press and release without a click reveals — no dependence on click synthesis', () => {
            // The overlay rebuilds its DOM every ~250ms; when a rebuild lands
            // mid-press Chrome drops the synthesized click entirely (measured:
            // 22 of 40 trusted clicks delivered). Reveal therefore rides the raw
            // pointerdown on the persistent container, which fires at press time
            // — before any rebuild can detach the word. There is no ambiguity to
            // wait out: the caption text is not a drag surface, since moving the
            // captions is the separate grip's job.
            const overlay = buildGuessOverlay();
            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            masked.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            masked.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
            expect(state.getRevealedCount(0)).toBe(2);
        });

        test('a full press (pointerdown, pointerup, click) reveals exactly once', () => {
            const overlay = buildGuessOverlay();
            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            masked.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            masked.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
            masked.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(state.getRevealedCount(0)).toBe(2); // not 3
        });

        test('a press on a masked word reveals even if the pointer drifts', () => {
            // Moving the captions is the grip's job, so the text surface has no
            // axis test to satisfy: a press on a capsule reveals at pointerdown,
            // exactly as it did before, and stray drift cannot swallow it.
            const overlay = buildGuessOverlay();
            const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
            const fire = (type: string, x: number, y: number) =>
                masked.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: x, clientY: y }));
            // Read BEFORE the gesture, from the element, so "stayed put" is a
            // comparison of two observations. The previous form,
            // `getPropertyValue(...) || '0%'` against '0%', was satisfied by the
            // property never having been written at all — which is exactly what
            // it could not tell apart from a reset.
            const nudgeBefore = overlay.style.getPropertyValue('--vtt-overlay-nudge');
            const positionWrites = jest.spyOn((ui as any).position, 'set');
            fire('pointerdown', 100, 200);
            fire('pointermove', 102, 150);
            fire('pointerup', 102, 150);
            expect(state.getRevealedCount(0)).toBe(2);
            // The captions stayed put: the text is not a drag surface, so the
            // drift neither moved the stored position nor repainted the nudge.
            expect(positionWrites).not.toHaveBeenCalled();
            expect(overlay.style.getPropertyValue('--vtt-overlay-nudge')).toBe(nudgeBefore);
            positionWrites.mockRestore();
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
            // 'alpha' is free, so 'beta' (index 1) is what opens next. The lit
            // capsule renders that word transparently to size itself, so its
            // identity is read from data-hidden.
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

        describe('a far-off sidebar click is navigation, not a reveal', () => {
            // Clicking a line several seconds away is someone moving through
            // the transcript. Spending a reveal there uncovers a word nobody
            // asked about, and there is no way to put it back.
            const LINES = [
                { startTime: 0, endTime: 2, text: 'alpha beta gamma' },
                { startTime: 30, endTime: 32, text: 'delta epsilon zeta' },
            ] as Subtitle[];

            const buildList = (playhead: number) => {
                state.displayMode = 'guess';
                state.addTrack('English', LINES);
                ui.renderSubtitles();
                // How the sidebar learns where playback is.
                ui.highlightSubtitle(playhead);
                return ui.elements.list!;
            };
            const itemAt = (list: Element, i: number) =>
                list.querySelector(`.vtt-item[data-index="${i}"]`) as HTMLElement;

            test('it seeks without revealing', () => {
                const list = buildList(0);
                itemAt(list, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));

                expect(mockApp.seekVideo).toHaveBeenCalledWith(30);
                expect(state.getRevealedCount(1)).toBe(1); // untouched
            });

            test('a click on the line you are already on still reveals', () => {
                const list = buildList(0);
                itemAt(list, 0).dispatchEvent(new MouseEvent('click', { bubbles: true }));

                expect(mockApp.seekVideo).toHaveBeenCalledWith(0);
                expect(state.getRevealedCount(0)).toBe(2);
            });

            test('the reach is time, not line count — a neighbour far in time only seeks', () => {
                // The two lines are adjacent in the transcript but 30s apart.
                // Counting lines would have called this "the next one over".
                const list = buildList(0);
                itemAt(list, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
                expect(state.getRevealedCount(1)).toBe(1);
            });

            test('once playback is there, the same line reveals', () => {
                const list = buildList(30);
                itemAt(list, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
                expect(state.getRevealedCount(1)).toBe(2);
            });

            test('a long cue stays revealable all the way through', () => {
                // Film cues routinely run 5-7s. Measuring only to startTime made
                // a line un-revealable once playback was REVEAL_REACH_S into it
                // — and the click then seeked BACKWARDS to the cue start, which
                // is the opposite of pressing the line you are watching. While
                // the playhead is inside the cue, the distance is zero.
                state.displayMode = 'guess';
                state.addTrack('English', [
                    { startTime: 0, endTime: 8, text: 'alpha beta gamma' },
                ] as Subtitle[]);
                ui.renderSubtitles();
                ui.highlightSubtitle(7); // 7s in — well past the 5s reach
                const list = ui.elements.list!;

                itemAt(list, 0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
                expect(state.getRevealedCount(0)).toBe(2);
            });

            test('a line just off the end of a long cue is still navigation', () => {
                // The clamp must not turn the reach into "anywhere near a long
                // line": past the cue's own end, the reach applies as before.
                state.displayMode = 'guess';
                state.addTrack('English', [
                    { startTime: 0, endTime: 8, text: 'alpha beta gamma' },
                    { startTime: 40, endTime: 42, text: 'delta epsilon zeta' },
                ] as Subtitle[]);
                ui.renderSubtitles();
                ui.highlightSubtitle(7);
                const list = ui.elements.list!;

                itemAt(list, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
                expect(mockApp.seekVideo).toHaveBeenCalledWith(40);
                expect(state.getRevealedCount(1)).toBe(1);
            });

            test('a jump then a second click on the same line reveals it', () => {
                // The video's currentTime lags a seek, so the sidebar records
                // where it sent playback. Without that, this second click would
                // still measure from the old position and refuse again.
                const list = buildList(0);

                itemAt(list, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
                expect(state.getRevealedCount(1)).toBe(1); // navigation

                itemAt(list, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
                expect(state.getRevealedCount(1)).toBe(2); // now it is the line you are on
            });

            // Each route in gets its own list: the first far-off interaction
            // moves the playhead, so a second one on the same line is no longer
            // far off — that is the intended behaviour, not a case to retest.
            test('a press on a masked word far away only seeks', () => {
                const list = buildList(0);
                const masked = itemAt(list, 1)
                    .querySelector('.vtt-masked-word') as HTMLElement;

                masked.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

                expect(mockApp.seekVideo).toHaveBeenCalledWith(30);
                expect(state.getRevealedCount(1)).toBe(1);
            });

            test('Enter on a line far away only seeks', () => {
                const list = buildList(0);

                itemAt(list, 1).dispatchEvent(new KeyboardEvent('keydown',
                    { key: 'Enter', bubbles: true, cancelable: true }));

                expect(mockApp.seekVideo).toHaveBeenCalledWith(30);
                expect(state.getRevealedCount(1)).toBe(1);
            });
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

        describe('peek: hovering a masked word holds it open', () => {
            const over = (el: Element, from: Element | null = null) =>
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }));
            const out = (el: Element, to: Node | null = null) =>
                el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
            // The capsule turns over to open: the text is swapped at the
            // halfway point of the flip, not on the hover itself, so these
            // tests have to let the timer run.
            const settleFlip = () => jest.advanceTimersByTime(200);

            beforeEach(() => jest.useFakeTimers());
            afterEach(() => jest.useRealTimers());

            test('the word shows under the cursor and hides again when it leaves', () => {
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                const filler = masked.textContent;
                expect(masked.classList.contains('vtt-peeked-word')).toBe(false);

                over(masked);
                settleFlip();
                expect(masked.textContent).toBe('beta');
                expect(masked.classList.contains('vtt-peeked-word')).toBe(true);

                out(masked);
                settleFlip();
                // Closing restores the resting text, which IS the word — the
                // capsule hides it with colour, not by holding another string
                // (see maskGlyphs). The peeked class is what changes.
                expect(masked.textContent).toBe(filler);
                expect(masked.classList.contains('vtt-peeked-word')).toBe(false);
            });

            test('the capsule itself never rotates — only its inner face does', () => {
                // A rotating span leaves the cursor's hit area at 90deg, so
                // Chrome fires mouseout, the capsule flops back under the
                // cursor, mouseover fires again — an endless flip against a
                // mouse that never moved, with the word never showing. The span
                // must stay flat and keep the hit area; only its contents turn.
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;

                over(masked);
                const face = masked.querySelector('.vtt-peek-face');
                expect(face).not.toBeNull();
                // The word lives inside the rotating layer, not on the span.
                expect(masked.firstElementChild).toBe(face);
                settleFlip();
                expect(face!.textContent).toBe('beta');
                // textContent still reads through the layer, so quick-add and
                // the reveal path see the same string they always did.
                expect(masked.textContent).toBe('beta');
            });

            test('the capsule is edge-on while the text is being swapped', () => {
                // The swap must land in the frame nobody can see: the filler and
                // the word are different widths, so a mid-flight resize would be
                // the one thing that gives the trick away.
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                const filler = masked.textContent;

                over(masked);
                // First half of the turn: still showing the frosted face.
                expect(masked.classList.contains('vtt-flipping')).toBe(true);
                expect(masked.textContent).toBe(filler);

                settleFlip();
                expect(masked.classList.contains('vtt-flipping')).toBe(false);
                expect(masked.textContent).toBe('beta');
            });

            test('a peek is looking, not answering: reveal state does not move', () => {
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                over(masked);
                out(masked);
                expect(state.getRevealedCount(0)).toBe(1);
                expect(masked.classList.contains('vtt-masked-word')).toBe(true);
            });

            test('a peeked word is still not saveable — data-word stays off', () => {
                // quick-add reads span[data-word]; only a word the user actually
                // revealed may be offered to the dictionary.
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                over(masked);
                settleFlip();
                expect(masked.dataset.word).toBeUndefined();
                expect(masked.dataset.hidden).toBe('beta');
            });

            test('moving between words peeks only the one under the cursor', () => {
                const overlay = buildGuessOverlay();
                const [beta, gamma] = Array.from(
                    overlay.querySelectorAll<HTMLElement>('.vtt-masked-word'));

                over(beta);
                settleFlip();
                out(beta, gamma);
                over(gamma, beta);
                settleFlip();
                // The capsule holds the real word at rest too (it is what sizes
                // the pane), so "is it open" is the peeked class, not the text.
                expect(beta.classList.contains('vtt-peeked-word')).toBe(false);
                expect(gamma.classList.contains('vtt-peeked-word')).toBe(true);
                expect(overlay.querySelectorAll('.vtt-peeked-word')).toHaveLength(1);
            });

            test('sliding straight from one capsule to the next closes the first', () => {
                // Both flips are in flight at once here. With a single shared
                // timer the opening one cancelled the closing one, and the word
                // left behind stayed face-up and mid-turn for good.
                const overlay = buildGuessOverlay();
                const [beta, gamma] = Array.from(
                    overlay.querySelectorAll<HTMLElement>('.vtt-masked-word'));
                const betaFiller = beta.textContent;

                over(beta);
                settleFlip();
                // No settle in between: the cursor leaves beta and lands on
                // gamma within the same frame.
                out(beta, gamma);
                over(gamma, beta);
                settleFlip();

                expect(beta.textContent).toBe(betaFiller);
                expect(beta.classList.contains('vtt-flipping')).toBe(false);
                expect(beta.classList.contains('vtt-peeked-word')).toBe(false);
                expect(gamma.textContent).toBe('gamma');
            });

            test('revealing while peeking leaves the word out, not re-masked', () => {
                // peekOff must never paint the filler back over a word the
                // reveal has just legitimately uncovered.
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                over(masked);
                settleFlip();
                masked.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
                masked.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
                out(masked);
                settleFlip();

                const spans = overlay.querySelectorAll<HTMLElement>('.vtt-revealed-word');
                expect(Array.from(spans, (s) => s.textContent)).toEqual(['alpha', 'beta']);
            });

            test('the sidebar does not peek — it is the overlay affordance', () => {
                // Peeking belongs to the line you are watching. The sidebar is a
                // transcript you scroll, and sweeping the cursor down it would
                // flip capsules the whole way.
                state.displayMode = 'guess';
                state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'alpha beta gamma' } as Subtitle]);
                ui.renderSubtitles();
                const item = ui.elements.list!.querySelector('.vtt-item[data-index="0"]') as HTMLElement;
                const masked = item.querySelector('.vtt-masked-word') as HTMLElement;
                const filler = masked.textContent;

                over(masked);
                settleFlip();
                expect(masked.textContent).toBe(filler);
                expect(masked.classList.contains('vtt-peeked-word')).toBe(false);
            });

            test('hover does nothing outside guess mode', () => {
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                state.displayMode = 'dual';
                over(masked);
                settleFlip();
                expect(masked.classList.contains('vtt-peeked-word')).toBe(false);
            });

            test('turning the overlay off and on again does not bring the peek back', () => {
                // The hidden overlay keeps its children, so the signature check
                // used to short-circuit the rebuild and hand back the capsule
                // that was open under the cursor — face-up, showing a word
                // nobody revealed, and with no cursor on it to close it.
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                over(masked);
                settleFlip();
                expect(masked.classList.contains('vtt-peeked-word')).toBe(true);

                state.overlayEnabled = false;
                ui.updateOverlay(0);
                state.overlayEnabled = true;
                ui.updateOverlay(0);
                settleFlip();

                const after = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                expect(after.classList.contains('vtt-peeked-word')).toBe(false);
                expect(overlay.querySelectorAll('.vtt-peeked-word')).toHaveLength(0);
            });

            test('the rotating layer is gone once the capsule is frosted again', () => {
                // A span at rest must be exactly the markup the rest of the code
                // expects — no leftover .vtt-peek-face wrapper.
                const overlay = buildGuessOverlay();
                const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;

                over(masked);
                settleFlip();
                expect(masked.querySelector('.vtt-peek-face')).not.toBeNull();

                out(masked);
                settleFlip();  // halfway swap
                settleFlip();  // the turn finishes and the layer is folded away
                expect(masked.querySelector('.vtt-peek-face')).toBeNull();
                expect(masked.textContent).toBe(masked.dataset.mask);
            });

            describe('reduced motion', () => {
                // The stylesheet already drops the rotation, but the halfway
                // timer is JS: left in, it gave anyone who asked for less motion
                // a 180ms dead zone with no feedback at all — worse than the
                // animation they turned off.
                const setReducedMotion = (on: boolean) => {
                    window.matchMedia = ((q: string) => ({
                        matches: on && q.includes('prefers-reduced-motion'),
                        media: q, onchange: null,
                        addListener: () => {}, removeListener: () => {},
                        addEventListener: () => {}, removeEventListener: () => {},
                        dispatchEvent: () => false,
                    })) as unknown as typeof window.matchMedia;
                };
                afterEach(() => {
                    delete (window as { matchMedia?: unknown }).matchMedia;
                });

                test('the word swaps on the hover itself, with no wait', () => {
                    setReducedMotion(true);
                    const overlay = buildGuessOverlay();
                    const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;

                    over(masked);
                    // No settleFlip: the swap must already have happened.
                    expect(masked.textContent).toBe('beta');
                    expect(masked.classList.contains('vtt-peeked-word')).toBe(true);
                    expect(masked.classList.contains('vtt-flipping')).toBe(false);
                });

                test('and closes just as immediately', () => {
                    setReducedMotion(true);
                    const overlay = buildGuessOverlay();
                    const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;
                    over(masked);
                    const filler = masked.dataset.mask;

                    out(masked);
                    expect(masked.textContent).toBe(filler);
                    expect(masked.classList.contains('vtt-peeked-word')).toBe(false);
                    expect(masked.querySelector('.vtt-peek-face')).toBeNull();
                });

                test('with motion allowed the turn still takes its time', () => {
                    setReducedMotion(false);
                    const overlay = buildGuessOverlay();
                    const masked = overlay.querySelector('.vtt-masked-word') as HTMLElement;

                    over(masked);
                    expect(masked.classList.contains('vtt-flipping')).toBe(true);
                    // Mid-turn the capsule is not peeked yet: the class, not
                    // the text, is what the swap moves (see maskGlyphs).
                    expect(masked.classList.contains('vtt-peeked-word')).toBe(false);
                    settleFlip();
                    expect(masked.classList.contains('vtt-peeked-word')).toBe(true);
                });
            });
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
            // Defaults: 100%/75% size, medium offset/bg, white/gold color, full opacity.
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('24px');
            expect(overlay.style.getPropertyValue('--vtt-overlay-sub-font-size')).toBe('18px');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bottom')).toBe('7.4%');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bg-opacity')).toBe('0.7');
            expect(overlay.style.getPropertyValue('--vtt-overlay-color')).toBe('#ffffff');
            expect(overlay.style.getPropertyValue('--vtt-overlay-sub-color')).toBe('#ffd700');
            expect(overlay.style.getPropertyValue('--vtt-overlay-text-opacity')).toBe('1');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bg-color')).toBe('#000000');
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-family')).toContain('Inter');
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-variant')).toBe('normal');
        });

        test('a size setter restyles the live overlay and persists the pref', async () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayFontSize(150);
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('36px');
            // Persisted via savePrefs (load→merge→set chain) → storage.local backing store.
            // Asserted through the resolved view rather than the raw blob: appearance
            // is stored per site (jsdom's host → the 'other' scope), and this test is
            // about the setter persisting, not about where the bytes sit.
            await new Promise((r) => setTimeout(r, 0));
            expect((await loadPrefs('other')).overlayFontSize).toBe(150);
        });

        test('the translation-line size setter is independent of the main size', async () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayFontSize(200);
            (ui as any).setOverlaySubFontSize(50);
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('48px');
            expect(overlay.style.getPropertyValue('--vtt-overlay-sub-font-size')).toBe('12px');
        });

        test('the translation-line color setter is independent of the main color', () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayColor('#00e5ff');
            (ui as any).setOverlaySubColor('#7CFC00');
            expect(overlay.style.getPropertyValue('--vtt-overlay-color')).toBe('#00e5ff');
            expect(overlay.style.getPropertyValue('--vtt-overlay-sub-color')).toBe('#7CFC00');
        });

        test('text opacity fades the glyph fill via a CSS var, not element opacity', () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayTextOpacity(0.5);
            expect(overlay.style.getPropertyValue('--vtt-overlay-text-opacity')).toBe('0.5');
            // Never element-level: that would fade the box behind the text too,
            // making it indistinguishable from the backdrop-opacity control.
            expect(overlay.style.opacity).toBe('');
        });

        test('the font family setter updates both the stack and the small-caps variant', () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayFontFamily('smallCaps');
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-variant')).toBe('small-caps');
            (ui as any).setOverlayFontFamily('monoSans');
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-variant')).toBe('normal');
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-family')).toContain('monospace');
        });

        test('the background color setter is independent of backdrop opacity', () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayBgColor('#ffffff');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bg-color')).toBe('#ffffff');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bg-opacity')).toBe('0.7'); // untouched
        });

        test('an offset preset setter maps low/high tokens to a share of player height', () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayBottomOffset('low');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bottom')).toBe('3.7%');
            (ui as any).setOverlayBottomOffset('high');
            expect(overlay.style.getPropertyValue('--vtt-overlay-bottom')).toBe('13%');
        });

        test('an offset preset lands at its fixed spot: the drag offset is cleared, not stacked', async () => {
            const overlay = buildOverlay();
            // The viewer dragged the caption away from center before clicking.
            await savePrefs({ overlayBottomNudge: 20, overlayInlineNudge: 5 }, 'other');
            (ui as any).position.load(20, 5);

            // 'medium' is the default, i.e. the ALREADY-ACTIVE segment: even a
            // re-click of the current preset must recenter the caption — the
            // buttons are also the way back after a drag.
            (ui as any).setOverlayBottomOffset('medium');

            expect(overlay.style.getPropertyValue('--vtt-overlay-bottom')).toBe('7.4%');
            expect(overlay.style.getPropertyValue('--vtt-overlay-nudge')).toBe('0%');
            expect(overlay.style.getPropertyValue('--vtt-overlay-inline-nudge')).toBe('0%');
            // The cleared offset is persisted too, or the old drag comes back
            // from prefs on the next load.
            await new Promise((r) => setTimeout(r, 0));
            const prefs = await loadPrefs('other');
            expect(prefs.overlayBottomNudge).toBe(0);
            expect(prefs.overlayInlineNudge).toBe(0);
        });

        test('edge style maps tokens to em-based text-shadow values', () => {
            const overlay = buildOverlay();
            // Default is 'shadow' (the pre-redesign hard-coded look, now in em so
            // it scales with the size slider instead of vanishing at 400%).
            // Already resolved against the default white text -> black edge.
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toBe('0.04em 0.04em 0.13em #000');
            (ui as any).setOverlayEdgeStyle('none');
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toBe('none');
            (ui as any).setOverlayEdgeStyle('outline');
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toContain('-0.045em -0.045em 0 #000');
        });

        test('the edge color contrasts with the TEXT, so it never vanishes into the box', () => {
            const overlay = buildOverlay();
            // Light text gets a dark edge so it stays legible where the box is
            // see-through and raw video shows behind it. The edge used to be a
            // hardcoded black, which disappeared against the default black box
            // and made the Edge control look like it did nothing.
            // Assert the SHIPPED edge value, not a colour variable: the rendered
            // text-shadow is what the user sees, and the first version of this
            // feature set the colour correctly while still painting the wrong
            // shadow, which these assertions could not see.
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toContain('#000');
            (ui as any).setOverlayColor('#000000'); // dark text -> light edge
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toContain('#fff');
            (ui as any).setOverlayColor('#ffffff'); // back to light text -> dark edge
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toContain('#000');
        });

        test("the translation line gets its own resolved edge, not the main line's", () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayColor('#ffffff');    // light main line -> dark edge
            (ui as any).setOverlaySubColor('#000000'); // dark sub line   -> light edge
            const main = overlay.style.getPropertyValue('--vtt-overlay-edge');
            const sub = overlay.style.getPropertyValue('--vtt-overlay-sub-edge');
            expect(main).toContain('#000');
            expect(sub).toContain('#fff');
            // Each must arrive ALREADY resolved. A var() left in here is
            // substituted on the parent against the main line's colour, so the
            // translation line would silently inherit the main line's edge.
            expect(main).not.toContain('var(');
            expect(sub).not.toContain('var(');
            expect(sub).not.toBe(main);
        });

        test('resetTextStyle restores text defaults with a single write, leaving box fields alone', async () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayFontSize(150);
            (ui as any).setOverlayBottomOffset('high'); // a box field — must survive the text reset
            await new Promise((r) => setTimeout(r, 0));

            ((global as any).chrome.storage.local.set as jest.Mock).mockClear();
            (ui as any).resetTextStyle();
            await new Promise((r) => setTimeout(r, 0));

            expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
            const stored = (prefsStore['prefs.v1'] as any).byPlatform.other;
            expect(stored).toMatchObject({
                overlayFontFamily: 'propSans',
                overlayFontSize: 100,
                overlayColor: '#ffffff',
                overlaySubFontSize: 75,
                overlaySubColor: '#ffd700',
                overlayTextOpacity: 1,
                overlayBottomOffset: 'high', // untouched by the text-only reset
            });
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('24px');
        });

        test('resetBoxStyle restores box defaults with a single write, leaving text fields alone', async () => {
            const overlay = buildOverlay();
            (ui as any).setOverlayEdgeStyle('outline');
            (ui as any).setOverlayFontSize(150); // a text field — must survive the box reset
            await new Promise((r) => setTimeout(r, 0));

            ((global as any).chrome.storage.local.set as jest.Mock).mockClear();
            (ui as any).resetBoxStyle();
            await new Promise((r) => setTimeout(r, 0));

            expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
            const stored = (prefsStore['prefs.v1'] as any).byPlatform.other;
            expect(stored).toMatchObject({
                overlayBgColor: '#000000',
                overlayBottomOffset: 'medium',
                overlayBgOpacity: 'medium',
                overlayEdgeStyle: 'shadow',
                overlayFontSize: 150, // untouched by the box-only reset
            });
            expect(overlay.style.getPropertyValue('--vtt-overlay-edge')).toBe('0.04em 0.04em 0.13em #000');
        });

        /**
         * The counter-half of the tested preset rule (§10.28, §11.6).
         *
         * Choosing a position preset deliberately clears a manual drag — that
         * has a check. Reset deliberately does NOT, and that had none: a
         * viewer who dragged the captions somewhere and then pressed Reset to
         * fix a colour keeps the position they chose.
         */
        test('the text reset leaves a dragged position where the viewer put it', async () => {
            (ui as any).position = { bottom: 20, inline: 5 };
            (ui as any).setOverlayFontSize(150);
            await new Promise((r) => setTimeout(r, 0));
            savePrefs({ overlayBottomNudge: 20, overlayInlineNudge: 5 }, 'other');
            await new Promise((r) => setTimeout(r, 0));

            (ui as any).resetTextStyle();
            await new Promise((r) => setTimeout(r, 0));

            const stored = (prefsStore['prefs.v1'] as any).byPlatform.other;
            expect(stored.overlayBottomNudge).toBe(20);
            expect(stored.overlayInlineNudge).toBe(5);
        });

        test('the box reset leaves it too — the likelier place to lose it', async () => {
            // A nudge reads as "box-ish", so a tidy-up that folds it into the
            // box defaults is the plausible regression.
            savePrefs({ overlayBottomNudge: 20, overlayInlineNudge: 5 }, 'other');
            await new Promise((r) => setTimeout(r, 0));

            (ui as any).resetBoxStyle();
            await new Promise((r) => setTimeout(r, 0));

            const stored = (prefsStore['prefs.v1'] as any).byPlatform.other;
            expect(stored.overlayBottomNudge).toBe(20);
            expect(stored.overlayInlineNudge).toBe(5);
        });

        test('choosing a position preset does clear it — the half that was tested', async () => {
            savePrefs({ overlayBottomNudge: 20, overlayInlineNudge: 5 }, 'other');
            await new Promise((r) => setTimeout(r, 0));

            (ui as any).setOverlayBottomOffset('high');
            await new Promise((r) => setTimeout(r, 0));

            const stored = (prefsStore['prefs.v1'] as any).byPlatform.other;
            expect(stored.overlayBottomNudge).toBe(0);
            expect(stored.overlayInlineNudge).toBe(0);
        });

        test('backdrop "off" is genuinely transparent, not merely faint', async () => {
            // §10.23. "Off" that resolved to a low opacity would look almost
            // right and quietly deny the one setting that makes the Edge
            // control the only thing keeping text legible over pale video.
            const overlay = buildOverlay();
            (ui as any).setOverlayBgOpacity('off');
            await new Promise((r) => setTimeout(r, 0));
            expect(overlay.style.getPropertyValue('--vtt-overlay-bg-opacity')).toBe('0');
        });

        test('neither reset touches overlayEnabled', async () => {
            state.overlayEnabled = false;
            (ui as any).resetTextStyle();
            (ui as any).resetBoxStyle();
            await new Promise((r) => setTimeout(r, 0));
            expect((await loadPrefs('other')).overlayEnabled).toBe(true); // default — never written by reset
        });

        /**
         * §10.26. Reset restores the site's OWN starting sizes, not the
         * generic ones — and every check above runs in the 'other' scope,
         * where those two are the same number. On YouTube and rezka they are
         * not: a fresh install starts at 160/110 there, because captions sized
         * for a web page read too small over a video player.
         *
         * So the whole point of the rule — the `PLATFORM_SIZE_DEFAULTS` merge
         * in resetTextStyle — sits outside what jsdom's host reaches, and an
         * audit reading only these tests reported a reset defect that does not
         * exist. The scope is a readonly field derived from location.hostname;
         * overriding it on the instance is the only way in without a second
         * jsdom environment for one behaviour.
         */
        test('on YouTube the text reset restores that site\'s larger sizes, not the generic ones', async () => {
            Object.defineProperty(ui, 'scope', { value: 'youtube', configurable: true });
            const overlay = buildOverlay();
            (ui as any).setOverlayFontSize(90);
            (ui as any).setOverlaySubFontSize(90);
            await new Promise((r) => setTimeout(r, 0));

            (ui as any).resetTextStyle();
            await new Promise((r) => setTimeout(r, 0));

            const stored = (prefsStore['prefs.v1'] as any).byPlatform.youtube;
            expect(stored.overlayFontSize).toBe(160);
            expect(stored.overlaySubFontSize).toBe(110);
            // Everything else still comes from the generic text defaults: the
            // site override is two sizes, not a second palette.
            expect(stored).toMatchObject({
                overlayFontFamily: 'propSans',
                overlayColor: '#ffffff',
                overlaySubColor: '#ffd700',
                overlayTextOpacity: 1,
            });
            // And the captions on screen actually move: 160% and 110% of the
            // 24px base. A write nobody applied would leave them at 90%.
            expect(overlay.style.getPropertyValue('--vtt-overlay-font-size')).toBe('38.4px');
            expect(overlay.style.getPropertyValue('--vtt-overlay-sub-font-size')).toBe('26.4px');
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
            // The pane renders the word itself, transparent, so it measures
            // exactly as wide as what it hides (see maskGlyphs) — data-word is
            // what keeps quick-add out, not the text.
            expect(spans[1].textContent).toBe('world');
            expect(spans[1].translate).toBe(false);

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

        test('the frosted pane is sized by the word itself, and marked do-not-translate', () => {
            // The capsule holds the real word painted transparent: it is the
            // only string that sizes the pane exactly like the word it hides,
            // so a peek does not shove the line around. Hiding is done by
            // colour, and a user who selects or copies it has chosen to look.
            // translate="no" is what stops the one reader that would expose it
            // WITHOUT being asked — a page translator rewriting the node.
            const line = 'photosynthesis sustains everything';
            const container = ui.buildMaskedContent(line, 0);
            const masked = container.querySelectorAll<HTMLElement>('.vtt-masked-word');
            expect(masked).toHaveLength(3);
            masked.forEach((span) => {
                expect(span.textContent).toBe(span.dataset.hidden);
                expect(span.translate).toBe(false);
                // Still off-limits to quick-add: only revealed words are
                // saveable, and a capsule carries no data-word.
                expect(span.dataset.word).toBeUndefined();
            });

            // The overlay repaints ~4x/sec; unstable text would make the line
            // shimmer, so the same word must always render the same.
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
            // Masked spans render the word transparent to size the pane, so
            // data-word — not the text — is what marks it unrevealed.
            expect(beta.dataset.word).toBeUndefined();
            expect(beta.translate).toBe(false);

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
            expect(beta.dataset.word).toBeUndefined();
            expect(beta.dataset.hidden).toBe('beta');
            // Re-masking must put the no-translate guard back with the word.
            expect(beta.translate).toBe(false);
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

        // The class is cosmetic; the move is what makes the panel visible at
        // all. Anything left under <body> is painted behind the fullscreen
        // element, so a panel that only gained the class is a panel nobody can
        // see — while every existing check here would still pass.
        test('entering fullscreen moves the panel inside the fullscreen element', () => {
            const sidebar = ui.elements.sidebar as HTMLDivElement;
            document.body.appendChild(sidebar);
            ui.setupFullscreenHandling();

            const fsEl = document.createElement('div');
            document.body.appendChild(fsEl);
            expect(fsEl.contains(sidebar)).toBe(false); // the premise, stated

            fireFullscreen(fsEl);
            expect(fsEl.contains(sidebar)).toBe(true);
            expect(sidebar.parentElement).toBe(fsEl);
        });

        // Back to where it came from, which is not always <body>: embedded in a
        // page the panel belongs to a layout column, and returning it to <body>
        // there leaves it fixed against the whole document.
        test('leaving fullscreen returns the panel to the parent it came from', async () => {
            const home = document.createElement('div');
            home.id = 'its-own-column';
            document.body.appendChild(home);
            const sidebar = ui.elements.sidebar as HTMLDivElement;
            home.appendChild(sidebar);
            ui.setupFullscreenHandling();

            const fsEl = document.createElement('div');
            document.body.appendChild(fsEl);

            fireFullscreen(fsEl);
            expect(sidebar.parentElement).toBe(fsEl);

            fireFullscreen(null);
            await flush();
            expect(sidebar.parentElement).toBe(home);
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

        // savePrefs is read-modify-write: two awaited gets stand between the
        // call and the set. This used to read prefsStore synchronously and pass
        // on a write left behind by an earlier test, which is why adding an
        // awaited test above it broke this one.
        test('openPanel expands a collapsed sidebar and persists it', async () => {
            ui.toggleCollapsed();
            expect(ui.isCollapsed()).toBe(true);
            ui.openPanel();
            expect(ui.isCollapsed()).toBe(false);
            for (let i = 0; i < 20; i++) await Promise.resolve();
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

    // ── Position arrows ──────────────────────────────────────────────────
    // The arrows only exist while the settings panel is open, and the caption
    // block has to stay on screen the whole time they do — otherwise the
    // control vanishes under the pointer that is dragging it.
    describe('drag grip and caption preview', () => {
        const mountPlayer = () => {
            const video = document.createElement('video');
            const container = document.createElement('div');
            container.appendChild(video);
            document.body.appendChild(container);
        };
        beforeEach(() => {
            state.overlayEnabled = true;
            mountPlayer();
        });

        test('the grip fuses above the caption and survives the ~4x/sec rebuild', () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);
            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;

            const row = overlay.querySelector('.vtt-overlay-row') as HTMLElement;
            expect(row).not.toBeNull();
            // Grip above the caption: it fuses to the box's top edge, and the
            // caption keeps the player's centre line to itself.
            expect(Array.from(row.children).map((c) => c.className))
                .toEqual(['vtt-overlay-handle', 'vtt-overlay-main']);

            // A control the user may be holding must not be recreated under
            // them: the same element has to come back after a rebuild.
            const grip = row.querySelector('.vtt-overlay-handle');
            state.addTrack('Second', [{ startTime: 0, endTime: 2, text: 'Bonjour' } as Subtitle]);
            ui.updateOverlay(0);
            expect(document.querySelector('#vtt-video-overlay .vtt-overlay-handle')).toBe(grip);
        });

        test('the grip is marked visible only while the settings panel is open', () => {
            // jsdom applies no stylesheet, so the assertion is on the class the
            // stylesheet keys the reveal off — .vtt-overlay-adjusting on the
            // overlay, which is display:none/flex for the grip.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);
            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            expect(overlay.classList.contains('vtt-overlay-adjusting')).toBe(false);
            // The grip stays in the DOM either way: it must survive the ~4x/sec
            // rebuild so a live drag is never torn out from under the pointer.
            expect(overlay.querySelector('.vtt-overlay-handle')).not.toBeNull();

            ui.setOverlayAdjusting(true);
            expect(overlay.classList.contains('vtt-overlay-adjusting')).toBe(true);
            expect(overlay.querySelector('.vtt-overlay-handle')).not.toBeNull();

            ui.setOverlayAdjusting(false);
            expect(overlay.classList.contains('vtt-overlay-adjusting')).toBe(false);
        });

        test('between cues, the panel borrows the nearest line rather than going blank', () => {
            state.addTrack('English', [
                { startTime: 0, endTime: 2, text: 'First' },
                { startTime: 30, endTime: 32, text: 'Far away' },
            ] as Subtitle[]);

            // Playhead in the gap: no cue is active, so index is -1.
            ui.highlightSubtitle(3);
            expect(state.currentIndex).toBe(-1);
            ui.setOverlayAdjusting(true);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            // 'First' ends at 2s and is 1s away; 'Far away' starts at 30s.
            expect(overlay.querySelector('.vtt-overlay-main')?.textContent).toBe('First');
            // A real line, so it is not dimmed as a stand-in.
            expect(overlay.querySelector('.vtt-overlay-placeholder')).toBeNull();
        });

        test('the borrowed line follows the playhead instead of freezing', () => {
            state.addTrack('English', [
                { startTime: 0, endTime: 2, text: 'First' },
                { startTime: 30, endTime: 32, text: 'Far away' },
            ] as Subtitle[]);

            ui.highlightSubtitle(3);
            ui.setOverlayAdjusting(true);
            const main = () => document.querySelector('#vtt-video-overlay .vtt-overlay-main')?.textContent;
            expect(main()).toBe('First');

            // Still between cues, but now nearer the second one. The signature
            // used to be the constant 'empty' here, which froze this preview.
            ui.highlightSubtitle(29);
            expect(state.currentIndex).toBe(-1);
            expect(main()).toBe('Far away');
        });

        test('with no track at all, a stand-in keeps the block on screen', () => {
            ui.setOverlayAdjusting(true);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const main = overlay.querySelector('.vtt-overlay-main');
            expect(main?.textContent).toBeTruthy();
            // Marked as a sample, so nobody positions against text they think
            // will play.
            expect(main?.classList.contains('vtt-overlay-placeholder')).toBe(true);
        });

        test('caption clicks never reach the player, but bare video still does', () => {
            // The overlay is a child of the player, which toggles playback on a
            // click anywhere inside itself. Clicking a subtitle to select a word
            // used to pause the video as a side effect.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            const heard: string[] = [];
            for (const t of ['mousedown', 'mouseup', 'click', 'dblclick']) {
                player.addEventListener(t, (e) => heard.push(`${t}:${(e.target as Element).className}`));
            }

            const main = overlay.querySelector('.vtt-overlay-main') as HTMLElement;
            for (const t of ['mousedown', 'mouseup', 'click', 'dblclick']) {
                main.dispatchEvent(new MouseEvent(t, { bubbles: true }));
            }
            expect(heard).toEqual([]);

            // The overlay spans the full player width, so a press on the bare
            // strip beside a short caption must still reach the player.
            for (const t of ['mousedown', 'click']) {
                overlay.dispatchEvent(new MouseEvent(t, { bubbles: true }));
            }
            expect(heard).toHaveLength(2);
        });

        test('blocking the player does not block text selection', () => {
            // Quick-add selects words out of the caption, which needs the
            // browser's default mousedown behaviour left intact — so the
            // isolation above stops propagation only, never the default.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);

            const main = document.querySelector('#vtt-video-overlay .vtt-overlay-main') as HTMLElement;
            const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            main.dispatchEvent(down);
            expect(down.defaultPrevented).toBe(false);
        });

        test('a drag cannot push the caption off the top of the player', () => {
            // The bug: the ceiling was measured against the caption's BOTTOM
            // edge, so the block itself kept going past the top of the frame —
            // and the grip went with it, leaving no way to drag it back.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            // jsdom reports 0 for every box, so state the geometry outright:
            // a 400px player carrying an 80px (20%) caption block.
            Object.defineProperty(player, 'offsetHeight', { value: 400, configurable: true });
            Object.defineProperty(overlay, 'offsetHeight', { value: 80, configurable: true });

            const grip = overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
            grip.setPointerCapture = jest.fn();
            grip.releasePointerCapture = jest.fn();
            const fire = (type: string, y: number) =>
                grip.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: 100, clientY: y }));

            // Yank far past the top of the frame.
            fire('pointerdown', 400);
            fire('pointermove', -4000);
            fire('pointerup', -4000);

            // preset 7.4% + nudge + block 20% must leave a margin at the top.
            const nudge = parseFloat(overlay.style.getPropertyValue('--vtt-overlay-nudge'));
            expect(7.4 + nudge + 20).toBeLessThanOrEqual(97.5 + 0.01);
        });

        test('a stored position that no longer fits is painted inside the frame', () => {
            // Nothing need be dragged for this: the player can shrink (leaving
            // fullscreen), or the caption can grow a translation row, and a
            // value saved when it did fit is suddenly off-screen.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);
            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            Object.defineProperty(player, 'offsetHeight', { value: 400, configurable: true });
            Object.defineProperty(overlay, 'offsetHeight', { value: 80, configurable: true });

            (ui as any).position.load(90, 0); // way past the ceiling
            (ui as any).applyOverlayStyle();

            const nudge = parseFloat(overlay.style.getPropertyValue('--vtt-overlay-nudge'));
            expect(7.4 + nudge + 20).toBeLessThanOrEqual(97.5 + 0.01);
        });

        test('a cue too tall to honour the position does not overwrite it', () => {
            // The bug this guards: the clamp used to be written back over the
            // stored value on every rebuild, so one long wrapped cue permanently
            // collapsed the position the user had chosen — and nothing restored
            // it, so the caption walked to the centre over one film.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);
            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            Object.defineProperty(player, 'offsetHeight', { value: 400, configurable: true });

            (ui as any).position.load(40, 0);

            // A tall cue: the block cannot sit 40% up, so it is painted lower.
            Object.defineProperty(overlay, 'offsetHeight', { value: 240, configurable: true });
            (ui as any).applyOverlayStyle();
            const squeezed = parseFloat(overlay.style.getPropertyValue('--vtt-overlay-nudge'));
            expect(squeezed).toBeLessThan(40);
            // ...but the user's choice is untouched.
            expect((ui as any).position.bottom).toBe(40);

            // The next line is short again, and the caption goes back where it
            // was put — the whole point of keeping intent apart from paint.
            Object.defineProperty(overlay, 'offsetHeight', { value: 40, configurable: true });
            (ui as any).applyOverlayStyle();
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-nudge'))).toBeCloseTo(40, 2);
        });

        test('dragging the grip moves the captions and persists on release', () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const grip = overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
            grip.setPointerCapture = jest.fn();
            grip.releasePointerCapture = jest.fn();
            const nudge = () => parseFloat(overlay.style.getPropertyValue('--vtt-overlay-nudge'));
            const fire = (type: string, y: number) =>
                grip.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: 100, clientY: y }));

            // Upward 54px. jsdom has no layout, so pxToPct falls back to the
            // 1080 reference height.
            fire('pointerdown', 200);
            fire('pointermove', 146);
            expect(overlay.classList.contains('vtt-drag-active')).toBe(true);
            expect(nudge()).toBeCloseTo(54 / 1080 * 100, 2);
            fire('pointerup', 146);
            expect(overlay.classList.contains('vtt-drag-active')).toBe(false);
            expect(overlay.style.getPropertyValue('--vtt-overlay-nudge')).toMatch(/%$/);
        });

        test('closing the panel mid-drag ends the gesture and saves', async () => {
            // The panel closing hides the grip, which kills its pointer capture:
            // the pointerup never arrives. Left alone, the drag stayed flagged
            // open, .vtt-drag-active stuck on the overlay, and the release never
            // wrote — the move the user just made was silently lost.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.setOverlayAdjusting(true);
            ui.updateOverlay(0);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const grip = overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
            grip.setPointerCapture = jest.fn();
            grip.releasePointerCapture = jest.fn();
            const fire = (type: string, y: number) =>
                grip.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: 100, clientY: y }));

            fire('pointerdown', 200);
            fire('pointermove', 146);
            expect(overlay.classList.contains('vtt-drag-active')).toBe(true);

            ui.setOverlayAdjusting(false);

            expect(overlay.classList.contains('vtt-drag-active')).toBe(false);
            expect(grip.classList.contains('vtt-dragging')).toBe(false);
            await new Promise((r) => setTimeout(r, 0));
            expect((await loadPrefs('other')).overlayBottomNudge).toBeCloseTo(54 / 1080 * 100, 2);
        });

        test('a release still saves when the capture is already gone', async () => {
            // pointercancel can arrive after the capture has been dropped, and
            // releasePointerCapture then throws NotFoundError. Unguarded, that
            // threw straight past the savePrefs below it.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const grip = overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
            grip.setPointerCapture = jest.fn();
            grip.releasePointerCapture = jest.fn(() => {
                throw new Error('NotFoundError');
            });
            const fire = (type: string, y: number) =>
                grip.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: 100, clientY: y }));

            fire('pointerdown', 200);
            fire('pointermove', 146);
            expect(() => fire('pointercancel', 146)).not.toThrow();

            expect(overlay.classList.contains('vtt-drag-active')).toBe(false);
            await new Promise((r) => setTimeout(r, 0));
            expect((await loadPrefs('other')).overlayBottomNudge).toBeCloseTo(54 / 1080 * 100, 2);
        });

        test('a preview line is never drawn as a guess puzzle', () => {
            // The preview borrows the nearest cue while the panel is open, but
            // it carries no guess state and its index is often -1.
            // getRevealedCount(-1) answers 1, so a solved line came back
            // re-masked — and clicking it did nothing, since there is no cue at
            // that index to reveal.
            state.displayMode = 'guess';
            state.addTrack('English', [{ startTime: 10, endTime: 12, text: 'Hello there friend' } as Subtitle]);
            ui.setOverlayAdjusting(true);
            // -1: the playhead sits before the first cue, so there is no line to
            // show and the preview stands in for one.
            ui.updateOverlay(-1);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const main = overlay.querySelector('.vtt-overlay-main') as HTMLElement;
            expect(main).not.toBeNull();
            expect(main.querySelector('.vtt-masked-word')).toBeNull();
            // No index either: a click here must not reach a real cue's puzzle.
            expect(main.dataset.index).toBeUndefined();
        });

        test('one drag moves the captions in both axes', async () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            // A 1000x400 player carrying a 200px (20%) wide caption block, so
            // there is real room to travel sideways: (100 - 20) / 2 - 4 = 36%.
            Object.defineProperty(player, 'offsetWidth', { value: 1000, configurable: true });
            Object.defineProperty(player, 'offsetHeight', { value: 400, configurable: true });
            const main = overlay.querySelector('.vtt-overlay-main') as HTMLElement;
            Object.defineProperty(main, 'offsetWidth', { value: 200, configurable: true });
            // The row is a full-width track, exactly as the stylesheet leaves
            // it. Pinned here so that measuring it again — which pinned every
            // sideways drag to zero travel — fails these tests instead of
            // shipping.
            const row = overlay.querySelector('.vtt-overlay-row') as HTMLElement;
            Object.defineProperty(row, 'offsetWidth', { value: 1000, configurable: true });
            Object.defineProperty(overlay, 'offsetHeight', { value: 40, configurable: true });

            const grip = overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
            grip.setPointerCapture = jest.fn();
            grip.releasePointerCapture = jest.fn();
            const fire = (type: string, x: number, y: number) =>
                grip.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: x, clientY: y }));

            // A diagonal pull: 150px right, 40px up. Each axis is measured
            // against its own dimension — x against the 1000px width, y against
            // the 400px height.
            fire('pointerdown', 500, 200);
            fire('pointermove', 650, 160);
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-inline-nudge')))
                .toBeCloseTo(15, 2);
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-nudge')))
                .toBeCloseTo(10, 2);

            // Both axes are persisted by the one release, not just the one the
            // pointer moved furthest in.
            fire('pointerup', 650, 160);
            await new Promise((r) => setTimeout(r, 0));
            const saved = await loadPrefs('other');
            expect(saved.overlayInlineNudge).toBeCloseTo(15, 2);
            expect(saved.overlayBottomNudge).toBeCloseTo(10, 2);
        });

        test('a sideways drag cannot push the caption out of the frame', () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);

            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            Object.defineProperty(player, 'offsetWidth', { value: 1000, configurable: true });
            Object.defineProperty(player, 'offsetHeight', { value: 400, configurable: true });
            // A wide caption: 60% of the width, so only (100 - 60) / 2 - 4 = 16%
            // of travel exists on either side.
            const main = overlay.querySelector('.vtt-overlay-main') as HTMLElement;
            Object.defineProperty(main, 'offsetWidth', { value: 600, configurable: true });
            // The row is a full-width track, exactly as the stylesheet leaves
            // it. Pinned here so that measuring it again — which pinned every
            // sideways drag to zero travel — fails these tests instead of
            // shipping.
            const row = overlay.querySelector('.vtt-overlay-row') as HTMLElement;
            Object.defineProperty(row, 'offsetWidth', { value: 1000, configurable: true });

            const grip = overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
            grip.setPointerCapture = jest.fn();
            grip.releasePointerCapture = jest.fn();
            const fire = (type: string, x: number) =>
                grip.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: x, clientY: 200 }));

            fire('pointerdown', 500);
            fire('pointermove', 9000);
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-inline-nudge'))).toBeCloseTo(16, 2);
            fire('pointermove', -9000);
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-inline-nudge'))).toBeCloseTo(-16, 2);
            fire('pointerup', -9000);
        });

        test('a stored sideways position is pulled back when the caption grows wider', () => {
            // The horizontal bound moves with the TEXT: a position that fits a
            // short line is out of frame for a long one, and nothing was
            // dragged in between.
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);
            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            Object.defineProperty(player, 'offsetWidth', { value: 1000, configurable: true });
            Object.defineProperty(player, 'offsetHeight', { value: 400, configurable: true });
            const main = overlay.querySelector('.vtt-overlay-main') as HTMLElement;
            Object.defineProperty(main, 'offsetWidth', { value: 900, configurable: true });
            // The row is a full-width track, exactly as the stylesheet leaves
            // it. Pinned here so that measuring it again — which pinned every
            // sideways drag to zero travel — fails these tests instead of
            // shipping.
            const row = overlay.querySelector('.vtt-overlay-row') as HTMLElement;
            Object.defineProperty(row, 'offsetWidth', { value: 1000, configurable: true });

            (ui as any).position.load(0, 40);
            (ui as any).applyOverlayStyle();

            // 90% wide leaves (100 - 90) / 2 - 4 = 1%.
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-inline-nudge'))).toBeCloseTo(1, 2);
            // Painted at 1%, but the stored 40% survives for the next short line.
            expect((ui as any).position.inline).toBe(40);
        });

        test('left and right arrows move the captions sideways', async () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' } as Subtitle]);
            ui.updateOverlay(0);
            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            Object.defineProperty(player, 'offsetWidth', { value: 1000, configurable: true });
            const main = overlay.querySelector('.vtt-overlay-main') as HTMLElement;
            Object.defineProperty(main, 'offsetWidth', { value: 200, configurable: true });
            // The row is a full-width track, exactly as the stylesheet leaves
            // it. Pinned here so that measuring it again — which pinned every
            // sideways drag to zero travel — fails these tests instead of
            // shipping.
            const row = overlay.querySelector('.vtt-overlay-row') as HTMLElement;
            Object.defineProperty(row, 'offsetWidth', { value: 1000, configurable: true });

            const grip = overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
            const key = (k: string, shiftKey = false) =>
                grip.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));

            key('ArrowRight');
            // 4px on a 1000px player.
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-inline-nudge'))).toBeCloseTo(0.4, 2);
            key('ArrowLeft', true);
            expect(parseFloat(overlay.style.getPropertyValue('--vtt-overlay-inline-nudge'))).toBeCloseTo(-1.6, 2);
            // No release to batch on, so each keystroke writes.
            await new Promise((r) => setTimeout(r, 0));
            expect((await loadPrefs('other')).overlayInlineNudge).toBeCloseTo(-1.6, 2);
        });
    });

    // Who owns #vtt-sidebar when one is already on the page. Two cases share
    // the id and want opposite handling: a rival copy of the extension (yield,
    // or the two graft into one franken-panel) and our own panel left behind by
    // the instance a reload just orphaned (reclaim, or the fresh instance never
    // starts and the page keeps a dead panel forever).
    describe('sidebar ownership', () => {
        beforeEach(() => {
            document.body.innerHTML = '';
        });

        test('stamps the panel it builds with its own extension id', () => {
            const ui = new SidebarUI(new AppState(), mockApp);
            expect(ui.init()).toBe(true);
            expect(document.getElementById('vtt-sidebar')!.dataset.vttOwner).toBe('test-extension-id');
        });

        // The franken-UI guard: a panel built by a different installed copy is
        // left strictly alone.
        test('yields to a sidebar owned by another extension copy', () => {
            const foreign = document.createElement('div');
            foreign.id = 'vtt-sidebar';
            foreign.dataset.vttOwner = 'some-other-extension-id';
            foreign.dataset.marker = 'untouched';
            document.body.appendChild(foreign);

            const ui = new SidebarUI(new AppState(), mockApp);
            expect(ui.init()).toBe(false);
            // Same element, unmodified — not rebuilt, not adopted.
            const after = document.getElementById('vtt-sidebar')!;
            expect(after.dataset.marker).toBe('untouched');
            expect(document.querySelectorAll('#vtt-sidebar')).toHaveLength(1);
        });

        // An unstamped panel predates this mechanism. Deleting it is the
        // destructive reading (it could be a live rival's), so the build is
        // still yielded — but the id is claimed, which is what makes a LATER
        // reload able to tell the panel apart and reclaim it.
        test('claims an unstamped sidebar but yields the build', () => {
            const legacy = document.createElement('div');
            legacy.id = 'vtt-sidebar';
            legacy.dataset.marker = 'untouched';
            document.body.appendChild(legacy);

            expect(new SidebarUI(new AppState(), mockApp).init()).toBe(false);

            const after = document.getElementById('vtt-sidebar')!;
            expect(after.dataset.marker).toBe('untouched'); // not rebuilt
            expect(after.dataset.vttOwner).toBe('test-extension-id');
            expect(document.querySelectorAll('#vtt-sidebar')).toHaveLength(1);
        });

        // The rollout case this whole mechanism exists for: the build being
        // replaced stamped nothing, so on the auto-update that ships stamping
        // the leftover panel is unstamped AND dead. Owning it is not required to
        // explain it — the notice renders into the corpse on screen.
        test('announces on an unstamped sidebar whose context is gone', () => {
            const legacy = document.createElement('div');
            legacy.id = 'vtt-sidebar';
            const subheader = document.createElement('div');
            subheader.id = 'vtt-subheader';
            legacy.appendChild(subheader);
            document.body.appendChild(legacy);

            const saved = (globalThis as any).chrome;
            (globalThis as any).chrome = { runtime: {} }; // orphaned: no id
            try {
                expect(new SidebarUI(new AppState(), mockApp).init()).toBe(false);
            } finally {
                (globalThis as any).chrome = saved;
            }

            expect(document.getElementById('vtt-orphan-notice')).not.toBeNull();
        });

        // The reload case: our own orphaned panel is replaced, so the fresh
        // instance owns the page and its watcher/handlers actually run.
        test('reclaims its own orphaned sidebar', () => {
            const stale = document.createElement('div');
            stale.id = 'vtt-sidebar';
            stale.dataset.vttOwner = 'test-extension-id';
            stale.dataset.marker = 'stale';
            document.body.appendChild(stale);
            const staleToggle = document.createElement('div');
            staleToggle.id = 'vtt-toggle-btn';
            document.body.appendChild(staleToggle);

            const ui = new SidebarUI(new AppState(), mockApp);
            expect(ui.init()).toBe(true);

            const fresh = document.getElementById('vtt-sidebar')!;
            expect(fresh.dataset.marker).toBeUndefined(); // rebuilt, not reused
            expect(fresh.dataset.vttOwner).toBe('test-extension-id');
            // Exactly one of each: the stale toggle button goes with the panel,
            // or the page keeps a second tab that opens nothing.
            expect(document.querySelectorAll('#vtt-sidebar')).toHaveLength(1);
            expect(document.querySelectorAll('#vtt-toggle-btn')).toHaveLength(1);
        });

        // The overlay lives in the PLAYER, not the sidebar subtree, so removing
        // the panel leaves it standing. updateOverlay() then adopts it by id
        // along with the dead instance's listeners — the orphaned heap is still
        // alive, only chrome.* died — so guess-mode clicks would act on stale
        // state. destroy() drops all three; the reclaim path has to match.
        test('reclaim clears the stale video overlay too', () => {
            const stale = document.createElement('div');
            stale.id = 'vtt-sidebar';
            stale.dataset.vttOwner = 'test-extension-id';
            document.body.appendChild(stale);
            const overlay = document.createElement('div');
            overlay.id = 'vtt-video-overlay';
            overlay.dataset.sig = 'stale-signature';
            document.body.appendChild(overlay);

            expect(new SidebarUI(new AppState(), mockApp).init()).toBe(true);

            expect(document.getElementById('vtt-video-overlay')).toBeNull();
        });
    });


    // ── Word-screen WIRING ─────────────────────────────────────────────────
    // The screen's own behaviour is tested in word-screen.test.ts against a
    // fake port. These two stay here because a fake port cannot catch a
    // mis-wired delegator: they are the only tests that run the real chain
    // from a SidebarUI entry point, through the host object built in this
    // class, into the screen.
    describe('word screen wiring', () => {
        beforeEach(() => {
            ui.elements = {
                ...ui.elements,
                lookupPanel: document.createElement('div') as HTMLDivElement,
            };
        });

        it('the collapse tab reaches the screen, which closes instead of collapsing', () => {
            ui.openLookupScreen('main', 'the main sail');
            expect(ui.elements.sidebar!.classList.contains('vtt-lookup-open')).toBe(true);
            ui.onToggleTab();
            expect(ui.elements.sidebar!.classList.contains('vtt-lookup-open')).toBe(false);
            expect(ui.isCollapsed()).toBe(false);
        });

        // The word screen is reached from the transcript, not from settings, so
        // the gear can be pressed while it is up. Both takeovers would then be
        // open at once and their back chips, which share a position, overlap —
        // clicking the visible one becomes a coin flip on z-order.
        it('opening settings closes the word screen — takeovers never stack', () => {
            ui.elements.settingsPanel = document.createElement('div') as HTMLDivElement;
            ui.elements.titleEl = document.createElement('h2') as HTMLHeadingElement;
            ui.openLookupScreen('main', 'the main sail');
            ui.toggleSettingsPanel();
            expect(ui.elements.sidebar!.classList.contains('vtt-settings-open')).toBe(true);
            expect(ui.elements.sidebar!.classList.contains('vtt-lookup-open')).toBe(false);
            expect(ui.elements.titleEl!.textContent).toBe('Settings');
        });
    });

});

/**
 * A sidebar built WITHOUT a word screen.
 *
 * The marketing-site embed reuses this class but has no service worker to
 * route LOOKUP_WORD through, so it constructs one with no word-screen factory
 * and the feature's code never enters its bundle.
 *
 * These tests exist because that configuration has a failure mode nothing else
 * can see: the embed re-parents #vtt-toggle-btn onto its own tab slot, and the
 * tab's handler is onToggleTab — whose first branch is word-screen logic. If
 * that branch does not degrade, the demo's panel silently stops collapsing on
 * a public page, and every extension test still passes because the extensions
 * always have the screen.
 */
describe('SidebarUI without a word screen (the embed configuration)', () => {
    let ui: SidebarUI;

    beforeEach(() => {
        document.body.innerHTML = '<div id="vtt-list"></div><div id="vtt-sidebar"></div>';
        // No third argument — exactly how packages/embed constructs it.
        ui = new SidebarUI(new AppState(), { seekVideo: jest.fn(), updateHighlight: jest.fn() });
        ui.elements = {
            list: document.getElementById('vtt-list') as HTMLDivElement,
            sidebar: document.getElementById('vtt-sidebar') as HTMLDivElement,
        };
    });

    it('the collapse tab still collapses and expands the panel', () => {
        expect(ui.isCollapsed()).toBe(false);
        ui.onToggleTab();
        expect(ui.isCollapsed()).toBe(true);
        ui.onToggleTab();
        expect(ui.isCollapsed()).toBe(false);
    });

    it('opening the word screen is a silent no-op, not a throw', () => {
        expect(() => ui.openLookupScreen('anchor', 'drop the anchor')).not.toThrow();
        expect(ui.elements.sidebar!.classList.contains('vtt-lookup-open')).toBe(false);
    });

    it('closing one is a no-op too, from any entry point', () => {
        expect(() => ui.closeLookupScreen()).not.toThrow();
        expect(() => ui.destroy()).not.toThrow();
    });

    it('builds neither the word-screen panel nor its back chip', () => {
        document.body.innerHTML = '';
        const bare = new SidebarUI(new AppState(), { seekVideo: jest.fn(), updateHighlight: jest.fn() });
        bare.init();
        expect(document.getElementById('vtt-lookup-panel')).toBeNull();
        expect(document.getElementById('vtt-lookup-back-btn')).toBeNull();
        // The chassis itself is unaffected.
        expect(document.getElementById('vtt-sidebar')).not.toBeNull();
        expect(document.getElementById('vtt-toggle-btn')).not.toBeNull();
        bare.destroy();
    });
});

/**
 * Native-caption suppression — behaviour map §4.3 and §4.5.
 *
 * The site's own captions are turned off ONCE per video so the two subtitle
 * layers don't overlap. Deliberately not a permanent hide: a viewer who turns
 * them back on is left alone until the next video.
 *
 * Three separate decisions live in that sentence — once, per video, and only
 * while our overlay is on — and none of them had a check. Flattening them into
 * "always off" is a plausible refactor that would make the product argue with
 * every viewer who wants the site's captions.
 */
describe('native captions', () => {
    let state: AppState, ui: SidebarUI, app: AppInterface, setNative: jest.Mock;

    beforeEach(() => {
        document.body.innerHTML = '<div id="vtt-list"></div><div id="vtt-sidebar"></div>';
        state = new AppState();
        state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'hello' }]);
        setNative = jest.fn();
        app = { seekVideo: jest.fn(), updateHighlight: jest.fn(), setNativeSubtitlesEnabled: setNative };
        ui = new SidebarUI(state, app);
        ui.elements = {
            list: document.getElementById('vtt-list') as HTMLDivElement,
            sidebar: document.getElementById('vtt-sidebar') as HTMLDivElement,
            overlayBtn: { classList: { toggle: jest.fn() } } as any,
            dualBtn: { classList: { toggle: jest.fn() } } as any,
            settingsBtn: document.createElement('button'),
            mainSelect: { innerHTML: '', appendChild: jest.fn() } as any,
            subSelect: { innerHTML: '', appendChild: jest.fn() } as any,
        };
    });

    test('the first refresh turns the site\'s captions off', () => {
        state.overlayEnabled = true;
        ui.refresh();
        expect(setNative).toHaveBeenCalledTimes(1);
        expect(setNative).toHaveBeenCalledWith(false);
    });

    test('a second refresh does not turn them off again', () => {
        state.overlayEnabled = true;
        ui.refresh();
        ui.refresh();
        ui.refresh();
        // Once per video, not once per repaint — the sidebar refreshes several
        // times a second while a video plays.
        expect(setNative).toHaveBeenCalledTimes(1);
    });

    test('a new video re-arms the suppression', () => {
        state.overlayEnabled = true;
        ui.refresh();
        ui.resetNativeSubsGuard();
        ui.refresh();
        expect(setNative).toHaveBeenCalledTimes(2);
    });

    test('turning our overlay off and on again re-arms it', () => {
        state.overlayEnabled = true;
        ui.refresh();
        state.overlayEnabled = false;
        ui.refresh(); // re-arms
        state.overlayEnabled = true;
        ui.refresh(); // suppresses again
        expect(setNative).toHaveBeenCalledTimes(2);
    });

    test('with our overlay off, the site\'s captions are never touched', () => {
        state.overlayEnabled = false;
        ui.refresh();
        ui.refresh();
        ui.refresh();
        expect(setNative).not.toHaveBeenCalled();
    });

    test('the site\'s captions are never turned back on for the viewer', () => {
        // Turning them on is the viewer's business. The product only ever
        // steps out of the way; it does not restore what it did not choose.
        state.overlayEnabled = true;
        ui.refresh();
        state.overlayEnabled = false;
        ui.refresh();
        state.overlayEnabled = true;
        ui.refresh();
        ui.resetNativeSubsGuard();
        ui.refresh();
        expect(setNative.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    });
});

// Three decisions the settings screen makes whose other half is already
// covered: what it refuses to remember, what it tears down on the way out,
// and what it refuses to offer before there is anything to apply it to.
describe('the settings screen', () => {
    let ui: SidebarUI, state: AppState;

    beforeEach(() => {
        document.body.innerHTML = '';
        (chrome.storage.local.set as jest.Mock).mockClear();
        for (const k of Object.keys(prefsStore)) delete prefsStore[k];
        state = new AppState();
        ui = new SidebarUI(state, { seekVideo: jest.fn(), updateHighlight: jest.fn() });
        expect(ui.init()).toBe(true);
    });

    // Being open is a place in the UI, not a preference. Persisting it would
    // reopen the panel over the transcript on the next video, and the reading
    // surface is what the user came for.
    test('opening settings writes nothing to storage', async () => {
        ui.toggleSettingsPanel();
        expect(document.getElementById('vtt-settings-panel')?.classList.contains('open')).toBe(true);
        // savePrefs is read-modify-write: two awaited gets stand between the
        // call and the set, so a single microtask turn would let a real write
        // through unseen. Drain the queue until it is empty.
        for (let i = 0; i < 20; i++) await Promise.resolve();
        // Not "no settings-open field" — nothing at all. A toggle that saves
        // any pref here is already the defect, whatever it chose to call it.
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('a fresh panel starts closed even after settings were left open', () => {
        ui.toggleSettingsPanel();
        ui.destroy();
        document.body.innerHTML = '';
        const second = new SidebarUI(new AppState(), { seekVideo: jest.fn(), updateHighlight: jest.fn() });
        expect(second.init()).toBe(true);
        expect(document.getElementById('vtt-settings-panel')?.classList.contains('open')).toBe(false);
    });

    // The report form sits on top of settings. Leaving settings has to tear it
    // down, or its class survives and the next visit opens straight into a
    // stale form carrying someone's half-typed message.
    test('toggling settings dismisses an open report form', () => {
        ui.toggleSettingsPanel();
        ui.openFeedbackScreen();
        const sidebar = document.getElementById('vtt-sidebar')!;
        expect(sidebar.classList.contains('vtt-feedback-open')).toBe(true);
        expect(document.getElementById('vtt-feedback-text')).not.toBeNull();

        ui.toggleSettingsPanel();

        expect(sidebar.classList.contains('vtt-feedback-open')).toBe(false);
        expect(document.getElementById('vtt-feedback-text')).toBeNull();
    });

    // The mode bar switches between single, dual and guess. With no track
    // loaded every one of them is a no-op, so the bar is hidden rather than
    // offered dead.
    test('the mode bar is hidden until a track exists, and appears with one', () => {
        ui.updateControls();
        const bar = document.getElementById('vtt-quickmodes')!;
        expect(bar.style.display).toBe('none');

        state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'hello' }]);
        ui.updateControls();
        expect(bar.style.display).toBe('');
    });
});

/**
 * Phase 5 — the claims sections 3, 5, 10, 19, 20 and 38 left half-pinned.
 *
 * A new suite rather than additions inside the blocks above: these are their
 * own fixtures, and several need the real panel `init()` builds rather than the
 * hand-assembled `elements` the first suite uses.
 */
describe('the five-second reach is five seconds', () => {
    // §38.2. The existing checks put the far line 30s away and the long cue at
    // 7s inside an 8s cue. Both are true of REVEAL_REACH_S = 5, and equally
    // true of 8, of 20, of 29 — the constant was never pinned, only bracketed.
    // These two sit 4.9s and 5.1s from the line under the playhead, so the only
    // value that satisfies both is 5.
    let state: AppState, ui: SidebarUI, mockApp: AppInterface;

    beforeEach(() => {
        document.body.innerHTML = '<div id="vtt-list"></div><div id="vtt-sidebar"></div>';
        state = new AppState();
        mockApp = { seekVideo: jest.fn(), updateHighlight: jest.fn() };
        ui = new SidebarUI(state, mockApp, (host) => new WordScreen(host));
        ui.elements = {
            list: document.getElementById('vtt-list') as HTMLDivElement,
            sidebar: document.getElementById('vtt-sidebar') as HTMLDivElement,
            overlayBtn: { classList: { toggle: jest.fn() } } as any,
            dualBtn: { classList: { toggle: jest.fn() } } as any,
            settingsBtn: document.createElement('button'),
            mainSelect: { innerHTML: '', appendChild: jest.fn() } as any,
            subSelect: { innerHTML: '', appendChild: jest.fn() } as any,
        };
    });

    /**
     * Two cues: one under the playhead at 0, and a second whose START is `gap`
     * seconds later. The distance the rule measures is to the nearest point of
     * the cue, so a cue starting at `gap` is exactly `gap` away.
     */
    const buildAtGap = (gap: number): HTMLElement => {
        state.displayMode = 'guess';
        state.addTrack('English', [
            { startTime: 0, endTime: 0.5, text: 'alpha beta gamma' },
            { startTime: gap, endTime: gap + 2, text: 'delta epsilon zeta' },
        ] as Subtitle[]);
        ui.renderSubtitles();
        ui.highlightSubtitle(0);
        return ui.elements.list!.querySelector('.vtt-item[data-index="1"]') as HTMLElement;
    };

    test('a line 4.9s away is still the line you are on — it reveals', () => {
        buildAtGap(4.9).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(state.getRevealedCount(1)).toBe(2);
    });

    test('a line 5.1s away is navigation — it seeks without revealing', () => {
        buildAtGap(5.1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mockApp.seekVideo).toHaveBeenCalledWith(5.1);
        expect(state.getRevealedCount(1)).toBe(1);
    });

    // The reach is inclusive of its own value: exactly 5s away is "> 5" false,
    // so it reveals. Without this the constant could equally be read as 4.95.
    test('a line exactly 5s away reveals — the comparison is strictly greater', () => {
        buildAtGap(5).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(state.getRevealedCount(1)).toBe(2);
    });
});

describe('a dialogue-free stretch shows an empty caption', () => {
    // §3.3, T5.32. Between two cues there is no line, and the overlay must say
    // so by showing nothing — not by holding the last line up, which would read
    // as dialogue that is not being spoken.
    let state: AppState, ui: SidebarUI;

    beforeEach(() => {
        document.body.innerHTML = '<div id="vtt-list"></div><div id="vtt-sidebar"></div>';
        const video = document.createElement('video');
        const container = document.createElement('div');
        container.appendChild(video);
        document.body.appendChild(container);
        state = new AppState();
        ui = new SidebarUI(state, { seekVideo: jest.fn(), updateHighlight: jest.fn() });
        ui.elements = {
            list: document.getElementById('vtt-list') as HTMLDivElement,
            sidebar: document.getElementById('vtt-sidebar') as HTMLDivElement,
        };
        state.overlayEnabled = true;
        state.addTrack('English', [
            { startTime: 0, endTime: 2, text: 'first line' },
            { startTime: 10, endTime: 12, text: 'second line' },
        ] as Subtitle[]);
    });

    // highlightSubtitle is what turns a time into the index the overlay is
    // given, so the gap is expressed the way the product experiences it.
    test('the gap between two cues resolves to no line at all', () => {
        ui.highlightSubtitle(6);
        expect(state.currentIndex).toBe(-1);
    });

    test('the overlay carries no text over the gap', () => {
        ui.updateOverlay(0);
        expect(document.getElementById('vtt-video-overlay')!.textContent).toBe('first line');

        ui.updateOverlay(-1);
        expect(document.getElementById('vtt-video-overlay')!.textContent).toBe('');
    });

    // The nearest cue is the tempting wrong answer, so name it: neither
    // neighbour's text may survive into the gap.
    test('it shows neither neighbour', () => {
        ui.updateOverlay(0);
        ui.updateOverlay(-1);
        const text = document.getElementById('vtt-video-overlay')!.textContent!;
        expect(text).not.toMatch(/first line/);
        expect(text).not.toMatch(/second line/);
    });
});

/**
 * The panel's own controls, against the panel `init()` actually builds. The
 * suite at the top hand-assembles `elements` from stubs, which cannot answer
 * questions about markup nobody wrote there.
 */
describe('the panel as it is built', () => {
    let ui: SidebarUI, state: AppState, app: AppInterface;

    const build = (extra: Partial<AppInterface> = {}): void => {
        document.body.innerHTML = '';
        for (const k of Object.keys(prefsStore)) delete prefsStore[k];
        state = new AppState();
        app = { seekVideo: jest.fn(), updateHighlight: jest.fn(), ...extra };
        ui = new SidebarUI(state, app);
        expect(ui.init()).toBe(true);
    };

    beforeEach(() => build());

    // §10.17, T5.3. The slider replaced a three-way small/medium/large preset
    // precisely because 100-150% — where most people land — was unreachable.
    // The three numbers are that decision; a value asserted only as "a number"
    // would let the range collapse back without a word.
    describe('the size slider steps by five across 50-400%', () => {
        test('the main size slider', () => {
            const slider = document.getElementById('vtt-slider-size') as HTMLInputElement;
            expect(slider).not.toBeNull();
            expect(slider.type).toBe('range');
            expect(slider.min).toBe('50');
            expect(slider.max).toBe('400');
            expect(slider.step).toBe('5');
        });

        // The translation line gets the same control; a divergence here would
        // mean one line can reach a size the other cannot.
        test('the translation size slider matches it', () => {
            const slider = document.getElementById('vtt-slider-sub-size') as HTMLInputElement;
            expect(slider.min).toBe('50');
            expect(slider.max).toBe('400');
            expect(slider.step).toBe('5');
        });
    });

    // §19.3, §19.5, §19.7 and §19 as corrected by T0.4 — the download control.
    describe('the download control', () => {
        const btn = (): HTMLButtonElement =>
            document.getElementById('vtt-download-btn') as HTMLButtonElement;

        // §19.3: what gets written is the LEADING track, the one the panel is
        // showing as the main line — not track zero, and not the translation.
        test('offers the leading track, not the first one loaded', () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'hello' }]);
            state.addTrack('Русский', [{ startTime: 0, endTime: 2, text: 'привет' }]);
            state.activeTrackIndex = 1;
            state.secondaryTrackIndex = 0;
            ui.updateControls();

            expect(btn().title).toContain('Русский');
            expect(btn().title).not.toContain('English');
        });

        // §19.5: after a swap the leading track is the other one, and the offer
        // has to say so. Computing the label once at build time would leave the
        // control promising a file it no longer writes.
        test('names the other language after a swap', () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'hello' }]);
            state.addTrack('Русский', [{ startTime: 0, endTime: 2, text: 'привет' }]);
            ui.updateControls();
            expect(btn().title).toContain('English');

            expect(state.swapTracks()).toBe(true);
            ui.updateControls();
            expect(btn().title).toContain('Русский');
            expect(btn().title).not.toContain('English');
        });

        // §19.7: disabled is only half an answer. The tooltip is the whole
        // reason the button is disabled rather than hidden, so an empty or
        // generic title makes the disabled state unexplainable.
        test('carries its reason while there is nothing to write', () => {
            ui.updateControls();
            expect(btn().disabled).toBe(true);
            expect(btn().title).toBe('Available once subtitles have loaded.');
        });

        // A track of blank cues is not something worth writing to a file, and
        // the disabled state has to reach that case too.
        test('stays disabled for a track with no text in it', () => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: '   ' }]);
            ui.updateControls();
            expect(btn().disabled).toBe(true);
            expect(btn().title).toBe('Available once subtitles have loaded.');
        });

        // §19 as corrected by T0.4: the gate reads tracks, never the pair. The
        // map said export needed a language pair; it does not, and a check
        // written from the map would have pinned a rule the code never had.
        test('needs only a track — a missing language pair does not disable it', () => {
            build({ langPrefs: null });
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'hello' }]);
            ui.updateControls();

            expect(app.langPrefs ?? null).toBeNull();
            expect(btn().disabled).toBe(false);
            expect(btn().title).toContain('English');
        });
    });

    // §20.2, T5.7. Article D: the map places the explanation in the row's text;
    // the code puts it in the row's tooltip, deliberately — the footer is a
    // one-line-per-row band. Pinned where it actually lives.
    describe('the analytics consent row', () => {
        const row = (): HTMLElement =>
            document.getElementById('vtt-analytics-toggle')!.closest('.vtt-panel-row') as HTMLElement;

        test('names itself in the row text', () => {
            expect(row().textContent).toContain('Share anonymous usage stats');
        });

        // The sentence is the consent: it is what tells the user that the
        // count is a count and not their viewing history. Asserted whole, not
        // as "some tooltip exists".
        test('carries what is never collected, in full', () => {
            expect(row().title).toBe(
                'Counts like "subtitles loaded" and "word saved". ' +
                'Never your account, the videos you watch, or the words you save.',
            );
        });

        // A native checkbox, not a styled div: this is the one control in the
        // panel where being operable matters legally rather than aesthetically.
        test('is a real checkbox', () => {
            const box = document.getElementById('vtt-analytics-toggle') as HTMLInputElement;
            expect(box.tagName).toBe('INPUT');
            expect(box.type).toBe('checkbox');
        });
    });

    // Corrections, T5.10. The two dropdowns choose which LOADED TRACK feeds
    // each line. They are not the language pair: writing lang.v1 from here
    // would re-point the user's whole account at whatever this one video
    // happened to offer.
    describe('the track dropdowns pick tracks, never the pair', () => {
        const change = (id: string, value: string): void => {
            const sel = document.getElementById(id) as HTMLSelectElement;
            sel.value = value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        };

        beforeEach(() => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'hello' }]);
            state.addTrack('Русский', [{ startTime: 0, endTime: 2, text: 'привет' }]);
            ui.updateControls();
            (chrome.storage.local.set as jest.Mock).mockClear();
        });

        test('the learning dropdown moves the leading track', () => {
            change('vtt-main-select', '1');
            expect(state.activeTrackIndex).toBe(1);
        });

        test('the native dropdown moves the translation track', () => {
            change('vtt-sub-select', '0');
            expect(state.secondaryTrackIndex).toBe(0);
        });

        test('neither writes the language pair', async () => {
            change('vtt-main-select', '1');
            change('vtt-sub-select', '0');
            for (let i = 0; i < 20; i++) await Promise.resolve();

            for (const [written] of (chrome.storage.local.set as jest.Mock).mock.calls) {
                expect(Object.keys(written)).not.toContain('lang.v1');
            }
        });
    });

    // §5.4, T5.26. The flip is CSS: the JS side sets `.collapsed` on the panel
    // and the stylesheet rotates the chevron. Pinning only the class would let
    // the rotation rule be deleted; pinning only the rule would let the class
    // stop being written. Both halves, or the arrow can freeze either way.
    describe("the tab's arrow flips with the panel", () => {
        test('the panel carries the collapsed class on both sides of a toggle', () => {
            const sidebar = document.getElementById('vtt-sidebar')!;
            expect(sidebar.classList.contains('collapsed')).toBe(false);

            ui.toggleCollapsed();
            expect(ui.isCollapsed()).toBe(true);
            expect(sidebar.classList.contains('collapsed')).toBe(true);

            ui.toggleCollapsed();
            expect(ui.isCollapsed()).toBe(false);
            expect(sidebar.classList.contains('collapsed')).toBe(false);
        });

        test('the tab holds one chevron, whichever way it points', () => {
            const tab = document.getElementById('vtt-toggle-btn')!;
            expect(tab.querySelectorAll('.vtt-toggle-chevron')).toHaveLength(1);
        });

        // The stylesheet half. rezka owns the file; the YouTube build copies it
        // verbatim, so this is the shipped rule for both editions.
        test('the stylesheet turns the chevron around under that class', () => {
            const css = readFileSync(
                join(__dirname, '../../../apps/rezka/src/assets/styles.css'),
                'utf8',
            );
            const rule = /#vtt-sidebar\.collapsed\s+#vtt-toggle-btn\s+svg\s*\{([^}]*)\}/.exec(css);
            expect(rule).not.toBeNull();
            expect(rule![1]).toMatch(/transform:\s*rotate\(180deg\)/);
        });
    });
});

/**
 * The transcript's own behaviour — §6.15, §11.3, §39.3, §40.1, §40.4, §43.1.
 */
describe('the transcript list', () => {
    let state: AppState, ui: SidebarUI, mockApp: AppInterface;

    beforeEach(() => {
        document.body.innerHTML = '';
        for (const k of Object.keys(prefsStore)) delete prefsStore[k];
        state = new AppState();
        mockApp = { seekVideo: jest.fn(), updateHighlight: jest.fn() };
        ui = new SidebarUI(state, mockApp, (host) => new WordScreen(host));
        expect(ui.init()).toBe(true);
    });

    const list = (): HTMLElement => document.getElementById('vtt-list')!;
    const itemAt = (i: number): HTMLElement =>
        list().querySelector(`.vtt-item[data-index="${i}"]`) as HTMLElement;

    // §6.15, T5.13. The translation is the answer to the puzzle. Showing it
    // while words are still masked hands over the meaning the user is working
    // to reconstruct — the mode stops being a puzzle at all.
    describe('the translation appears only when the line is complete', () => {
        beforeEach(() => {
            state.displayMode = 'guess';
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'alpha beta gamma' }]);
            state.addTrack('Русский', [{ startTime: 0, endTime: 2, text: 'альфа бета гамма' }]);
            ui.renderSubtitles();
        });

        test('nothing is shown while a single word is still masked', () => {
            // The first word of a line starts revealed, so one more call
            // leaves exactly one of the three still covered.
            state.revealNextWord(0);
            ui.updateGuessItem(0);
            expect(state.getRevealedCount(0)).toBe(2);

            expect(state.isFullyRevealed(0)).toBe(false);
            expect(itemAt(0).querySelector('.vtt-sub-text')).toBeNull();
        });

        test('revealing the last word brings it out', () => {
            state.revealNextWord(0);
            state.revealNextWord(0);
            ui.updateGuessItem(0);

            expect(state.isFullyRevealed(0)).toBe(true);
            const translation = itemAt(0).querySelector('.vtt-sub-text');
            expect(translation).not.toBeNull();
            expect(translation!.textContent).toBe('альфа бета гамма');
        });

        // A line rendered from scratch in an already-complete state takes the
        // other branch (buildGuessItem, not updateGuessItem), and it has to
        // reach the same answer.
        test('a re-render of a finished line still carries it', () => {
            state.revealNextWord(0);
            state.revealNextWord(0);
            ui.renderSubtitles();

            expect(itemAt(0).querySelector('.vtt-sub-text')!.textContent)
                .toBe('альфа бета гамма');
        });
    });

    // §11.3, T5.12 — the mirror of the horizontal case tested above. Arrows
    // nudge, Shift jumps, and each keystroke writes because there is no
    // release to batch on. The vertical axis is the one people actually use:
    // it moves the caption clear of the player's control bar.
    describe('the arrow keys nudge the caption vertically', () => {
        const grip = (): HTMLElement => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'Hello' }]);
            const video = document.createElement('video');
            const container = document.createElement('div');
            container.appendChild(video);
            document.body.appendChild(container);
            ui.updateOverlay(0);
            const overlay = document.getElementById('vtt-video-overlay') as HTMLElement;
            const player = overlay.parentElement as HTMLElement;
            Object.defineProperty(player, 'offsetHeight', { value: 400, configurable: true });
            Object.defineProperty(player, 'offsetWidth', { value: 1000, configurable: true });
            return overlay.querySelector('.vtt-overlay-handle') as HTMLElement;
        };
        const nudge = (): number =>
            parseFloat(
                (document.getElementById('vtt-video-overlay') as HTMLElement).style
                    .getPropertyValue('--vtt-overlay-nudge'),
            );
        const key = (el: HTMLElement, k: string, shiftKey = false): boolean =>
            el.dispatchEvent(
                new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }),
            );

        test('ArrowUp lifts it by the small step', () => {
            // 4px on a 400px player.
            key(grip(), 'ArrowUp');
            expect(nudge()).toBeCloseTo(1, 2);
        });

        // Not "up then down returns to zero": with the vertical branch removed
        // entirely that is also true, so the round trip accepts the very
        // failure it is written against. Each direction is checked from a
        // starting point it has to move away from.
        test('ArrowDown lowers it by the same step', () => {
            const g = grip();
            key(g, 'ArrowUp', true); // start clear of the floor: +5%
            expect(nudge()).toBeCloseTo(5, 2);
            key(g, 'ArrowDown');
            expect(nudge()).toBeCloseTo(4, 2);
        });

        test('Shift takes the big step, and it is bigger', () => {
            const g = grip();
            key(g, 'ArrowUp', true);
            const big = nudge();
            expect(big).toBeGreaterThan(1);
            // 20px on 400px. Pinned to the value, not merely "more than small":
            // a step of 1.0001 would satisfy the comparison alone.
            expect(big).toBeCloseTo(5, 2);
        });

        test('each keystroke is written, with no release to batch on', async () => {
            key(grip(), 'ArrowUp');
            await new Promise((r) => setTimeout(r, 0));
            expect((await loadPrefs('other')).overlayBottomNudge).toBeCloseTo(1, 2);
        });

        // The page must not scroll under the viewer while they aim the caption.
        test('the key press is consumed', () => {
            expect(key(grip(), 'ArrowUp')).toBe(false);
            expect(key(grip(), 'ArrowDown')).toBe(false);
        });
    });

    // §39.3, T5.16. Only the stop was tested. The resume is the half that
    // strands a reader: a follow that never comes back leaves the transcript
    // frozen on the line the pointer happened to pass over, and nothing on
    // screen says why.
    //
    // Article D: the map places the listeners on #vtt-list; they are on
    // #vtt-sidebar, which is the honest boundary — the pointer is "in the
    // panel", not "in the list".
    describe('the follow stops on pointer enter and resumes on leave', () => {
        const sidebar = (): HTMLElement => document.getElementById('vtt-sidebar')!;
        const enter = (): boolean =>
            sidebar().dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
        const leave = (): boolean =>
            sidebar().dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

        beforeEach(() => {
            state.addTrack('English', [
                { startTime: 0, endTime: 2, text: 'first' },
                { startTime: 3, endTime: 5, text: 'second' },
            ]);
            ui.renderSubtitles();
        });

        test('entering the panel stops the follow', () => {
            enter();
            expect(state.isHovering).toBe(true);
        });

        test('leaving it resumes the follow', () => {
            enter();
            leave();
            expect(state.isHovering).toBe(false);
        });

        // The behaviour, not just the flag: while hovering the active class
        // still moves (the reader can see where playback is) but the list is
        // not scrolled out from under the pointer.
        test('the active line still moves while hovering, without scrolling', () => {
            const scrollTo = jest.spyOn(list(), 'scrollTo');
            enter();
            scrollTo.mockClear();

            ui.highlightSubtitle(4);

            expect(state.currentIndex).toBe(1);
            expect(itemAt(1).classList.contains('active-sub')).toBe(true);
            expect(scrollTo).not.toHaveBeenCalled();
            scrollTo.mockRestore();
        });

        // And on the way out it catches up to wherever playback got to.
        test('leaving catches the list up to the playing line', () => {
            enter();
            ui.highlightSubtitle(4);
            const scrollTo = jest.spyOn(list(), 'scrollTo');

            leave();

            expect(scrollTo).toHaveBeenCalled();
            scrollTo.mockRestore();
        });
    });

    // §40.4, T5.17. A rapid replay-click would otherwise trip the browser's
    // double-click-selects-word behaviour, and the resulting selection blocks
    // the click→seek handler outright: the line stops responding.
    describe('a double-click on a line selects nothing', () => {
        beforeEach(() => {
            state.addTrack('English', [{ startTime: 0, endTime: 2, text: 'alpha beta gamma' }]);
            ui.renderSubtitles();
        });

        const mousedown = (detail: number): MouseEvent => {
            const e = new MouseEvent('mousedown', { detail, bubbles: true, cancelable: true });
            itemAt(0).dispatchEvent(e);
            return e;
        };

        test('the second click of a pair is prevented', () => {
            expect(mousedown(2).defaultPrevented).toBe(true);
        });

        test('a triple click is prevented too', () => {
            expect(mousedown(3).defaultPrevented).toBe(true);
        });

        // The other side, and the reason the guard reads detail rather than
        // blocking mousedown outright: a drag-select fires with detail === 1,
        // and selecting a phrase to look up is a thing the user does here.
        test('a single click is left alone, so a drag-select still works', () => {
            expect(mousedown(1).defaultPrevented).toBe(false);
        });
    });

    // §40.1, T5.19. The transcript is a reading surface. A search box, a
    // timestamp column or a per-line copy button each turn it into a tool with
    // chrome, and the decision to have none of them is invisible in the code —
    // it looks like nothing at all.
    describe('the transcript carries no search, timestamps or per-line copy', () => {
        beforeEach(() => {
            state.addTrack('English', [
                { startTime: 61.5, endTime: 64, text: 'alpha beta' },
                { startTime: 70, endTime: 72, text: 'gamma delta' },
            ]);
            ui.renderSubtitles();
        });

        test('there is no input anywhere in the list', () => {
            expect(list().querySelector('input')).toBeNull();
        });

        test('no line carries a timestamp', () => {
            expect(list().querySelector('.vtt-time')).toBeNull();
            // And the times are not smuggled in as text either: 61.5s would
            // read as "1:01" and 70s as "1:10".
            expect(list().textContent).not.toMatch(/\d+:\d\d/);
        });

        test('no line carries a button of its own', () => {
            expect(list().querySelector('button')).toBeNull();
        });

        // The lines themselves are there — otherwise an empty list would pass
        // every check above.
        test('the lines it does carry are the subtitles', () => {
            expect(list().querySelectorAll('.vtt-item')).toHaveLength(2);
            expect(itemAt(0).textContent).toContain('alpha beta');
        });
    });
});

// §43.1, T5.27. The reveal's flash is dropped for reduced motion by the
// stylesheet, not by a media query in JS: the class is written unconditionally
// and the rule under @media (prefers-reduced-motion: reduce) cancels the
// animation. Pinned there, where the behaviour actually is.
describe('reduced motion drops the reveal animation', () => {
    const CSS = readFileSync(
        join(__dirname, '../../../apps/rezka/src/assets/styles.css'),
        'utf8',
    );

    /** The body of the @media (prefers-reduced-motion: reduce) blocks. */
    const reducedMotionBlocks = (): string[] => {
        const out: string[] = [];
        const marker = '@media (prefers-reduced-motion: reduce) {';
        let from = 0;
        for (;;) {
            const start = CSS.indexOf(marker, from);
            if (start === -1) return out;
            let depth = 0;
            let i = start + marker.length - 1;
            for (; i < CSS.length; i++) {
                if (CSS[i] === '{') depth++;
                else if (CSS[i] === '}' && --depth === 0) break;
            }
            out.push(CSS.slice(start, i + 1));
            from = i + 1;
        }
    };

    test('the reveal really is an animation, so there is something to drop', () => {
        const rule = /\.vtt-revealed-word\.vtt-just-revealed\s*\{([^}]*)\}/.exec(CSS);
        expect(rule).not.toBeNull();
        expect(rule![1]).toMatch(/animation:\s*vtt-word-focus/);
    });

    test('a reduced-motion block cancels animation on the revealed word', () => {
        const covering = reducedMotionBlocks().filter((b) => b.includes('.vtt-revealed-word'));
        expect(covering.length).toBeGreaterThan(0);
        expect(covering.some((b) => /animation:\s*none/.test(b))).toBe(true);
    });

    // The peek is the covered half; naming it here keeps the pair readable and
    // catches a rewrite that drops one selector while keeping the other.
    test('the masked and next-word states are cancelled alongside it', () => {
        const blocks = reducedMotionBlocks();
        expect(blocks.some((b) => b.includes('.vtt-masked-word'))).toBe(true);
        expect(blocks.some((b) => b.includes('.vtt-next-word'))).toBe(true);
    });
});
