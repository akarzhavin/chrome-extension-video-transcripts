/**
 * @jest-environment jsdom
 */

import { SidebarUI } from '../src/SidebarUI';
import { AppState } from '../src/AppState';
import { Subtitle, AppInterface } from '../src/types';

// Mock chrome API
(global as any).chrome = {
    runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn()
    }
};

(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();
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
            settingsBtn: { style: { display: 'none' } } as any,
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

    describe('word-wrapping spans (data-word)', () => {
        // Every word lives in its own <span data-word="..."> so the quick-add
        // overlay can snap selection to word boundaries and resolve masked
        // *** tokens back to the underlying word.

        test('buildMaskedContent stores data-word on every span (masked + revealed)', () => {
            const container = ui.buildMaskedContent('hello world foo', 1);
            const spans = container.querySelectorAll('span');
            expect(spans).toHaveLength(3);
            expect(spans[0].dataset.word).toBe('hello');
            expect(spans[0].className).toBe('vtt-revealed-word');
            expect(spans[1].dataset.word).toBe('world');
            expect(spans[1].className).toBe('vtt-masked-word');
            expect(spans[1].textContent).toBe('***'); // glyph, but real word in data-word
            expect(spans[2].dataset.word).toBe('foo');
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
            const beta = item.querySelectorAll('span[data-word]')[1] as HTMLSpanElement;
            expect(beta.className).toBe('vtt-masked-word');
            expect(beta.textContent).toBe('***');

            // Reveal one more word so index 1 ("beta") flips revealed.
            state.revealNextWord(0);
            ui.updateGuessItem(0);

            const sameBeta = item.querySelectorAll('span[data-word]')[1];
            expect(sameBeta).toBe(beta); // exact same node — not a replacement
            expect((sameBeta as HTMLSpanElement).className).toBe('vtt-revealed-word');
            expect(sameBeta.textContent).toBe('beta');
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
});
