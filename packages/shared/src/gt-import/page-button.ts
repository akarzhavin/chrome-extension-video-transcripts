// The Google Translate import, offered where the phrases are: an icon in the
// Saved panel's toolbar on translate.google.com, next to Google's own "Export
// to Google Sheets". It runs the same import as the popup (the worker reads the
// saved list in a hidden tab and writes the new words) and shows its progress
// in a card painted by the popup's own painter, so the texts and the steps are
// one implementation.
//
// Google's markup has obfuscated classes and labels in the page language; the
// icon is placed by the Sheets button's `jsname`, which has been steadier. If
// that anchor is gone while the Saved panel is open (/saved in the address),
// the page has changed under us and a floating button stands in for the icon.
//
// Everything of ours lives in closed shadow roots: Google's styles cannot reach
// it and the page cannot read it. Content scripts are kept out of session
// storage, so the card asks the worker for the state while it is open.

import { msg as i18nMsg } from '../i18n';
import { LOGO_DATA_URI } from './logo';
import { paintImport } from '../popup/gt-import-view';
import type { ImportState } from './runner';

const HOST_ID = 'lingogram-gt-import';
const ICON_ID = 'lingogram-gt-import-icon';
/** Google's "Export to Google Sheets" button in the Saved panel. */
const ANCHOR = 'button[jsname="mAozAc"]';
const POLL_MS = 700;
const CHECK_MS = 1000;
/** How long the Saved panel may lack the anchor before the floating button stands in. */
const FALLBACK_AFTER_MS = 3000;

// Material "input" glyph: an arrow into a frame.
const IMPORT_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21 3.01H3c-1.1 0-2 .9-2 2V9h2V4.99h18v14.03H3V15H1v4.01c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98v-14c0-1.11-.9-2-2-2zM11 16l4-4-4-4v3H1v2h10v3z"/></svg>';

const PALETTE = `
  --bg: #ffffff; --fg: #1c1a3a; --muted: #5b5873; --line: #dcd8ea; --accent: #5a3fb8; --accent-fg: #ffffff;
  --err: #b42318;
`;
const PALETTE_DARK = `
  --bg: #22202f; --fg: #f0eef8; --muted: #b4b0c8; --line: #3b3750; --accent: #9d87ef; --accent-fg: #15131f; --err: #ff8a80;
`;

const OVERLAY_CSS = `
:host { all: initial; }
.wrap {
  ${PALETTE}
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg);
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
}
@media (prefers-color-scheme: dark) { .wrap { ${PALETTE_DARK} } }
.pill {
  display: inline-flex; align-items: center; gap: 8px; border: 0; cursor: pointer;
  padding: 10px 16px 10px 12px; border-radius: 999px; font: inherit; font-weight: 600;
  background: var(--accent); color: var(--accent-fg); box-shadow: 0 6px 20px rgba(28, 26, 58, .25);
}
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.dot { width: 18px; height: 18px; border-radius: 5px; background: url("${LOGO_DATA_URI}") center / cover no-repeat; flex: none; }
.panel {
  width: 300px; max-width: calc(100vw - 40px); box-sizing: border-box; padding: 14px 16px 16px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 12px 36px rgba(28, 26, 58, .22); display: flex; flex-direction: column; gap: 8px;
}
.panel.anchored { position: fixed; }
.head { display: flex; align-items: center; gap: 8px; font-weight: 700; }
.head .x { margin-left: auto; border: 0; background: none; color: var(--muted); font: inherit; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.box { display: flex; flex-direction: column; gap: 8px; }
.lang-settings-title { display: none; }
.gt-line, .toggle-hint { color: var(--muted); }
.gt-strong { color: var(--fg); font-weight: 600; }
.gt-big { font-size: 17px; line-height: 1.3; font-weight: 700; }
.box > button.primary { width: 100%; }
.error { color: var(--err); }
.gt-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.gt-progress { width: 100%; accent-color: var(--accent); }
button.primary, button.secondary { font: inherit; font-weight: 600; border-radius: 10px; padding: 8px 14px; cursor: pointer; }
button.primary { border: 0; background: var(--accent); color: var(--accent-fg); }
button.secondary { border: 1px solid var(--line); background: transparent; color: var(--fg); }
button:disabled { opacity: .6; cursor: default; }
`;

// The icon copies its neighbours: a 48 px round target, a 24 px glyph in the
// toolbar's own grey (read from the Sheets button), a faint circle on hover.
const ICON_CSS = `
:host { all: initial; display: inline-flex; vertical-align: middle; }
button {
  width: 48px; height: 48px; padding: 12px; box-sizing: border-box; border: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  background: transparent; color: inherit; position: relative;
}
button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
button:active { background: color-mix(in srgb, currentColor 14%, transparent); }
button[aria-expanded="true"] { background: color-mix(in srgb, currentColor 12%, transparent); }
button:focus-visible { outline: 2px solid #5a3fb8; outline-offset: -2px; }
.badge { position: absolute; right: 9px; bottom: 9px; width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, #5a3fb8, #0e8f80); box-shadow: 0 0 0 1.5px #fff; }
`;

type Reply = { ok?: boolean; state?: ImportState | null } | undefined;

function ask(action: string): Promise<Reply> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action }, (res: Reply) => {
                void chrome.runtime.lastError; // extension reloaded: no answer
                resolve(res);
            });
        } catch {
            resolve(undefined); // the extension context is gone
        }
    });
}

export interface MountedButton {
    /** The overlay's root: the card, and the floating button when it stands in. */
    overlay: ShadowRoot;
    /** The icon's root while the icon is in Google's toolbar. */
    icon(): ShadowRoot | null;
    /** Places the icon or the stand-in now (otherwise on page changes and every second). */
    check(): void;
    /** Takes everything of ours off the page and stops watching it. */
    destroy(): void;
}

/** Mounts once per page; null if already there. */
export function mountGtButton(doc: Document = document): MountedButton | null {
    if (doc.getElementById(HOST_ID)) return null;
    const win = doc.defaultView ?? window;
    const label = i18nMsg('gtImportPageButton', 'Import to Lingogram');

    // --- the overlay: card + stand-in button ---------------------------------
    const host = doc.createElement('div');
    host.id = HOST_ID;
    const overlay = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = OVERLAY_CSS;
    const wrap = doc.createElement('div');
    wrap.className = 'wrap';
    overlay.append(style, wrap);

    const pill = doc.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.append(Object.assign(doc.createElement('span'), { className: 'dot' }), doc.createTextNode(label));

    const panel = doc.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', label);
    const head = doc.createElement('div');
    head.className = 'head';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'x';
    close.textContent = '×';
    close.setAttribute('aria-label', i18nMsg('gtImportHide', 'Hide'));
    head.append(Object.assign(doc.createElement('span'), { className: 'dot' }), doc.createTextNode('Lingogram'), close);
    const box = doc.createElement('div');
    box.className = 'box';
    panel.append(head, box);

    // --- the icon in Google's toolbar ----------------------------------------
    let iconHost: HTMLElement | null = null;
    let iconRoot: ShadowRoot | null = null;
    let iconBtn: HTMLButtonElement | null = null;

    const makeIcon = (): HTMLElement => {
        const h = doc.createElement('span');
        h.id = ICON_ID;
        const r = h.attachShadow({ mode: 'closed' });
        const s = doc.createElement('style');
        s.textContent = ICON_CSS;
        const b = doc.createElement('button');
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-expanded', 'false');
        b.innerHTML = IMPORT_ICON + '<span class="badge"></span>'; // constant markup
        b.addEventListener('click', () => void toggle());
        r.append(s, b);
        iconHost = h;
        iconRoot = r;
        iconBtn = b;
        return h;
    };

    // --- state ---------------------------------------------------------------
    type Mode = 'none' | 'icon' | 'pill';
    let mode: Mode = 'none';
    let open = false;
    let shown = '';
    let poll: ReturnType<typeof setInterval> | undefined;
    let savedSince = 0;

    const render = (s: ImportState | null) => {
        // Repaint only on a change: a repaint replaces the buttons under the
        // pointer, and a click in progress would land on nothing.
        const key = JSON.stringify(s);
        if (key === shown) return;
        shown = key;
        paintImport(box, s);
    };

    const place = () => {
        if (mode === 'icon' && iconBtn?.isConnected) {
            const r = iconBtn.getBoundingClientRect();
            panel.classList.add('anchored');
            panel.style.top = `${Math.round(r.bottom + 6)}px`;
            panel.style.right = `${Math.max(8, Math.round(win.innerWidth - r.right))}px`;
        } else {
            panel.classList.remove('anchored');
            panel.style.top = '';
            panel.style.right = '';
        }
    };

    const paintWrap = () => {
        const kids: HTMLElement[] = [];
        if (open) kids.push(panel);
        if (mode === 'pill' && !open) kids.push(pill);
        wrap.replaceChildren(...kids);
        iconBtn?.setAttribute('aria-expanded', String(open));
        if (open) place();
    };

    const setOpen = (on: boolean) => {
        open = on;
        if (poll) clearInterval(poll);
        poll = undefined;
        shown = '';
        if (on) poll = setInterval(() => void refresh(), POLL_MS);
        paintWrap();
    };

    const setMode = (m: Mode) => {
        if (m === mode) return;
        mode = m;
        // The card hangs off the icon; with the icon gone it folds away. The
        // import itself goes on in the worker.
        if (m === 'none' && open) setOpen(false);
        else paintWrap();
    };

    async function refresh() {
        const res = await ask('GT_IMPORT_STATE');
        if (!res?.ok) return;
        const s = res.state ?? null;
        // Finished and dismissed (OK / Cancel): fold the card.
        if (s === null && open && shown !== '' && shown !== 'null') {
            setOpen(false);
            return;
        }
        render(s);
    }

    async function toggle() {
        if (open) {
            setOpen(false);
            return;
        }
        setOpen(true);
        const res = await ask('GT_IMPORT_STATE');
        const s = res?.ok ? (res.state ?? null) : null;
        if (s) render(s);
        // Nothing under way: the click is the start.
        if (!s) {
            const started = await ask('GT_IMPORT_START');
            if (started?.ok) render(started.state ?? null);
        }
    }

    pill.addEventListener('click', () => void toggle());
    close.addEventListener('click', () => setOpen(false));

    // --- placement ------------------------------------------------------------
    // Google wraps the Sheets button in layers, one of them the owner of its
    // tooltip: an icon inside it showed "Export to Google Sheets" on hover.
    // Ours goes after the whole wrapped item, into the toolbar row itself: up
    // from the button until the parent holds the other buttons. (The wrapper
    // also holds the tooltip's own box until it is first shown, so "the only
    // child" is not the test.)
    const toolbarItem = (anchor: Element, icon: Element): Element => {
        let item = anchor;
        for (let up = 0; up < 6; up++) {
            const parent = item.parentElement;
            if (!parent || parent === doc.body) break;
            const others = [...parent.children].filter((c) => c !== item && c !== icon);
            if (others.some((c) => c.matches('button') || c.querySelector('button'))) break;
            item = parent;
        }
        return item;
    };

    let dead = false;
    const check = () => {
        if (dead) return; // a frame queued before destroy()
        // A page that rebuilt its body took the overlay with it: put it back.
        if (!host.isConnected) (doc.body ?? doc.documentElement).appendChild(host);
        const anchor = doc.querySelector(ANCHOR);
        if (anchor) {
            savedSince = 0;
            const icon = iconHost ?? makeIcon();
            const slot = toolbarItem(anchor, icon);
            if (icon.previousElementSibling !== slot) slot.after(icon);
            icon.style.color = win.getComputedStyle(anchor).color;
            // Sit level with the Sheets button, whatever the row aligns by:
            // nudge by the measured difference (none while the panel is hidden).
            const want = anchor.getBoundingClientRect(), got = icon.getBoundingClientRect();
            if (want.height && got.height && Math.round(want.top) !== Math.round(got.top)) {
                const now = parseFloat(icon.style.top) || 0;
                icon.style.position = 'relative';
                icon.style.top = `${Math.round(now + want.top - got.top)}px`;
            }
            setMode('icon');
            if (open) place();
            return;
        }
        iconHost?.remove();
        // The Saved panel is open but its toolbar is not what we know: stand in.
        if (win.location.pathname.startsWith('/saved')) {
            if (!savedSince) savedSince = Date.now();
            if (mode !== 'pill') setMode(Date.now() - savedSince >= FALLBACK_AFTER_MS ? 'pill' : 'none');
        } else {
            savedSince = 0;
            setMode('none');
        }
    };

    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        win.requestAnimationFrame(() => {
            queued = false;
            check();
        });
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    const ticker = setInterval(check, CHECK_MS);
    const onMove = () => open && place();
    win.addEventListener('resize', onMove);
    win.addEventListener('scroll', onMove, true);

    (doc.body ?? doc.documentElement).appendChild(host);
    check();
    return {
        overlay,
        icon: () => (iconHost?.isConnected ? iconRoot : null),
        check,
        destroy() {
            dead = true;
            observer.disconnect();
            clearInterval(ticker);
            if (poll) clearInterval(poll);
            win.removeEventListener('resize', onMove);
            win.removeEventListener('scroll', onMove, true);
            iconHost?.remove();
            host.remove();
        },
    };
}
