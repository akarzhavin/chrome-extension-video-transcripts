/**
 * @jest-environment jsdom
 */

// The line-step controls as SidebarUI mounts and drives them: where they hang,
// that they survive the overlay's rebuild, what a press seeks to, and the line
// held on screen between cues while the cursor is near.

import { SidebarUI } from '../src/SidebarUI';
import { AppState } from '../src/AppState';
import { Subtitle, AppInterface } from '../src/types';
import { CueNav } from '../src/overlay-cue-nav';

(global as any).chrome = {
    runtime: { id: 'test-extension-id', onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
    storage: {
        local: { get: jest.fn(() => Promise.resolve({})), set: jest.fn(() => Promise.resolve()) },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};
(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();
(window as any).Element.prototype.scrollTo = jest.fn();
(window as any).isTopWindow = true;

const LINES: Subtitle[] = [
    { startTime: 10, endTime: 12, text: 'One small step' },
    { startTime: 12, endTime: 14, text: 'for a man' },
    { startTime: 15, endTime: 17, text: 'one giant leap' },
];
const TRANSLATIONS: Subtitle[] = [
    { startTime: 10, endTime: 12, text: 'Один маленький шаг' },
    { startTime: 12, endTime: 14, text: 'для человека' },
    { startTime: 15, endTime: 17, text: 'огромный скачок' },
];

describe('overlay line-step controls', () => {
    let state: AppState;
    let ui: SidebarUI;
    let seekVideo: jest.Mock;

    const overlay = () => document.getElementById('vtt-video-overlay') as HTMLElement;
    const press = (action: 'prev' | 'replay' | 'next') =>
        (overlay().querySelector(`.vtt-cue-nav-${action}`) as HTMLButtonElement).click();

    // Every caption box sits at x 100..300, y 400..430; bring the cursor next to it.
    const approach = () => {
        const e = new MouseEvent('pointermove', { clientX: 200, clientY: 440, bubbles: true });
        Object.defineProperty(e, 'pointerType', { value: 'mouse' });
        document.dispatchEvent(e);
        jest.advanceTimersByTime(20);
    };
    const leave = () => {
        const e = new MouseEvent('pointermove', { clientX: 900, clientY: 900, bubbles: true });
        Object.defineProperty(e, 'pointerType', { value: 'mouse' });
        document.dispatchEvent(e);
        jest.advanceTimersByTime(1000);
    };

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '<div id="vtt-list"></div><div id="vtt-sidebar"></div>';
        const container = document.createElement('div');
        container.appendChild(document.createElement('video'));
        document.body.appendChild(container);
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            return this.matches('.vtt-overlay-main, .vtt-overlay-sub')
                ? ({ left: 100, right: 300, top: 400, bottom: 430, width: 200, height: 30 } as DOMRect)
                : ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect);
        });
        state = new AppState();
        state.overlayEnabled = true;
        seekVideo = jest.fn();
        const app: AppInterface = { seekVideo, updateHighlight: jest.fn() };
        ui = new SidebarUI(state, app);
        ui.elements = {
            list: document.getElementById('vtt-list') as HTMLDivElement,
            sidebar: document.getElementById('vtt-sidebar') as HTMLDivElement,
        } as any;
        state.addTrack('English', LINES);
    });

    afterEach(() => {
        ui.destroy();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    test('they hang under the translation, last in the block', () => {
        state.addTrack('Russian', TRANSLATIONS);
        state.secondaryTrackIndex = 1;
        state.displayMode = 'dual';
        ui.highlightSubtitle(13);
        const children = Array.from(overlay().children).map(c => c.className);
        expect(children).toEqual(['vtt-overlay-row', 'vtt-overlay-sub', 'vtt-cue-nav']);
    });

    test('with no translation they hang under the line itself', () => {
        ui.highlightSubtitle(13);
        const children = Array.from(overlay().children).map(c => c.className);
        expect(children).toEqual(['vtt-overlay-row', 'vtt-cue-nav']);
    });

    test('the same element survives the rebuild when the line changes', () => {
        ui.highlightSubtitle(11);
        const nav = overlay().querySelector('.vtt-cue-nav');
        ui.highlightSubtitle(13);
        expect(overlay().querySelector('.vtt-overlay-main')?.textContent).toBe('for a man');
        expect(overlay().querySelector('.vtt-cue-nav')).toBe(nav);
    });

    test('a line change never takes them out of the page, even for a moment', async () => {
        // Chrome drops :hover on a node that leaves and re-enters the DOM, and
        // the row folds shut under a resting cursor — so detach-and-reappend
        // is a defect even though the end state looks the same.
        ui.highlightSubtitle(11);
        const nav = overlay().querySelector('.vtt-cue-nav') as HTMLElement;
        const removed: Node[] = [];
        const mo = new MutationObserver((records) => records.forEach(r => removed.push(...Array.from(r.removedNodes))));
        mo.observe(overlay(), { childList: true });
        ui.highlightSubtitle(13);
        await Promise.resolve();
        mo.disconnect();
        expect(removed.length).toBeGreaterThan(0); // the line itself was rebuilt
        expect(removed).not.toContain(nav);
        expect(overlay().lastElementChild).toBe(nav);
    });

    test('dragging the captions lets the controls go with them, and letting go pins them again', () => {
        const suspend = jest.spyOn(CueNav.prototype, 'suspendPin');
        const resume = jest.spyOn(CueNav.prototype, 'resumePin');
        ui.highlightSubtitle(13);
        const grip = overlay().querySelector('.vtt-overlay-handle') as HTMLElement;
        grip.setPointerCapture = jest.fn();
        grip.releasePointerCapture = jest.fn();
        grip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, clientX: 100, clientY: 400 }));
        expect(suspend).toHaveBeenCalledTimes(1);
        expect(resume).not.toHaveBeenCalled();
        grip.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true, clientX: 100, clientY: 300 }));
        expect(resume).toHaveBeenCalledTimes(1);
    });

    test('nudging the captions with the arrow keys re-pins the controls', () => {
        const suspend = jest.spyOn(CueNav.prototype, 'suspendPin');
        const resume = jest.spyOn(CueNav.prototype, 'resumePin');
        ui.highlightSubtitle(13);
        const grip = overlay().querySelector('.vtt-overlay-handle') as HTMLElement;
        grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(suspend).toHaveBeenCalledTimes(2);
        expect(resume).toHaveBeenCalledTimes(2);
    });

    test('‹ seeks to the start of the previous line', () => {
        ui.highlightSubtitle(13);
        press('prev');
        expect(seekVideo).toHaveBeenCalledWith(10.01);
    });

    test('↺ and › land on this line and the next', () => {
        ui.highlightSubtitle(13);
        press('replay');
        expect(seekVideo).toHaveBeenLastCalledWith(12.01);
        ui.highlightSubtitle(13);
        press('next');
        expect(seekVideo).toHaveBeenLastCalledWith(15.01);
    });

    test('the line landed on is painted at once, before the player reports back', () => {
        ui.highlightSubtitle(13);
        press('prev');
        expect(overlay().querySelector('.vtt-overlay-main')?.textContent).toBe('One small step');
    });

    test('a second ‹ before the player reports back counts from where the first landed', () => {
        ui.highlightSubtitle(16);
        press('prev');
        press('prev');
        expect(seekVideo.mock.calls).toEqual([[12.01], [10.01]]);
    });

    test('between lines, with the cursor near, the line that ended stays up dimmed', () => {
        ui.highlightSubtitle(13);
        approach();
        ui.highlightSubtitle(14.5);
        const main = overlay().querySelector('.vtt-overlay-main') as HTMLElement;
        expect(main.textContent).toBe('for a man');
        expect(main.classList.contains('vtt-overlay-held')).toBe(true);
        expect(overlay().querySelector('.vtt-cue-nav')).not.toBeNull();
    });

    test('‹ from the held line goes to that line, the one the word was in', () => {
        ui.highlightSubtitle(13);
        approach();
        ui.highlightSubtitle(14.5);
        press('prev');
        expect(seekVideo).toHaveBeenCalledWith(12.01);
    });

    test('between lines with the cursor away, nothing is held', () => {
        ui.highlightSubtitle(14.5);
        expect(overlay().querySelector('.vtt-overlay-main')).toBeNull();
        expect(overlay().querySelector('.vtt-cue-nav')).toBeNull();
    });

    test('the held line goes when the cursor leaves', () => {
        ui.highlightSubtitle(13);
        approach();
        ui.highlightSubtitle(14.5);
        leave();
        expect(overlay().querySelector('.vtt-overlay-main')).toBeNull();
    });

    test('with the settings panel open the gap belongs to the preview, not to a held line', () => {
        ui.highlightSubtitle(13);
        approach();
        ui.setOverlayAdjusting(true);
        ui.highlightSubtitle(14.5);
        expect(overlay().querySelector('.vtt-overlay-main')).not.toBeNull();
        expect(overlay().querySelector('.vtt-overlay-held')).toBeNull();
    });

    test('tearing the sidebar down takes the controls and their page listener with it', () => {
        ui.highlightSubtitle(13);
        const nav = overlay().querySelector('.vtt-cue-nav') as HTMLElement;
        const off = jest.spyOn(document, 'removeEventListener');
        ui.destroy();
        expect(nav.isConnected).toBe(false);
        expect(off.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['pointermove', 'mouseout']));
    });

    test('a line playing is never marked held', () => {
        approach();
        ui.highlightSubtitle(13);
        expect(overlay().querySelector('.vtt-overlay-held')).toBeNull();
    });

    test('in guess mode the held line keeps its masks', () => {
        state.displayMode = 'guess';
        ui.highlightSubtitle(13);
        approach();
        ui.highlightSubtitle(14.5);
        const main = overlay().querySelector('.vtt-overlay-main') as HTMLElement;
        expect(main.classList.contains('vtt-overlay-held')).toBe(true);
        expect(main.querySelectorAll('.vtt-masked-word').length).toBeGreaterThan(0);
    });
});
