/**
 * Source pins standing behind live checks that cannot be made red.
 *
 * Two behaviours in `e2e/` are only observable in a browser, and neither can be
 * broken from a test: the panel sliding off rather than shrinking, and the
 * transcript scrolling itself without dragging the page along. The live checks
 * observe them; these pin the lines that produce them, so a rewrite that would
 * change either fails here in milliseconds rather than only in the next live
 * run — and so each live check has something that has been seen red.
 *
 * Deliberately narrow: each reads the one rule or the one call site the
 * behaviour rests on, not the whole file around it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STYLESHEET = join(__dirname, '..', '..', 'rezka', 'src', 'assets', 'styles.css');
const SIDEBAR = join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'SidebarUI.ts');

describe('collapsing slides the panel off, it does not shrink it', () => {
    /**
     * Behaviour map §5.3. The panel keeps its width and its layout while
     * collapsed and simply sits off the right edge — which is why re-opening
     * it is instant and nothing inside reflows.
     *
     * A `width: 0` (or a `display: none`) here would look identical in a
     * screenshot and would tear the layout down on every collapse. The live
     * check in `e2e/display.spec.ts` measures the rendered width across the
     * toggle; this pins the rule that makes that measurement come out equal.
     */
    test('the collapsed rule moves the panel and touches nothing else', () => {
        const css = readFileSync(STYLESHEET, 'utf8');

        const rule = /#vtt-sidebar\.collapsed\s*\{([^}]*)\}/.exec(css);
        expect(rule).not.toBeNull();

        const body = rule![1];
        expect(body).toMatch(/transform:\s*translateX\(100%\)/);

        // Nothing in that rule may change the box itself. Each of these would
        // collapse the panel visually while destroying the layout inside it.
        for (const forbidden of ['width', 'display', 'visibility', 'max-width']) {
            expect(body).not.toMatch(new RegExp(`(^|[\\s;])${forbidden}\\s*:`));
        }
    });
});

describe('only the list scrolls, never the page', () => {
    /**
     * Behaviour map §39.4. Following the video scrolls the transcript and must
     * never yank the document back to the player.
     *
     * `scrollIntoView` is the obvious way to write this and the wrong one: it
     * walks up and scrolls EVERY scrollable ancestor, the page included. The
     * extensions get away with it because the sidebar is fixed, but the same
     * class is embedded in an ordinary page by packages/embed, where it would
     * fight the reader on every new line.
     *
     * The live check in `e2e/accessibility.spec.ts` watches window.scrollY
     * hold still while the list moves. This pins the call that keeps it there.
     */
    test('the follow code scrolls the list itself', () => {
        const src = readFileSync(SIDEBAR, 'utf8');

        const fn = /private scrollActiveIntoView\([^)]*\): void \{([\s\S]*?)\n    \}/.exec(src);
        expect(fn).not.toBeNull();

        const body = fn![1];
        expect(body).toMatch(/list\.scrollTo\(/);
        expect(body).not.toMatch(/scrollIntoView/);
    });
});
