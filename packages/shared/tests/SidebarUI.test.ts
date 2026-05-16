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
