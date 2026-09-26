/**
 * @jest-environment jsdom
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { CueNav, cueNavTarget, heldCueIndex } from '../src/overlay-cue-nav';

// Three lines: the first two touch, a second of silence, then the last.
const TRACK = [
    { startTime: 10, endTime: 12 },
    { startTime: 12, endTime: 14 },
    { startTime: 15, endTime: 17 },
];

describe('cueNavTarget', () => {
    test('back from inside a line goes to the line before it', () => {
        expect(cueNavTarget(TRACK, 13, 'prev')).toBe(0);
    });

    test('a shared boundary belongs to the line that starts there', () => {
        expect(cueNavTarget(TRACK, 12, 'prev')).toBe(0);
    });

    test('back in the silence after a line goes to that line, not the one before', () => {
        expect(cueNavTarget(TRACK, 14.5, 'prev')).toBe(1);
    });

    test('back from the first line stays on it', () => {
        expect(cueNavTarget(TRACK, 11, 'prev')).toBe(0);
    });

    test('before the first line there is nothing to go back or replay to', () => {
        expect(cueNavTarget(TRACK, 5, 'prev')).toBeNull();
        expect(cueNavTarget(TRACK, 5, 'replay')).toBeNull();
    });

    test('replay restarts the line playing, or the one that just ended', () => {
        expect(cueNavTarget(TRACK, 16, 'replay')).toBe(2);
        expect(cueNavTarget(TRACK, 14.5, 'replay')).toBe(1);
    });

    test('next goes to the following line from inside a line and from the silence', () => {
        expect(cueNavTarget(TRACK, 13, 'next')).toBe(2);
        expect(cueNavTarget(TRACK, 14.5, 'next')).toBe(2);
        expect(cueNavTarget(TRACK, 5, 'next')).toBe(0);
    });

    test('next from the last line has nowhere to go', () => {
        expect(cueNavTarget(TRACK, 16, 'next')).toBeNull();
        expect(cueNavTarget(TRACK, 30, 'next')).toBeNull();
    });

    test('an empty track has no targets', () => {
        expect(cueNavTarget([], 1, 'prev')).toBeNull();
        expect(cueNavTarget([], 1, 'next')).toBeNull();
    });
});

describe('heldCueIndex', () => {
    test('in the silence after a line, that line is held', () => {
        expect(heldCueIndex(TRACK, 14.5)).toBe(1);
        expect(heldCueIndex(TRACK, 30)).toBe(2);
    });

    test('nothing is held while a line plays or before the first', () => {
        expect(heldCueIndex(TRACK, 13)).toBe(-1);
        expect(heldCueIndex(TRACK, 5)).toBe(-1);
    });
});

describe('CueNav', () => {
    let overlay: HTMLDivElement;
    let box: HTMLDivElement;
    let onAction: jest.Mock;
    let onNearChange: jest.Mock;
    let nav: CueNav;

    // A caption box at x 100..300, y 400..430.
    const rect = (el: Element) => el === box
        ? ({ left: 100, right: 300, top: 400, bottom: 430, width: 200, height: 30 } as DOMRect)
        : ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect);

    const move = (x: number, y: number, pointerType = 'mouse', target: EventTarget = document.body) => {
        const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
        Object.defineProperty(e, 'pointerType', { value: pointerType });
        target.dispatchEvent(e);
        jest.advanceTimersByTime(20); // one animation frame
    };

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
        overlay = document.createElement('div');
        box = document.createElement('div');
        box.className = 'vtt-overlay-main';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            return rect(this);
        });
        onAction = jest.fn();
        onNearChange = jest.fn();
        nav = new CueNav({ onAction, onNearChange });
        nav.attach(overlay);
        overlay.appendChild(nav.el);
    });

    afterEach(() => {
        nav.destroy();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    test('three buttons in order, named for what they do', () => {
        const buttons = Array.from(nav.el.querySelectorAll('button'));
        expect(buttons.map(b => b.className)).toEqual([
            'vtt-cue-nav-btn vtt-cue-nav-prev',
            'vtt-cue-nav-btn vtt-cue-nav-replay',
            'vtt-cue-nav-btn vtt-cue-nav-next',
        ]);
        expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Previous line', 'Replay line', 'Next line']);
    });

    test('a click reports its action and never reaches the player', () => {
        const player = jest.fn();
        document.body.addEventListener('click', player);
        document.body.addEventListener('mousedown', player);
        const prev = nav.el.querySelector('.vtt-cue-nav-prev') as HTMLButtonElement;
        prev.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        prev.click();
        expect(onAction).toHaveBeenCalledWith('prev');
        expect(player).not.toHaveBeenCalled();
    });

    test('a mouse press does not leave the button focused (Space would press it again)', () => {
        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        (nav.el.querySelector('.vtt-cue-nav-replay') as HTMLButtonElement).dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
    });

    test('the cursor within 30px of a caption box brings the controls', () => {
        move(200, 459); // 29px below the box
        expect(nav.isNear()).toBe(true);
        expect(overlay.classList.contains('vtt-cue-nav-near')).toBe(true);
        expect(onNearChange).toHaveBeenCalledWith(true);
    });

    test('further than 30px does not', () => {
        move(200, 461); // 31px below the box
        expect(nav.isNear()).toBe(false);
        expect(overlay.classList.contains('vtt-cue-nav-near')).toBe(false);
    });

    test('the controls outlive the cursor leaving by 700ms', () => {
        move(200, 420);
        move(900, 900);
        jest.advanceTimersByTime(660); // 20 already spent on the frame
        expect(nav.isNear()).toBe(true);
        jest.advanceTimersByTime(40);
        expect(nav.isNear()).toBe(false);
        expect(overlay.classList.contains('vtt-cue-nav-near')).toBe(false);
        expect(onNearChange).toHaveBeenLastCalledWith(false);
    });

    // The reserve under the captions must not fight a hand placement: the drag
    // has the cursor on the captions throughout, so with the reserve on the
    // lowest stretch above the bar was unreachable and the caption dropped
    // later, once the cursor left, to where the drag had actually stored it.
    test('moving the captions by hand lifts the reserve until the cursor leaves', () => {
        move(200, 420);
        expect(overlay.classList.contains('vtt-cue-nav-placed')).toBe(false);
        nav.suspendPin();
        expect(overlay.classList.contains('vtt-cue-nav-placed')).toBe(true);
        nav.resumePin();
        jest.advanceTimersByTime(400);
        expect(overlay.classList.contains('vtt-cue-nav-placed')).toBe(true); // released, still near
        const rebuilt = document.createElement('div');
        overlay.parentElement!.appendChild(rebuilt);
        nav.attach(rebuilt); // an overlay rebuild keeps the state
        expect(rebuilt.classList.contains('vtt-cue-nav-placed')).toBe(true);
        nav.attach(overlay);
        move(900, 900);
        jest.advanceTimersByTime(700);
        expect(nav.isNear()).toBe(false);
        expect(overlay.classList.contains('vtt-cue-nav-placed')).toBe(false);
        rebuilt.remove();
    });

    test('coming back before the grace ends keeps them up', () => {
        move(200, 420);
        move(900, 900);
        jest.advanceTimersByTime(300);
        move(200, 420);
        jest.advanceTimersByTime(1000);
        expect(nav.isNear()).toBe(true);
    });

    test('the cursor leaving the page (window edge, iframe) takes them away', () => {
        move(200, 420);
        document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
        jest.advanceTimersByTime(700);
        expect(nav.isNear()).toBe(false);
    });

    test('moving between elements inside the page is not leaving it', () => {
        move(200, 420);
        box.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: overlay }));
        jest.advanceTimersByTime(700);
        expect(nav.isNear()).toBe(true);
    });

    test('a touch pointer never brings them', () => {
        move(200, 420, 'touch');
        expect(nav.isNear()).toBe(false);
    });

    test('the room the captions leave under themselves is the controls\' real height plus the gap', () => {
        Object.defineProperty(nav.el, 'offsetHeight', { configurable: true, value: 26 });
        nav.noteLayout();
        jest.advanceTimersByTime(20);
        expect(overlay.style.getPropertyValue('--vtt-cue-nav-space')).toBe('30px');
    });

    test('between lines the zone is where the last line stood', () => {
        nav.noteLayout();
        jest.advanceTimersByTime(20);
        box.remove(); // the line ends; nothing to measure
        move(200, 450);
        expect(nav.isNear()).toBe(true);
    });

    test('the pointer on the controls themselves counts as near', () => {
        box.remove();
        move(900, 900, 'mouse', nav.el.querySelector('.vtt-cue-nav-replay') as Element);
        expect(nav.isNear()).toBe(true);
    });

    describe('pinned while in use', () => {
        // The player the overlay lives in, and the overlay's own box; the
        // controls hang under the caption until pinned.
        let overlayTop = 380;
        const host = () => overlay.parentElement as HTMLElement;
        beforeEach(() => {
            overlayTop = 380;
            (Element.prototype.getBoundingClientRect as jest.Mock).mockImplementation(function (this: Element) {
                if (this === box) return { left: 100, right: 300, top: 400, bottom: 430, width: 200, height: 30 } as DOMRect;
                if (this === overlay) return { left: 0, right: 400, top: overlayTop, bottom: overlayTop + 50, width: 400, height: 50 } as DOMRect;
                if (this === host()) return { left: 0, right: 400, top: 0, bottom: 500, width: 400, height: 500 } as DOMRect;
                if (this === nav.el) return { left: 189, right: 211, top: overlayTop + 54, bottom: overlayTop + 76, width: 22, height: 22 } as DOMRect;
                return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
            });
        });

        test('they follow the caption until the cursor has settled near it', () => {
            move(200, 420);
            jest.advanceTimersByTime(250);
            expect(nav.el.style.top).toBe('');
        });

        test('once pinned, a caption that moves does not move them', () => {
            move(200, 420);
            jest.advanceTimersByTime(300);
            expect(nav.el.style.top).toBe('54px');
            expect(nav.el.style.left).toBe('200px');
            overlayTop = 330; // a taller line: the caption box rose 50px
            jest.advanceTimersByTime(20);
            expect(nav.el.style.top).toBe('104px'); // still at 434 in the player
            expect(nav.el.style.left).toBe('200px');
        });

        test('leaving lets them go back under the caption, after they fade', () => {
            move(200, 420);
            jest.advanceTimersByTime(300);
            move(900, 900);
            jest.advanceTimersByTime(700); // grace ends: hidden
            expect(nav.isNear()).toBe(false);
            expect(nav.el.style.top).toBe('54px'); // still fading out in place
            jest.advanceTimersByTime(200);
            expect(nav.el.style.top).toBe('');
            expect(nav.el.style.left).toBe('');
        });

        test('while the captions are dragged the controls ride with them, then pin again', () => {
            move(200, 420);
            jest.advanceTimersByTime(300);
            expect(nav.el.style.top).toBe('54px');
            nav.suspendPin();
            expect(nav.el.style.top).toBe(''); // hanging under the caption again
            overlayTop = 300; // dragged up 80px
            jest.advanceTimersByTime(400); // no pin while held, however long
            expect(nav.el.style.top).toBe('');
            nav.resumePin();
            jest.advanceTimersByTime(20);
            overlayTop = 250; // a later line change moves the caption again
            jest.advanceTimersByTime(20);
            // Pinned where the drag left them: 354 in the player, 104 below the overlay now.
            expect(nav.el.style.top).toBe('104px');
        });

        test('controls that are not laid out are not pinned to the corner', () => {
            const real = (Element.prototype.getBoundingClientRect as jest.Mock).getMockImplementation()!;
            (Element.prototype.getBoundingClientRect as jest.Mock).mockImplementation(function (this: Element) {
                if (this === nav.el) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
                return real.call(this);
            });
            move(200, 420);
            jest.advanceTimersByTime(400);
            expect(nav.isNear()).toBe(true);
            expect(nav.el.style.top).toBe('');
        });

        test('letting go of a drag away from the captions does not pin', () => {
            nav.suspendPin();
            nav.resumePin();
            jest.advanceTimersByTime(400);
            expect(nav.isNear()).toBe(false);
            expect(nav.el.style.top).toBe('');
        });

        test('arriving near the captions in the middle of a drag does not pin', () => {
            nav.suspendPin(); // the drag began with the cursor elsewhere
            move(200, 420);
            jest.advanceTimersByTime(400);
            expect(nav.isNear()).toBe(true);
            expect(nav.el.style.top).toBe('');
        });

        test('coming back while fading keeps the pin', () => {
            move(200, 420);
            jest.advanceTimersByTime(300);
            move(900, 900);
            jest.advanceTimersByTime(700 - 20 + 100);
            overlayTop = 330;
            move(200, 420);
            jest.advanceTimersByTime(20);
            expect(nav.el.style.top).toBe('104px');
        });
    });

    test('destroy stops listening', () => {
        nav.destroy();
        move(200, 420);
        expect(nav.isNear()).toBe(false);
        expect(nav.el.isConnected).toBe(false);
    });
});

// The stylesheet half. rezka owns the file; the YouTube build copies it.
describe('cue-nav stylesheet', () => {
    const CSS = readFileSync(join(__dirname, '../../../apps/rezka/src/assets/styles.css'), 'utf8');

    test('a hand placement switches the reserve off', () => {
        const rule = /#vtt-video-overlay\.vtt-cue-nav-near\.vtt-cue-nav-placed\s*\{([^}]*)\}/.exec(CSS);
        expect(rule).not.toBeNull();
        expect(rule![1]).toMatch(/--vtt-cue-nav-min-bottom:\s*-100000px/);
        // Later than the rule it overrides: the two selectors differ by a class,
        // but the order is what a future edit to either would silently break.
        expect(CSS.indexOf(rule![0])).toBeGreaterThan(CSS.indexOf('#vtt-video-overlay.vtt-cue-nav-near {'));
    });

    // Fullscreen with the panel open narrows the caption frame by the panel's
    // width. Every size read from that frame (cqw) has to add the cut back, or
    // opening the panel shrinks the captions and their controls.
    test('the fullscreen frame cut is handed back to every cqw-based size', () => {
        const fs = /:fullscreen:has\(> #vtt-sidebar\.fullscreen:not\(\.collapsed\)\) #vtt-video-overlay\s*\{([^}]*)\}/.exec(CSS);
        expect(fs).not.toBeNull();
        expect(fs![1]).toMatch(/--vtt-overlay-frame-cut:\s*320px/);
        expect(fs![1]).toMatch(/width:\s*calc\(100% - var\(--vtt-overlay-frame-cut\)\)/);
        const decls = CSS.split('\n').filter(l => /\d(\.\d+)?cqw/.test(l) && !l.trim().startsWith('*') && /:/.test(l) && /;\s*$/.test(l));
        expect(decls.length).toBe(4); // scale ×2 (main, sub), grip, step bar
        for (const d of decls) expect(d).toContain('var(--vtt-overlay-frame-cut, 0px)');
    });
});
