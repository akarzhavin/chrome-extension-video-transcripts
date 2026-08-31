import { AppState } from './AppState';
// Content-safe half only: analytics.ts never reads the GA4 api_secret, so it is
// safe in a bundle the page can read. analytics-bg must never be imported here.
import { trackVia, platformOf } from './analytics';
import {
    loadPrefs,
    onPrefsChanged,
    savePrefs,
    Prefs,
    OverlaySizePercent,
    OverlayLevelToken,
    OverlayBackdropToken,
    OverlayEdgeToken,
    OverlayFontFamily,
    PrefScope,
    ThemeToken,
    PLATFORM_SIZE_DEFAULTS,
} from './prefs';
import { applyTheme, stopThemeTracking } from './content/theme';
import { isContextOrphaned, showOrphanNotice } from './content/orphan-notice';
import { SidebarElements, AppInterface, Subtitle, Track, TrackRole, SliderRowElements } from './types';
import { tokenizeForGuess, isMaskableToken } from './guess-tokenize';
import { downloadTrack, isDownloadable } from './subtitle-download';
import { msg } from './i18n';
import {
    MAX_FEEDBACK_BYTES,
    clampToBytes,
    composeFeedbackText,
    feedbackCopy,
    sendFeedback,
    utf8Len,
} from './feedback';

// Smooth-scroll budget. Jumps within this many subtitle indices animate;
// bigger jumps snap instantly so the user doesn't watch a full-list scroll.
const NEARBY_SUBTITLE_THRESHOLD = 20;

/**
 * Who built a #vtt-sidebar, stamped on it as data-vtt-owner.
 *
 * The extension id, because that is exactly the axis that matters: two
 * installed copies (a store build beside an unpacked one) share every #vtt-*
 * id, so the DOM alone cannot say whether a panel already on the page is a
 * rival's or our own orphaned leftover — and those want opposite handling. See
 * the ownership note in init().
 *
 * Reading it can throw in an orphaned context, where chrome.runtime is gone.
 * The fallback keeps that from crashing the guard; it costs nothing, because an
 * instance with no context cannot build a panel to claim in the first place.
 */
function ownerId(): string {
    try {
        return chrome?.runtime?.id ?? 'unknown';
    } catch {
        return 'unknown';
    }
}

// Overlay-style preset tokens → concrete CSS values. These drive the
// --vtt-overlay-* custom properties set inline on #vtt-video-overlay; the
// stylesheet reads them with matching fallbacks (apps/rezka/src/assets/styles.css).
// Font size is a percentage of a 24px base, not a token — the sidebar drives
// it with a slider (50-400, step 5) rather than a fixed set of presets, since
// a 3-way token left the 100-150% range most people want unreachable.
const OVERLAY_SIZE_BASE_PX = 24;
function overlaySizePx(pct: OverlaySizePercent): string {
    return `${(OVERLAY_SIZE_BASE_PX * pct) / 100}px`;
}
// One arrow-key press on the grip moves the captions this far on screen; Shift
// multiplies it. Screen px, converted to a share of the player at the moment of
// the press (see pxToPct), so the felt step is the same in fullscreen and inline
// while the stored value stays proportional.
const NUDGE_STEP_PX = 4;
const NUDGE_STEP_BIG_PX = 20;
// Shown in the caption box while the settings panel is open and the video has no
// line at this moment and no track to borrow one from. It must read as a sample
// of a caption, not as a caption — see .vtt-overlay-placeholder. A function, not
// a const: msg() reads chrome.i18n, which is not ready at module-evaluation
// time, and a const would freeze the English fallback for every locale.
const placeholderCaption = () => msg('ytOverlayPreviewMain', 'Subtitles appear here');

// Share of the PLAYER HEIGHT, not px: the presets were tuned as 40/80/140px on a
// fullscreen 1080p frame, and these are those same values as a fraction of it —
// which is what keeps "medium" at the same place on the small inline player
// instead of climbing to a fifth of the frame. Numbers, not strings, because
// the clamp below does arithmetic on them; applyOverlayStyle adds the unit.
const OVERLAY_BOTTOM_PCT: Record<OverlayLevelToken, number> = {
    low: 3.7,
    medium: 7.4,
    high: 13,
};
// Fallback player height for the px→% conversions when the overlay is not
// mounted yet (or offsetHeight is 0, as in jsdom): a 1080p frame, the reference
// every other overlay unit was tuned at.
const REFERENCE_PLAYER_H = 1080;
const REFERENCE_PLAYER_W = 1920;
const OVERLAY_BG_OPACITY: Record<OverlayBackdropToken, string> = {
    // 'off' is a real transparent box, not a low step: with no box at all the
    // Edge control is the only thing keeping glyphs legible over raw video.
    off: '0',
    low: '0.4',
    medium: '0.7',
    high: '0.9',
};

// Em-based, not px: a 1px shadow reads fine at the 24px base but disappears
// at 400% (96px). Scaling with the glyph keeps the edge visible at every size.
// The edge color is resolved per line in applyOverlayStyle, not hardcoded.
// Black-on-black was invisible: the caption box defaults to black, so a black
// shadow behind the glyphs landed on a black backdrop and the Edge control
// looked broken. applyOverlayStyle derives the color from the CURRENT
// background color, so the edge stays visible whatever box the user picks.
// Built per line against an ALREADY-RESOLVED color rather than left as a var()
// for the stylesheet to substitute -- see the note in applyOverlayStyle.
// Offsets are em so the edge tracks the 50-400% size range.
function edgeValue(style: OverlayEdgeToken, color: string): string {
    switch (style) {
        case 'none':
            return 'none';
        case 'shadow':
            return `0.04em 0.04em 0.13em ${color}`;
        // Faux outline via 4-direction shadows (text-stroke isn't reliable cross-site).
        case 'outline':
            return [
                `-0.045em -0.045em 0 ${color}`,
                `0.045em -0.045em 0 ${color}`,
                `-0.045em 0.045em 0 ${color}`,
                `0.045em 0.045em 0 ${color}`,
            ].join(', ');
    }
}

// Relative luminance of a #rrggbb hex, sRGB coefficients. Used to decide
// whether the edge should be drawn dark or light against the caption box.
function hexLuminance(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// The seven CEA-708 font classes, each resolved to a system stack — nothing
// is bundled (the BBC's own guidance: a platform font beats a shipped one for
// on-screen legibility). 'smallCaps' has no reliable cross-platform typeface,
// so it is font-variant-caps on the proportional-sans stack instead.
const OVERLAY_FONT_STACK: Record<OverlayFontFamily, string> = {
    monoSerif: "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace",
    propSerif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, 'Times New Roman', serif",
    monoSans: "ui-monospace, Menlo, Consolas, 'Cascadia Code', 'DejaVu Sans Mono', 'Liberation Mono', monospace",
    propSans: "Inter, Roboto, 'Helvetica Neue', 'Arial Nova', 'Nimbus Sans', Arial, sans-serif",
    casual: "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, 'Arial Rounded MT Bold', 'Segoe Print', sans-serif",
    cursive: "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', 'Apple Chancery', cursive",
    smallCaps: "Inter, Roboto, 'Helvetica Neue', 'Arial Nova', 'Nimbus Sans', Arial, sans-serif",
};
const OVERLAY_FONT_VARIANT: Record<OverlayFontFamily, string> = {
    monoSerif: 'normal',
    propSerif: 'normal',
    monoSans: 'normal',
    propSans: 'normal',
    casual: 'normal',
    cursive: 'normal',
    smallCaps: 'small-caps',
};

// Fixed color palette offered as swatches in the settings panel. Shared by
// both text swatch rows (main line, translation line) — a custom color well
// alongside each covers anything the five presets don't.
const OVERLAY_COLORS: string[] = ['#ffffff', '#ffd700', '#00e5ff', '#7CFC00', '#ff9800'];
// The caption box sits behind text, so its useful range is neutral, not the
// accent hues offered for the text itself.
const OVERLAY_BG_COLORS: string[] = ['#000000', '#3a3a3a', '#7a7a7a', '#ffffff', '#0a1a3c'];

// The two Reset buttons' payloads — one per panel group, each resetting only
// the fields in its own group. Neither includes overlayEnabled: Reset
// restores DEFAULT appearance, not the on/off state; a user who turned the
// overlay off and then reset styling would not expect it to switch back on.
const OVERLAY_TEXT_DEFAULTS: Pick<
    Prefs,
    'overlayFontFamily' | 'overlayFontSize' | 'overlayColor' | 'overlaySubFontSize' | 'overlaySubColor' | 'overlayTextOpacity'
> = {
    overlayFontFamily: 'propSans',
    overlayFontSize: 100,
    overlayColor: '#ffffff',
    overlaySubFontSize: 75,
    overlaySubColor: '#ffd700',
    overlayTextOpacity: 1,
};

const OVERLAY_BOX_DEFAULTS: Pick<
    Prefs,
    | 'overlayBgColor'
    | 'overlayBottomOffset'
    | 'overlayBottomNudge'
    | 'overlayInlineNudge'
    | 'overlayBgOpacity'
    | 'overlayEdgeStyle'
> = {
    overlayBgColor: '#000000',
    overlayBottomOffset: 'medium',
    overlayBottomNudge: 0,
    overlayInlineNudge: 0,
    overlayBgOpacity: 'medium',
    overlayEdgeStyle: 'shadow',
};

// Union of both — the initial value of the local overlayStyle mirror, before
// prefs are hydrated.
const OVERLAY_STYLE_DEFAULTS: Pick<
    Prefs,
    | 'overlayFontFamily'
    | 'overlayFontSize'
    | 'overlayColor'
    | 'overlaySubFontSize'
    | 'overlaySubColor'
    | 'overlayTextOpacity'
    | 'overlayBgColor'
    | 'overlayBottomOffset'
    | 'overlayBottomNudge'
    | 'overlayInlineNudge'
    | 'overlayBgOpacity'
    | 'overlayEdgeStyle'
> = { ...OVERLAY_TEXT_DEFAULTS, ...OVERLAY_BOX_DEFAULTS };

// All panel iconography is inline stroke SVG so it inherits currentColor and
// needs no bundled assets.
function svgIcon(inner: string): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export const ICONS = {
    gear: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    back: svgIcon('<path d="M15 18l-6-6 6-6"/>'),
    languages: svgIcon('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    reading: svgIcon('<path d="M2 6s3-2 10-2 10 2 10 2v12s-3-2-10-2-10 2-10 2z" opacity=".4"/><path d="M12 4v14"/>'),
    appearance: svgIcon('<path d="M4 7V5h16v2M9 19h6M12 5v14"/>'),
    chevron: svgIcon('<path d="M6 9l6 6 6-6"/>'),
    privacy: svgIcon('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>'),
    // Speech bubble, not a warning triangle or a bug: this is an invitation to
    // say something, and an alert glyph would read as "something is broken
    // right now" every time the panel is open.
    feedback: svgIcon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
    // Arrow into a tray — the download glyph everywhere, so it needs no
    // label to be understood at 14px.
    download: svgIcon('<path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
    swap: svgIcon('<path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>'),
    // Mode glyphs share one visual language — subtitle bars — instead of
    // abstractions (the old "?" read as Help/FAQ, the columns as split view).
    // single: one subtitle line; dual: two stacked subtitle lines; guess: a
    // line with mask dots below it (text → "•••"); onScreen: a video frame
    // with a caption bar inside.
    single: svgIcon('<rect x="3" y="9" width="18" height="6" rx="1.5"/>'),
    dual: svgIcon('<rect x="3" y="5" width="18" height="6" rx="1.5"/><rect x="3" y="13.5" width="18" height="6" rx="1.5"/>'),
    guess: svgIcon('<rect x="3" y="5" width="18" height="6" rx="1.5"/><circle cx="6.5" cy="16.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="16.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="17.5" cy="16.5" r="1.4" fill="currentColor" stroke="none"/>'),
    onScreen: svgIcon('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M6 14.5h12"/>'),
    // Theme presets: a half-filled circle for "follow the OS", sun, moon.
    // Stroke-drawn like every other panel icon; the auto glyph's filled half
    // is the one deliberate solid — it IS the picture (half light, half dark).
    themeAuto: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>'),
    themeLight: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
    themeDark: svgIcon('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
    posLow: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 17h8"/>'),
    posMid: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 13h8"/>'),
    posHigh: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8"/>'),
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#1b1c20" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>',
};

type ScrollMode = 'smooth' | 'instant';

function hasSelectionInside(el: Element): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return el.contains(sel.getRangeAt(0).commonAncestorContainer);
}

// Should this click uncover the next word? A click on a masked word always
// means reveal — that word cannot be part of a selection, so nothing else could
// have been intended. Anywhere else in the line, a live selection still wins:
// the user is reaching for the quick-add pill, not the reveal.
function shouldReveal(e: MouseEvent, container: Element): boolean {
    const target = e.target as Element | null;
    if (target?.closest?.('.vtt-masked-word')) return true;
    return !hasSelectionInside(container);
}

export class SidebarUI {
    state: AppState;
    app: AppInterface;
    elements: SidebarElements;
    hoverStartIndex: number = -1;
    // Presentation-only overlay style prefs. Held locally (AppState owns
    // playback/track state); mirrored to chrome.storage.local via savePrefs.
    private overlayStyle = { ...OVERLAY_STYLE_DEFAULTS };

    // Panel theme, mirrored from prefs. Separate from overlayStyle: it is not
    // part of what the appearance Reset restores (see the control's comment).
    private theme: ThemeToken = 'dark';
    // Which site's appearance this sidebar reads and writes. Overlay style is
    // per streaming site (youtube.com and netflix.com ship in ONE extension, so
    // one storage area serves both), and derived from the host rather than
    // passed in: the class has 9 construction sites across 3 apps and the
    // tests, none of which would otherwise care.
    private readonly scope: PrefScope = platformOf(location.hostname);
    // Where the sidebar lives outside fullscreen; captured on the way in so it
    // can be put back exactly there (see setupFullscreenHandling).
    private homeParent: HTMLElement | null = null;
    // Teardown for everything bound outside the sidebar's own subtree —
    // document/chrome.storage listeners that removing the DOM would not undo.
    // The extensions live for the page's lifetime and never call destroy(), but
    // an embed (packages/embed) can remount, and a stale instance still
    // listening for `fullscreenchange` would resurrect its own sidebar.
    private teardown: Array<() => void> = [];

    constructor(state: AppState, app: AppInterface) {
        this.state = state;
        this.app = app;
        this.elements = {};
    }

    init(): boolean {
        // A #vtt-sidebar already on the page is usually another installed copy
        // of the extension (the store build alongside an unpacked one — the ids
        // are shared, so writing into it produces a franken-panel). But it can
        // equally be OUR OWN panel, left behind by the instance this reload
        // just orphaned: Chrome tears the old context away and leaves its DOM
        // standing, then injects us into the same page.
        //
        // Those two cases need opposite handling, and the id alone cannot tell
        // them apart — hence the owner stamp. Yielding to a dead panel of ours
        // is how the "extension updated" notice came to be missing on YouTube:
        // the orphaned instance's watcher died with its context, and the fresh
        // instance returned here before it could start a new one.
        const existing = document.getElementById('vtt-sidebar');
        if (existing) {
            const owner = existing.dataset.vttOwner;
            // An UNSTAMPED panel is the release that ships this very mechanism:
            // the build being replaced stamped nothing, so on the auto-update
            // that delivers this code the leftover panel carries no owner. Read
            // strictly, that is "not ours" and we would yield — leaving the
            // notice missing on exactly the upgrade it was written for, and on
            // that edition's every user, once.
            //
            // Deleting it is the destructive reading and stays off the table: a
            // rival's live panel must not lose its UI to us. So claim the id
            // instead — silent and reversible — and yield the build as before.
            // The claim is what makes the NEXT injection decisive: from here the
            // panel is stamped, so a later reload takes the reclaim branch above
            // and the notice appears then.
            //
            // What the upgrade itself still needs is the announcement, and that
            // does not require owning the panel — only a panel to render into,
            // which the corpse on screen is. When our own context is already
            // gone there is nothing to own anyway, and the user is looking at
            // precisely the frozen panel this notice explains.
            //
            // One release and this branch is dead code: every build from here
            // stamps, so an unstamped panel can only be a leftover of the
            // version that introduced stamping.
            if (owner === undefined) {
                existing.dataset.vttOwner = ownerId();
                if (isContextOrphaned()) showOrphanNotice();
                return false;
            }
            if (owner !== ownerId()) return false;
            // Ours, and dead — the live instance would still be answering.
            // Take the page back: drop the stale panel and build a new one.
            existing.remove();
            document.getElementById('vtt-toggle-btn')?.remove();
            document.getElementById('vtt-video-overlay')?.remove();
        }

        const sidebar = document.createElement('div');
        sidebar.id = 'vtt-sidebar';
        // Stamped so a later injection can recognise its own leftovers; see the
        // ownership note above. Falls back to a constant when the context is
        // already gone, which only affects a panel that could never be built.
        sidebar.dataset.vttOwner = ownerId();

        // Space belongs to the video. A button that was clicked with the mouse
        // keeps focus and then eats every Space that follows — the viewer aims
        // for play/pause and toggles our button instead. Drop focus once the
        // click is handled. Keyboard users are unaffected: :focus-visible is
        // false for pointer-driven focus, and text inputs need Space to type.
        sidebar.addEventListener('click', (e) => {
            const el = (e.target as HTMLElement)?.closest?.('button');
            if (el && !el.matches(':focus-visible')) (el as HTMLElement).blur();
        });

        // Toggle Button. A div rather than a button (it predates the rest), so
        // it has to borrow button semantics by hand — without these it's
        // unreachable by keyboard and anonymous to a screen reader.
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'vtt-toggle-btn';
        toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        toggleBtn.setAttribute('role', 'button');
        toggleBtn.setAttribute('tabindex', '0');
        toggleBtn.setAttribute('aria-label', msg('ytTogglePanel', 'Toggle panel'));
        toggleBtn.setAttribute('aria-controls', 'vtt-sidebar');
        toggleBtn.addEventListener('click', () => {
            this.toggleCollapsed();
            // Hand focus back after a mouse click. Otherwise the tab keeps it
            // and swallows every following Space — the key the viewer means for
            // the video's play/pause, not for us.
            if (!toggleBtn.matches(':focus-visible')) toggleBtn.blur();
        });
        toggleBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); // Space would scroll the page
                this.toggleCollapsed();
            }
        });
        sidebar.appendChild(toggleBtn);
        this.elements = { ...this.elements, toggleBtn };

        // Header Container
        const header = document.createElement('div');
        header.id = 'vtt-header';

        // Dev-only backend switch, pinned above the title — not tucked into the
        // settings panel, where it sat below the fold and got missed. This is
        // the only thing telling you whether a dev build is writing to real
        // user data, so it is meant to be impossible to overlook.
        //
        // Guarded on the __EXT_ENV__ literal, which Vite replaces before
        // minification, so the block is unreachable — and dropped — in shipped
        // builds.
        if (__EXT_ENV__ === 'dev') {
            const envBtn = document.createElement('button');
            envBtn.id = 'vtt-env-switch';
            envBtn.type = 'button';
            envBtn.textContent = 'backend: …';
            header.appendChild(envBtn);
            this.wireEnvSwitch(envBtn);
        }

        const headerTop = document.createElement('div');
        headerTop.id = 'vtt-header-top';
        // Localized via the shared i18n helper (honors the demo override, then
        // chrome.i18n, then the English fallback). Swapped to "Settings" while
        // the settings panel is open (mobile-nav pattern).
        const titleEl = document.createElement('h2');
        titleEl.textContent = msg('ytSidebarTitle', 'Subtitles');
        headerTop.appendChild(titleEl);

        // Back chip, visible only in settings mode (CSS): "‹ Subtitles" — a
        // labeled exit that names its destination.
        const backBtn = document.createElement('button');
        backBtn.id = 'vtt-back-btn';
        backBtn.className = 'vtt-back-chip';
        backBtn.type = 'button';
        backBtn.innerHTML = `${ICONS.back}<span>${msg('ytSidebarTitle', 'Subtitles')}</span>`;
        backBtn.addEventListener('click', () => this.toggleSettingsPanel());
        headerTop.appendChild(backBtn);

        // Second back chip, for the feedback screen: "‹ Settings". Shares the
        // .vtt-back-chip class with the one above so the two stay identical —
        // they are the same control pointing at different destinations, and the
        // styling used to live on #vtt-back-btn alone, which left this one
        // without even a sized arrow. The ids only drive visibility.
        const feedbackBackBtn = document.createElement('button');
        feedbackBackBtn.id = 'vtt-feedback-back-btn';
        feedbackBackBtn.className = 'vtt-back-chip';
        feedbackBackBtn.type = 'button';
        feedbackBackBtn.innerHTML = `${ICONS.back}<span>${msg('ytSettingsTitle', 'Settings')}</span>`;
        feedbackBackBtn.addEventListener('click', () => this.closeFeedbackScreen());
        headerTop.appendChild(feedbackBackBtn);
        this.elements = { ...this.elements, feedbackBackBtn };

        // Download, left of the gear: the header is where the actions on THIS
        // video live, and downloading is one click deep, so it gets a button
        // rather than a settings row. Icon-only for the same reason the gear
        // is — the header holds a title and two glyphs, and a word here would
        // crowd the one thing that names the panel.
        const downloadBtn = document.createElement('button');
        downloadBtn.id = 'vtt-download-btn';
        downloadBtn.type = 'button';
        downloadBtn.innerHTML = ICONS.download;
        downloadBtn.addEventListener('click', () => this.downloadTrack());
        headerTop.appendChild(downloadBtn);
        this.elements = { ...this.elements, downloadBtn };

        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'vtt-settings-btn';
        settingsBtn.type = 'button';
        settingsBtn.setAttribute('aria-label', msg('ytSettingsTitle', 'Settings'));
        settingsBtn.setAttribute('aria-expanded', 'false');
        settingsBtn.setAttribute('aria-controls', 'vtt-settings-panel');
        settingsBtn.style.display = 'flex'; // Always visible now
        settingsBtn.innerHTML = ICONS.gear;
        settingsBtn.addEventListener('click', () => this.toggleSettingsPanel());
        headerTop.appendChild(settingsBtn);
        header.appendChild(headerTop);

        // Sub-header: a single row under the title holding the language-pair
        // chip (app-level, prepended into this slot) on the left and the
        // icon-only quick-mode bar (Swap · Dual · Guess · On-screen) on the
        // right — modes switch without opening settings and without spending
        // an extra row. Children carry their own vertical margins so the row
        // collapses to nothing when both are absent.
        const subheader = document.createElement('div');
        subheader.id = 'vtt-subheader';
        subheader.appendChild(this.buildQuickModes());
        header.appendChild(subheader);

        // Settings Panel — three labeled groups: Languages, Reading mode,
        // Overlay appearance (v2 redesign; see plans/fancy-yawning-crown.md).
        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'vtt-settings-panel';

        // -- Theme strip -------------------------------------------------------
        // One-line row above the groups: label left, icon segment right (auto /
        // sun / moon). Deliberately NOT a group — a heading plus a stacked row
        // would spend ~90px on a control the icons explain by themselves, and
        // the theme is about the panel, not the captions, so it does not belong
        // under either Reset-bearing appearance group. It reads as a utility
        // strip, visually lighter than the Languages heading below it, so
        // sitting first does not out-rank the settings people came for.
        // The per-option title tooltips (buildSegRow) carry the words the
        // icons dropped.
        // Netflix is dark-only (see themeAvailable in content/theme.ts), so it
        // gets no theme strip at all rather than a control that does nothing —
        // a visible setting that has no effect reads as broken. The global
        // preference still exists and still applies on the other sites.
        if (this.scope !== 'netflix') {
            const themeStrip = document.createElement('div');
            themeStrip.className = 'vtt-theme-strip';
            this.elements.themeBtns = this.buildSegRow(
                themeStrip,
                msg('ytThemeLabel', 'Theme'),
                [
                    { value: 'auto', html: ICONS.themeAuto, name: msg('ytThemeAuto', 'Auto') },
                    { value: 'light', html: ICONS.themeLight, name: msg('ytThemeLight', 'Light') },
                    { value: 'dark', html: ICONS.themeDark, name: msg('ytThemeDark', 'Dark') },
                ],
                (v) => this.setTheme(v as ThemeToken),
            );
            // The icons need to answer "which is active?" and "what does this one
            // do?" faster than a native title tooltip (~1s hover delay) can.
            // Two moves:
            //  - a live readout of the active mode's name sits right before the
            //    segment, so the answer is on screen with no hover at all;
            //  - the per-option bubbles reuse the quickmodes data-tip pattern
            //    (instant CSS, ~0.15s) instead of `title`. The native title is
            //    removed so the browser doesn't stack its slow bubble on top,
            //    and aria-label keeps the name the title used to provide.
            {
                const row = themeStrip.querySelector('.vtt-style-row');
                const value = document.createElement('span');
                value.className = 'vtt-theme-value';
                this.elements.themeValueEl = value;
                row?.insertBefore(value, row.querySelector('.vtt-seg'));
                const tips: Record<string, string> = {
                    auto: msg('ytThemeAutoTip', 'Auto — follows your system theme'),
                    light: msg('ytThemeLight', 'Light'),
                    dark: msg('ytThemeDark', 'Dark'),
                };
                for (const b of this.elements.themeBtns) {
                    const v = b.dataset.value ?? '';
                    b.setAttribute('aria-label', b.title);
                    b.removeAttribute('title');
                    b.dataset.tip = tips[v] ?? v;
                }
            }
            settingsPanel.appendChild(themeStrip);
        }

        // -- Group 1: Languages ------------------------------------------------
        const langGroup = this.buildGroup(ICONS.languages, msg('ytGroupLanguages', 'Languages'));

        const mainSelect = document.createElement('select');
        mainSelect.id = 'vtt-main-select';
        mainSelect.className = 'vtt-select';
        mainSelect.addEventListener('change', (e) => {
            this.onTrackSelectChange('learning', (e.target as HTMLSelectElement).value);
        });

        const subSelect = document.createElement('select');
        subSelect.id = 'vtt-sub-select';
        subSelect.className = 'vtt-select';
        subSelect.addEventListener('change', (e) => {
            this.onTrackSelectChange('native', (e.target as HTMLSelectElement).value);
        });

        const fields = document.createElement('div');
        fields.id = 'vtt-track-selectors';
        fields.appendChild(this.buildFieldRow(msg('ytLearningLabel', 'Learning'), mainSelect));
        fields.appendChild(this.buildFieldRow(msg('ytNativeLabel', 'Native'), subSelect));
        langGroup.appendChild(fields);
        settingsPanel.appendChild(langGroup);

        // The reading-mode chips used to sit here as their own group. They were
        // a duplicate of the sub-header quick-modes bar — same four modes, same
        // setMode calls, same shortcuts — so the group was pure panel real
        // estate. The bar is the single home for mode switching now; the
        // elements below that updateControls needs point at its buttons.

        // -- Group 3: Overlay appearance, split by the question the user is
        // actually asking. "The text is hard to read" and "it's in the way /
        // sitting on the wrong spot" are different problems that are rarely
        // fixed together — so they get their own group and their own Reset,
        // each touching only the fields the user was just looking at.
        const textGroup = this.buildGroup(ICONS.appearance, msg('ytGroupText', 'Text'));
        const textResetBtn = document.createElement('button');
        textResetBtn.className = 'vtt-reset';
        textResetBtn.textContent = msg('ytStyleReset', 'Reset');
        textResetBtn.addEventListener('click', () => this.resetTextStyle());
        (textGroup.firstChild as HTMLElement).appendChild(textResetBtn);

        textGroup.appendChild(this.buildTextStyleControls());
        settingsPanel.appendChild(textGroup);

        const boxGroup = this.buildGroup(ICONS.onScreen, msg('ytGroupBox', 'Background & position'));
        const boxResetBtn = document.createElement('button');
        boxResetBtn.className = 'vtt-reset';
        boxResetBtn.textContent = msg('ytStyleReset', 'Reset');
        boxResetBtn.addEventListener('click', () => this.resetBoxStyle());
        (boxGroup.firstChild as HTMLElement).appendChild(boxResetBtn);

        boxGroup.appendChild(this.buildBoxStyleControls());
        settingsPanel.appendChild(boxGroup);


        // -- Tail rows -----------------------------------------------------------
        // Two rows of one anatomy close the panel: the analytics opt-out (a
        // setting, so it scrolls with the settings) and "Report a problem"
        // (not "Leave feedback" — the point is to catch the unhappy user
        // before they leave a one-star review instead). Neither is a
        // buildGroup: a heading would out-shout Languages for things people
        // touch once or never. Hairline-separated rows in the groups' icon
        // column, same weight as each other.
        settingsPanel.appendChild(this.buildAnalyticsToggle());

        const feedbackLink = document.createElement('button');
        feedbackLink.id = 'vtt-feedback-link';
        feedbackLink.type = 'button';
        feedbackLink.className = 'vtt-panel-row vtt-feedback-link';
        feedbackLink.innerHTML = `${ICONS.feedback}<span>${msg('ytFeedbackLink', 'Report a problem')}</span>`;
        feedbackLink.addEventListener('click', () => this.openFeedbackScreen());
        settingsPanel.appendChild(feedbackLink);
        this.elements = { ...this.elements, feedbackLink };

        // Exits from settings are the header "‹ Subtitles" back chip and the gear
        // toggle; no separate Done button at the panel bottom.
        header.appendChild(settingsPanel);

        // Feedback screen — a sibling takeover of the settings panel, populated
        // on open (buildFeedbackScreen) so the auth state is read fresh each
        // time rather than frozen at sidebar-construction time.
        const feedbackPanel = document.createElement('div');
        feedbackPanel.id = 'vtt-feedback-panel';
        header.appendChild(feedbackPanel);

        sidebar.appendChild(header);

        // Subtitles List
        const list = document.createElement('div');
        list.id = 'vtt-list';
        sidebar.appendChild(list);

        document.body.appendChild(sidebar);

        // Store DOM references (style preset controls registered in buildTextStyleControls/buildBoxStyleControls).
        this.elements = {
            ...this.elements,
            sidebar, settingsBtn, settingsPanel, mainSelect, subSelect, list,
            titleEl, backBtn, feedbackPanel,
        };

        // Hover interactions. While hovering, highlightSubtitle skips scrolls
        // but still moves the active-sub class, so on mouseleave we may need to
        // catch up — compared against the snapshot taken on mouseenter.
        sidebar.addEventListener('mouseenter', () => {
            this.state.isHovering = true;
            this.hoverStartIndex = this.state.currentIndex;
        });
        sidebar.addEventListener('mouseleave', () => {
            this.state.isHovering = false;
            this.scrollActiveIntoView(this.pickScrollMode(this.state.currentIndex, this.hoverStartIndex));
        });

        const isTopWindow = window === window.top;
        if (isTopWindow) {
            document.body.classList.add('vtt-sidebar-active');
        } else {
            sidebar.style.display = 'none';
        }

        this.setupFullscreenHandling();
        this.hydrateFromPrefs();
        return true;
    }

    // A labeled panel section: hairline-separated container with an uppercase
    // header (icon + title + flexible spacer for trailing actions like Reset).
    private buildGroup(iconSvg: string, title: string): HTMLDivElement {
        const group = document.createElement('div');
        group.className = 'vtt-group';
        const head = document.createElement('div');
        head.className = 'vtt-group-head';
        head.innerHTML = `${iconSvg}<span>${title}</span><span class="vtt-group-spacer"></span>`;
        group.appendChild(head);
        return group;
    }

    /**
     * The track the download acts on: the main one only — the one the list
     * renders and the one being learned. The native track is the translation
     * crutch, not the thing anyone takes away to study, and offering both
     * turned one action into a choice the user had to make every time.
     *
     * Read at call time rather than closed over: the dropdowns, the swap chip
     * and (on Netflix) an on-demand language fetch can all have moved the
     * indexes since the button was built.
     */
    private downloadableTrack(): Track | undefined {
        return this.state.tracks[this.state.activeTrackIndex];
    }

    /** Write the main subtitle track to an .srt file. */
    downloadTrack(): void {
        downloadTrack(this.downloadableTrack(), document.title, this.scope);
    }

    /** Whether there is a main track worth writing to a file. */
    canDownload(): boolean {
        return isDownloadable(this.downloadableTrack());
    }

    /**
     * Sync the header download button with what is actually loaded. Called from
     * updateControls, alongside every other track-dependent control.
     */
    private updateDownloadButton(): void {
        const btn = this.elements.downloadBtn;
        if (!btn) return;

        const track = this.downloadableTrack();
        const label = msg('ytDownloadSubs', 'Download subtitles');
        btn.setAttribute('aria-label', label);

        // Disabled rather than hidden: the header's three slots are fixed, and
        // a glyph appearing and vanishing beside the gear reads as a layout
        // twitch. The tooltip carries the reason either way.
        if (isDownloadable(track)) {
            btn.disabled = false;
            btn.title = `${label} — ${track.name} (.srt)`;
        } else {
            btn.disabled = true;
            btn.title = msg('ytDownloadEmpty', 'Available once subtitles have loaded.');
        }
    }

    /**
     * The analytics opt-out, mirroring the one in the toolbar popup.
     *
     * A native checkbox rather than a styled div: it gets keyboard focus, the
     * platform focus ring, and screen-reader semantics for free — and this is
     * the one control in the panel where being operable matters legally, not
     * just aesthetically.
     *
     * Rendered checked, then corrected once prefs resolve. Flashing "off" on a
     * privacy control reads far worse than the reverse: a user who glances at
     * it mid-load would think collection was already disabled.
     */
    private buildAnalyticsToggle(): HTMLLabelElement {
        // Anatomy mirrors .vtt-feedback-link below it — icon, label, one line —
        // so the footer reads as one band, not two leftovers. The state lives
        // in a trailing mini-switch, the settings idiom for a live toggle
        // (a checkbox here read as "form field", which this is not).
        const label = document.createElement('label');
        label.className = 'vtt-panel-row';
        label.innerHTML = `${ICONS.privacy}<span class="vtt-privacy-text">${msg(
            'ytPrivacyAnalyticsLabel',
            'Share anonymous usage stats',
        )}</span>`;

        // The full sentence lives in the tooltip rather than a second line:
        // the footer is a one-line-per-row band, and spelling out what is and
        // is not collected inline would make privacy the loudest thing here.
        // The policy carries the same wording in full.
        label.title = msg(
            'ytPrivacyAnalyticsHint',
            'Counts like "subtitles loaded" and "word saved". Never your account, the videos you watch, or the words you save.',
        );

        // A real checkbox drives the switch: keyboard, focus and screen-reader
        // semantics stay native, only the pixels are ours. It is visually
        // hidden by CSS, and :focus-visible re-surfaces as a ring on the track.
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = 'vtt-analytics-toggle';
        box.className = 'vtt-switch-input';
        box.checked = true;

        const track = document.createElement('span');
        track.className = 'vtt-switch';
        track.setAttribute('aria-hidden', 'true');

        label.appendChild(box);
        label.appendChild(track);

        void loadPrefs().then((p) => {
            box.checked = p.analyticsEnabled;
        });
        box.addEventListener('change', () => {
            const on = box.checked;
            // Sent BEFORE the preference is written, so this final hit still
            // passes the gate. Opting back in isn't tracked: analytics is on
            // for everyone by default, so that event could only ever measure
            // re-enables. Same ordering as the popup's copy of this control.
            if (!on) trackVia('analytics_opt_out');
            void savePrefs({ analyticsEnabled: on });
        });

        return label;
    }

    // Label + select field row with a custom chevron (the select itself is
    // appearance:none so the chevron is ours).
    private buildFieldRow(label: string, select: HTMLSelectElement): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'vtt-field-row';
        // A real <label for> rather than a bare span: without it the select is
        // announced only as "combo box" and the Learning/Native distinction —
        // the whole point of the pair — is invisible to a screen reader.
        const labelEl = document.createElement('label');
        labelEl.className = 'vtt-field-label';
        labelEl.htmlFor = select.id;
        labelEl.textContent = label;
        const wrap = document.createElement('div');
        wrap.className = 'vtt-select-wrap';
        wrap.appendChild(select);
        const chevron = document.createElement('span');
        chevron.className = 'vtt-select-chevron';
        chevron.innerHTML = ICONS.chevron;
        wrap.appendChild(chevron);
        row.appendChild(labelEl);
        row.appendChild(wrap);
        return row;
    }

    // Full-width mode bar in the sub-header row: Single · Dual · Guess as a
    // segmented control whose ACTIVE segment expands into a labeled pill
    // (icon + name), plus the independent On-screen toggle, permanently
    // labeled. The sole home for mode switching — the settings panel used to
    // carry a second copy. No "Modes" micro-label: the active pill and the
    // toggle's caption name the cluster themselves. Swap lives on the
    // language-pair chip (clicking the pair swaps the tracks), so it has no
    // button here.
    private buildQuickModes(): HTMLDivElement {
        const bar = document.createElement('div');
        bar.id = 'vtt-quickmodes';
        bar.style.display = 'none'; // updateControls shows it once tracks exist
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', msg('ytGroupReadingMode', 'Reading mode'));
        const inner = bar;

        // `role` is 'radio' for the exclusive Dual/Guess segments, 'switch'
        // for the independent On-screen toggle. Both state via aria-checked.
        const makeBtn = (id: string, iconSvg: string, label: string, shortcut: string, role: 'radio' | 'switch'): HTMLButtonElement => {
            const btn = document.createElement('button');
            btn.id = id;
            btn.className = 'vtt-qm';
            // Custom instant tooltip (CSS ::after on [data-tip]) instead of the
            // native title, which lags ~1s and never shows on keyboard focus.
            btn.dataset.tip = shortcut ? `${label} (${shortcut})` : label;
            // Kept so updateControls can swap in a "why is this off" reason and
            // put the plain label back afterwards.
            btn.dataset.baseTip = btn.dataset.tip;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('role', role);
            btn.setAttribute('aria-checked', 'false');
            btn.innerHTML = iconSvg;
            // Visible name next to the icon. For the radio segments CSS keeps
            // it collapsed except on the active one — the label rides the
            // pill, teaching the icons one selection at a time. The On-screen
            // toggle shows its label permanently (an icon-only switch proved
            // unreadable). textContent, not innerHTML: locale strings are data.
            const text = document.createElement('span');
            text.className = 'vtt-qm-text';
            text.textContent = label;
            btn.appendChild(text);
            return btn;
        };

        // The three reading modes share a segmented track — radiogroup
        // semantics, exactly one always selected. The fill sits on the active
        // button itself (no sliding thumb: segments are variable-width now —
        // the active one grows to fit its label, animated via flex-grow, and a
        // fixed-geometry thumb cannot follow that). Single used to be the
        // hidden "neither" state of two toggles, which read as a third mode
        // smuggled into an off switch.
        const seg = document.createElement('div');
        seg.className = 'vtt-modeseg';
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', msg('ytGroupReadingMode', 'Reading mode'));

        const qmSingleBtn = makeBtn('vtt-qm-single', ICONS.single, msg('ytModeSingle', 'Single'), '', 'radio');
        qmSingleBtn.addEventListener('click', () => this.setMode('single'));
        seg.appendChild(qmSingleBtn);

        const qmDualBtn = makeBtn('vtt-qm-dual', ICONS.dual, msg('ytModeDual', 'Dual'), 'Shift+D', 'radio');
        // aria-disabled keeps it hoverable so it can explain itself (see
        // updateControls), so the off state is enforced here.
        qmDualBtn.addEventListener('click', () => {
            if (qmDualBtn.getAttribute?.('aria-disabled') === 'true') return;
            this.setMode('dual');
        });
        seg.appendChild(qmDualBtn);

        const qmGuessBtn = makeBtn('vtt-qm-guess', ICONS.guess, msg('ytModeGuess', 'Guess'), 'Shift+G', 'radio');
        qmGuessBtn.addEventListener('click', () => this.setMode('guess'));
        seg.appendChild(qmGuessBtn);
        inner.appendChild(seg);

        // Hairline: exclusive mode choice (left) vs. the independent overlay
        // toggle (right).
        const sep = document.createElement('span');
        sep.className = 'vtt-qm-sep';
        inner.appendChild(sep);

        const qmOverlayBtn = makeBtn('vtt-qm-overlay', ICONS.onScreen, msg('ytModeOnScreen', 'On-screen'), 'Shift+O', 'switch');
        qmOverlayBtn.classList.add('vtt-qm-toggle');
        // A real switch track after the icon: the knob's position states on/off
        // on its own, where the old filled-button look only read as "on"
        // against the memory of its unfilled self.
        const overlayTrack = document.createElement('span');
        overlayTrack.className = 'vtt-qm-switch';
        overlayTrack.setAttribute('aria-hidden', 'true');
        qmOverlayBtn.appendChild(overlayTrack);
        qmOverlayBtn.addEventListener('click', () => this.toggleOverlay());
        inner.appendChild(qmOverlayBtn);

        this.elements = { ...this.elements, quickModesBar: bar, qmSingleBtn, qmDualBtn, qmGuessBtn, qmOverlayBtn };
        return bar;
    }

    // The overlay-style preset rows: segmented controls (with a sliding thumb)
    // for size / position / backdrop / edge, and a swatch row for color.
    // Text appearance: font, both line sizes, both line colors, glyph opacity.
    // Everything a user reaches for when the TEXT itself is the problem.
    private buildTextStyleControls(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.id = 'vtt-style-controls-text';

        const FONT_OPTIONS: { value: OverlayFontFamily; name: string }[] = [
            { value: 'monoSerif', name: msg('ytFontMonoSerif', 'Monospaced Serif') },
            { value: 'propSerif', name: msg('ytFontPropSerif', 'Proportional Serif') },
            { value: 'monoSans', name: msg('ytFontMonoSans', 'Monospaced Sans-Serif') },
            { value: 'propSans', name: msg('ytFontPropSans', 'Proportional Sans-Serif') },
            { value: 'casual', name: msg('ytFontCasual', 'Casual') },
            { value: 'cursive', name: msg('ytFontCursive', 'Cursive') },
            { value: 'smallCaps', name: msg('ytFontSmallCaps', 'Small Capitals') },
        ];
        this.elements.styleFontSelect = this.buildFontSelectRow(
            wrap,
            msg('ytStyleFontLabel', 'Font family'),
            FONT_OPTIONS,
            (v) => this.setOverlayFontFamily(v as OverlayFontFamily),
        );

        this.elements.styleSizeSlider = this.buildSliderRow(
            wrap,
            'vtt-slider-size',
            msg('ytStyleSizeLabel', 'Size'),
            (v) => this.setOverlayFontSize(v),
        );

        this.elements.styleColorBtns = this.buildSwatchRow(
            wrap,
            msg('ytStyleColorLabel', 'Color'),
            OVERLAY_COLORS,
            (v) => this.setOverlayColor(v),
        );

        this.elements.styleSubSizeSlider = this.buildSliderRow(
            wrap,
            'vtt-slider-sub-size',
            msg('ytStyleSubSizeLabel', 'Translation size'),
            (v) => this.setOverlaySubFontSize(v),
        );

        this.elements.styleSubColorBtns = this.buildSwatchRow(
            wrap,
            msg('ytStyleSubColorLabel', 'Translation color'),
            OVERLAY_COLORS,
            (v) => this.setOverlaySubColor(v),
        );

        this.elements.styleTextOpacityBtns = this.buildSegRow(
            wrap,
            msg('ytStyleTextOpacityLabel', 'Font opacity'),
            [25, 50, 75, 100].map((pct) => ({ value: String(pct), html: `${pct}%` })),
            (v) => this.setOverlayTextOpacity(Number(v) / 100),
        );

        return wrap;
    }

    // Box + placement: the caption's background and where it sits on the
    // video. Everything a user reaches for when the OVERLAY, not the text,
    // is the problem — obscuring the picture, sitting on the control bar.
    private buildBoxStyleControls(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.id = 'vtt-style-controls-box';

        this.elements.styleBgColorBtns = this.buildSwatchRow(
            wrap,
            msg('ytStyleBgColorLabel', 'Background color'),
            OVERLAY_BG_COLORS,
            (v) => this.setOverlayBgColor(v),
        );

        this.elements.styleBgBtns = this.buildSegRow(
            wrap,
            msg('ytStyleBgLabel', 'Backdrop'),
            [
                { value: 'off', html: msg('ytBackdropOff', 'Off') },
                { value: 'low', html: msg('ytBackdropLight', 'Light') },
                { value: 'medium', html: msg('ytBackdropMedium', 'Medium') },
                { value: 'high', html: msg('ytBackdropSolid', 'Solid') },
            ],
            (v) => this.setOverlayBgOpacity(v as OverlayBackdropToken),
        );

        this.elements.styleOffsetBtns = this.buildSegRow(
            wrap,
            msg('ytStyleOffsetLabel', 'Position'),
            [
                { value: 'low', html: ICONS.posLow },
                { value: 'medium', html: ICONS.posMid },
                { value: 'high', html: ICONS.posHigh },
            ],
            (v) => this.setOverlayBottomOffset(v as OverlayLevelToken),
        );

        this.elements.styleEdgeBtns = this.buildSegRow(
            wrap,
            msg('ytStyleEdgeLabel', 'Edge'),
            [
                { value: 'none', html: msg('ytEdgeNone', 'None') },
                { value: 'shadow', html: msg('ytEdgeShadow', 'Shadow') },
                { value: 'outline', html: msg('ytEdgeOutline', 'Outline') },
            ],
            (v) => this.setOverlayEdgeStyle(v as OverlayEdgeToken),
        );

        // Mark once at construction, as the pre-split buildStyleControls did.
        // hydrateFromPrefs marks again from storage, but it is async and its
        // loadPrefs is `.catch`-swallowed — without this the controls would sit
        // unmarked (no active segment, sliders at the browser default with no
        // readout) whenever that read fails.
        this.markActiveStyleButtons();

        return wrap;
    }

    // One labeled segmented control: equal-width buttons over a sliding thumb.
    // A full-width dropdown row: label above, select spanning the panel. Used
    // only for the font list — CEA-708 class names run to ~28 characters
    // ("Пропорциональный с засечками" in Russian) and are unreadable squeezed
    // into the standard label-column / 1fr control track every other row
    // uses. Reuses .vtt-select/.vtt-select-wrap styling (same visual language
    // as the Languages group's dropdowns) but not buildFieldRow's grid, which
    // assumes a fixed label column this row deliberately doesn't have.
    private buildFontSelectRow(
        parent: HTMLElement,
        label: string,
        options: { value: string; name: string }[],
        onPick: (value: string) => void,
    ): HTMLSelectElement {
        const row = document.createElement('div');
        row.className = 'vtt-style-row-wide';

        const select = document.createElement('select');
        select.className = 'vtt-select';
        select.id = 'vtt-style-font-select';
        // A real <label for>, not a bare span, so a screen reader announces
        // "Font family, combo box" rather than just "combo box".
        const labelEl = document.createElement('label');
        labelEl.className = 'vtt-style-label';
        labelEl.htmlFor = select.id;
        labelEl.textContent = label;
        for (const opt of options) {
            const el = document.createElement('option');
            el.value = opt.value;
            el.textContent = opt.name;
            select.appendChild(el);
        }
        select.addEventListener('change', () => onPick(select.value));

        const wrap = document.createElement('div');
        wrap.className = 'vtt-select-wrap';
        wrap.appendChild(select);
        const chevron = document.createElement('span');
        chevron.className = 'vtt-select-chevron';
        chevron.innerHTML = ICONS.chevron;
        wrap.appendChild(chevron);

        row.appendChild(labelEl);
        row.appendChild(wrap);
        parent.appendChild(row);
        return select;
    }

    // A fine-grained size control: a 50-400% range slider (step 5) with a
    // live percent readout. Replaces an earlier 3-way small/medium/large
    // preset, which left the 100-150% range most people land in unreachable.
    // Returns both the input and its readout — markActiveStyleButtons needs
    // to keep the readout's text and the track's fill in sync with state.
    private buildSliderRow(
        parent: HTMLElement,
        id: string,
        label: string,
        onInput: (percent: number) => void,
    ): SliderRowElements {
        const row = document.createElement('div');
        row.className = 'vtt-style-row';

        const labelEl = document.createElement('label');
        labelEl.className = 'vtt-style-label';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        const wrap = document.createElement('div');
        wrap.className = 'vtt-slider-wrap';
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'vtt-slider';
        input.id = id;
        input.min = '50';
        input.max = '400';
        input.step = '5';
        labelEl.htmlFor = input.id;
        const val = document.createElement('span');
        val.className = 'vtt-slider-val';
        input.addEventListener('input', () => onInput(Number(input.value)));
        wrap.appendChild(input);
        wrap.appendChild(val);
        row.appendChild(wrap);
        parent.appendChild(row);

        return { input, val };
    }

    private buildSegRow(
        parent: HTMLElement,
        label: string,
        options: { value: string; html: string; name?: string }[],
        onPick: (value: string) => void,
    ): HTMLButtonElement[] {
        const row = document.createElement('div');
        row.className = 'vtt-style-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'vtt-style-label';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        const seg = document.createElement('div');
        seg.className = 'vtt-seg';
        seg.style.setProperty('--vtt-seg-n', String(options.length));
        const thumb = document.createElement('div');
        thumb.className = 'vtt-seg-thumb';
        seg.appendChild(thumb);

        const buttons: HTMLButtonElement[] = [];
        for (const opt of options) {
            const btn = document.createElement('button');
            btn.className = 'vtt-seg-btn';
            btn.dataset.value = opt.value;
            btn.title = `${label}: ${opt.name ?? opt.value}`;
            btn.innerHTML = opt.html;
            btn.addEventListener('click', () => onPick(opt.value));
            seg.appendChild(btn);
            buttons.push(btn);
        }
        row.appendChild(seg);
        parent.appendChild(row);
        return buttons;
    }

    // The color palette row: round swatches; the selected one gets an accent
    // ring plus a dark check mark (readable even on low-contrast colors). A
    // custom-color well closes the row so any color is reachable, not just
    // the five presets — without it, picking anything outside the palette
    // meant editing storage by hand.
    private buildSwatchRow(
        parent: HTMLElement,
        label: string,
        colors: readonly string[],
        onPick: (value: string) => void,
    ): HTMLButtonElement[] {
        const row = document.createElement('div');
        row.className = 'vtt-style-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'vtt-style-label';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        const group = document.createElement('div');
        group.className = 'vtt-swatches';
        const buttons: HTMLButtonElement[] = [];
        for (const color of colors) {
            const btn = document.createElement('button');
            btn.className = 'vtt-swatch';
            btn.dataset.value = color;
            btn.title = `${label}: ${color}`;
            btn.style.backgroundColor = color;
            btn.innerHTML = ICONS.check;
            btn.addEventListener('click', () => onPick(color));
            group.appendChild(btn);
            buttons.push(btn);
        }

        const wellLabel = msg('ytStyleCustomColor', 'Custom color');
        const well = document.createElement('label');
        well.className = 'vtt-swatch vtt-swatch-custom';
        well.title = wellLabel;
        const input = document.createElement('input');
        input.type = 'color';
        input.setAttribute('aria-label', wellLabel);
        input.addEventListener('input', (e) => onPick((e.target as HTMLInputElement).value));
        well.appendChild(input);
        // insertAdjacentHTML, not += on innerHTML: the latter reparses the
        // whole subtree and would tear down the <input> that was just added.
        well.insertAdjacentHTML('beforeend', ICONS.check);
        group.appendChild(well);

        row.appendChild(group);
        parent.appendChild(row);
        return buttons;
    }

    // Reflects the current overlayStyle in the controls: .active class on the
    // matching button plus the segmented thumb slid under it (for buttons),
    // the input value plus track fill (for sliders), or selectedness (for the
    // font dropdown). Safe to call before the controls exist.
    private markActiveStyleButtons(): void {
        const mark = (btns: HTMLButtonElement[] | undefined, active: string) => {
            if (!btns?.length) return;
            let activeIndex = -1;
            btns.forEach((b, i) => {
                const on = b.dataset.value === active;
                b.classList.toggle('active', on);
                if (on) activeIndex = i;
            });
            // Swatch rows have no thumb; querySelector just returns null there.
            const thumb = btns[0].parentElement?.querySelector('.vtt-seg-thumb') as HTMLElement | null;
            if (thumb && activeIndex >= 0) thumb.style.transform = `translateX(${activeIndex * 100}%)`;
            // A custom color (not one of the presets) still needs the well to
            // show it: swap the "pick anything" gradient for the actual color,
            // and keep the hidden <input type=color> in sync so reopening the
            // native picker starts from where the user left off.
            const custom = btns[0].parentElement?.querySelector('.vtt-swatch-custom') as HTMLElement | null;
            if (custom) {
                const isCustom = activeIndex < 0;
                custom.classList.toggle('active', isCustom);
                // Clearing the inline value falls back to the rainbow conic
                // gradient in .vtt-swatch-custom rather than restating it here,
                // so the gradient has one definition.
                custom.style.background = isCustom ? active : '';
                const input = custom.querySelector('input') as HTMLInputElement | null;
                if (input && isCustom && input.value.toLowerCase() !== active.toLowerCase()) {
                    input.value = active;
                }
            }
        };
        const markSlider = (sl: SliderRowElements | undefined, pct: number) => {
            if (!sl) return;
            if (Number(sl.input.value) !== pct) sl.input.value = String(pct);
            sl.val.textContent = `${pct}%`;
            const fill = ((pct - 50) / (400 - 50)) * 100;
            sl.input.style.setProperty('--vtt-slider-fill', `${fill}%`);
        };
        if (this.elements.styleFontSelect) this.elements.styleFontSelect.value = this.overlayStyle.overlayFontFamily;
        markSlider(this.elements.styleSizeSlider, this.overlayStyle.overlayFontSize);
        markSlider(this.elements.styleSubSizeSlider, this.overlayStyle.overlaySubFontSize);
        mark(this.elements.styleColorBtns, this.overlayStyle.overlayColor);
        mark(this.elements.styleSubColorBtns, this.overlayStyle.overlaySubColor);
        mark(this.elements.styleTextOpacityBtns, String(Math.round(this.overlayStyle.overlayTextOpacity * 100)));
        mark(this.elements.styleBgColorBtns, this.overlayStyle.overlayBgColor);
        mark(this.elements.styleOffsetBtns, this.overlayStyle.overlayBottomOffset);
        mark(this.elements.styleBgBtns, this.overlayStyle.overlayBgOpacity);
        mark(this.elements.styleEdgeBtns, this.overlayStyle.overlayEdgeStyle);
        mark(this.elements.themeBtns, this.theme);
        if (this.elements.themeValueEl) {
            this.elements.themeValueEl.textContent = this.themeName(this.theme);
        }
    }

    /**
     * Dev-only: show which backend this build talks to, and switch it.
     *
     * Lives in the sidebar because that is where you actually look while
     * testing — the toolbar popup is two clicks away and easy to forget.
     * Colour follows the DATA, not the build slot: only real user data earns
     * the alarm colour, so an accidental write to production is hard to make
     * without noticing.
     *
     * Failure is shown, never swallowed: a switch that silently fails to
     * report leaves you believing you are on preprod when you are not.
     */
    private wireEnvSwitch(btn: HTMLButtonElement): void {
        if (__EXT_ENV__ !== 'dev') return;
        type Info = { side: 'home' | 'away'; label: string; canSwitch: boolean; isProd?: boolean };
        let info: Info | null = null;

        const paint = (i: Info) => {
            info = i;
            btn.textContent = i.canSwitch ? `backend: ${i.label}  ⇄` : `backend: ${i.label}`;
            btn.dataset.env = i.isProd ? 'live' : 'safe';
            btn.disabled = !i.canSwitch;
            btn.title = i.canSwitch
                ? `${i.isProd ? 'REAL user data. ' : ''}Click to switch (signs you out).`
                : 'This build was given no second target to switch to.';
        };

        const ask = (msgObj: object) =>
            new Promise<Info>((resolve, reject) => {
                chrome.runtime.sendMessage(msgObj, (res) => {
                    const err = chrome.runtime.lastError;
                    if (err) reject(new Error(err.message));
                    else resolve(res as Info);
                });
            });

        void ask({ action: 'DEV_GET_ENV' })
            .then(paint)
            .catch((err) => {
                console.warn('[Lingogram] dev env probe failed:', err);
                paint({ side: 'home', label: 'env?', canSwitch: false });
            });

        btn.addEventListener('click', () => {
            if (!info?.canSwitch) return;
            const next = info.side === 'away' ? 'home' : 'away';
            btn.disabled = true;
            void ask({ action: 'DEV_SET_ENV', side: next })
                .then(paint)
                .catch((err) => {
                    console.warn('[Lingogram] dev env switch failed:', err);
                    btn.disabled = false;
                });
        });
    }

    // Two independent resets, one per panel group — each is a single storage
    // write (so other tabs converge in one onPrefsChanged tick) that touches
    // only the fields the user was just looking at.
    private resetTextStyle(): void {
        // Reset has to land on the same sizes a fresh install sees on THIS
        // site, or the button would shrink captions on rezka/youtube to a
        // baseline those two never start from.
        const defaults = { ...OVERLAY_TEXT_DEFAULTS, ...(PLATFORM_SIZE_DEFAULTS[this.scope] ?? {}) };
        Object.assign(this.overlayStyle, defaults);
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ ...defaults }, this.scope);
    }

    private resetBoxStyle(): void {
        Object.assign(this.overlayStyle, OVERLAY_BOX_DEFAULTS);
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ ...OVERLAY_BOX_DEFAULTS }, this.scope);
    }

    private setOverlayFontFamily(v: OverlayFontFamily): void {
        this.overlayStyle.overlayFontFamily = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayFontFamily: v }, this.scope);
    }

    private setOverlayFontSize(v: number): void {
        this.overlayStyle.overlayFontSize = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayFontSize: v }, this.scope);
    }

    private setOverlayColor(v: string): void {
        this.overlayStyle.overlayColor = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayColor: v }, this.scope);
    }

    private setOverlaySubFontSize(v: number): void {
        this.overlayStyle.overlaySubFontSize = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlaySubFontSize: v }, this.scope);
    }

    private setOverlaySubColor(v: string): void {
        this.overlayStyle.overlaySubColor = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlaySubColor: v }, this.scope);
    }

    private setOverlayTextOpacity(v: number): void {
        this.overlayStyle.overlayTextOpacity = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayTextOpacity: v }, this.scope);
    }

    private setOverlayBgColor(v: string): void {
        this.overlayStyle.overlayBgColor = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayBgColor: v }, this.scope);
    }

    private setOverlayBottomOffset(v: OverlayLevelToken): void {
        this.overlayStyle.overlayBottomOffset = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayBottomOffset: v }, this.scope);
    }

    private setOverlayBgOpacity(v: OverlayBackdropToken): void {
        this.overlayStyle.overlayBgOpacity = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayBgOpacity: v }, this.scope);
    }

    private setOverlayEdgeStyle(v: OverlayEdgeToken): void {
        this.overlayStyle.overlayEdgeStyle = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayEdgeStyle: v }, this.scope);
    }

    private themeName(t: ThemeToken): string {
        return t === 'auto' ? msg('ytThemeAuto', 'Auto')
            : t === 'light' ? msg('ytThemeLight', 'Light')
            : msg('ytThemeDark', 'Dark');
    }

    // No scope argument: the theme is global (see Prefs.theme). Applied before
    // the write so the panel flips under the click rather than after a storage
    // round-trip.
    private setTheme(v: ThemeToken): void {
        this.theme = v;
        applyTheme(v);
        this.markActiveStyleButtons();
        savePrefs({ theme: v });
    }

    // Loads persisted prefs into AppState + DOM, then subscribes so cross-tab
    // changes (or popup-driven changes later) propagate in. Fire-and-forget —
    // the initial render uses defaults; the prefs swap re-renders if needed.
    private hydrateFromPrefs(): void {
        loadPrefs(this.scope).then((prefs) => {
            this.state.displayMode = prefs.displayMode;
            this.state.overlayEnabled = prefs.overlayEnabled;
            this.adoptOverlayStyle(prefs);
            this.applyCollapsed(prefs.sidebarCollapsed);
            this.refresh();
        }).catch(() => {});

        // The 'auto' OS listener lives at module scope, so it outlives this
        // panel unless destroy() drops it — see stopThemeTracking.
        this.teardown.push(stopThemeTracking);

        this.teardown.push(onPrefsChanged((prefs) => {
            let changed = false;
            if (this.state.displayMode !== prefs.displayMode) {
                this.state.displayMode = prefs.displayMode;
                changed = true;
            }
            if (this.state.overlayEnabled !== prefs.overlayEnabled) {
                this.state.overlayEnabled = prefs.overlayEnabled;
                changed = true;
            }
            this.adoptOverlayStyle(prefs);
            if (this.isCollapsed() !== prefs.sidebarCollapsed) {
                this.applyCollapsed(prefs.sidebarCollapsed);
                if (prefs.sidebarCollapsed) this.closeSettingsPanel();
            }
            if (changed) this.refresh();
        }, this.scope));
    }

    // Copies overlay-style fields from a Prefs snapshot into local state, then
    // restyles the live overlay and re-marks the active preset buttons. Shared
    // by the initial hydrate and cross-tab onPrefsChanged.
    private adoptOverlayStyle(prefs: Prefs): void {
        this.overlayStyle = {
            overlayFontFamily: prefs.overlayFontFamily,
            overlayFontSize: prefs.overlayFontSize,
            overlayColor: prefs.overlayColor,
            overlaySubFontSize: prefs.overlaySubFontSize,
            overlaySubColor: prefs.overlaySubColor,
            overlayTextOpacity: prefs.overlayTextOpacity,
            overlayBgColor: prefs.overlayBgColor,
            overlayBottomOffset: prefs.overlayBottomOffset,
            overlayBottomNudge: prefs.overlayBottomNudge,
            overlayInlineNudge: prefs.overlayInlineNudge,
            overlayBgOpacity: prefs.overlayBgOpacity,
            overlayEdgeStyle: prefs.overlayEdgeStyle,
        };
        // Re-applied here too, so a theme change made in another tab (or from
        // a second panel on the same page) lands without a reload.
        if (this.theme !== prefs.theme) {
            this.theme = prefs.theme;
            applyTheme(prefs.theme);
        }
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
    }

    // Settings is a takeover state: while open, the transcript list is hidden
    // (CSS on .vtt-settings-open). Exits are labeled text, not icon riddles:
    // a "‹ Subtitles" back chip in the header (gear hides, title flips to
    // "Settings") plus a Done button at the panel bottom. Transient state —
    // not persisted.
    toggleSettingsPanel(): void {
        const { settingsPanel, sidebar, titleEl } = this.elements;
        if (!settingsPanel) return;
        // Feedback sits on top of settings, so leaving settings must tear it
        // down first — otherwise its class survives and the next visit to
        // settings opens straight into a stale feedback screen.
        if (sidebar?.classList.contains('vtt-feedback-open')) this.closeFeedbackScreen(false);
        const open = settingsPanel.classList.toggle('open');
        sidebar?.classList.toggle('vtt-settings-open', open);
        this.elements.settingsBtn?.setAttribute('aria-expanded', String(open));
        // Settings is where appearance gets adjusted, so it is also where the
        // captions grow their position arrows. Tying the two together means the
        // reading surface carries no controls the rest of the time, and the
        // arrows never have to be discovered — the user is already in the panel
        // that owns every other caption setting.
        this.setOverlayAdjusting(open);
        // Focus follows the takeover: opening hands the keyboard to the back
        // chip (the panel's exit), closing returns it to the gear that opened
        // it — otherwise the hidden trigger strands focus on a display:none
        // element and the next Tab restarts from the top of the page.
        if (open) {
            this.elements.backBtn?.focus();
        } else if (document.activeElement === this.elements.backBtn) {
            this.elements.settingsBtn?.focus();
        }
        if (titleEl) {
            titleEl.textContent = open
                ? msg('ytSettingsTitle', 'Settings')
                : msg('ytSidebarTitle', 'Subtitles');
        }
        if (!open) {
            // Returning to the transcript: catch up on the scroll position the
            // list couldn't maintain while hidden.
            this.scrollActiveIntoView('instant');
        }
    }

    // Feedback is a takeover layered on top of the settings takeover: the
    // settings panel hides, the feedback panel shows, and the header swaps its
    // back chip for "‹ Settings". The settings panel keeps its .open class
    // throughout, so returning is a pure hide/show — nothing to rebuild, and no
    // way to land back on the transcript by accident.
    openFeedbackScreen(): void {
        const { feedbackPanel, sidebar, titleEl } = this.elements;
        if (!feedbackPanel) return;
        this.buildFeedbackScreen(feedbackPanel);
        sidebar?.classList.add('vtt-feedback-open');
        if (titleEl) titleEl.textContent = msg('ytFeedbackTitle', 'Send feedback');
        // Focus the message box, and only after the class above makes the
        // screen visible — focusing a hidden element silently leaves focus on
        // the body. Someone who opened "Report a problem" came here to type;
        // focusing the back chip here (as this used to) meant the first
        // keystroke went nowhere and Enter or Space walked straight back out.
        this.elements.feedbackTextarea?.focus();
    }

    // `restoreFocus` is false when the caller is itself navigating away (the
    // settings toggle): moving focus onto a link that is about to be hidden
    // would strand it on a display:none element and restart the next Tab from
    // the top of the page.
    closeFeedbackScreen(restoreFocus = true): void {
        const { feedbackPanel, sidebar, titleEl } = this.elements;
        if (!feedbackPanel) return;
        sidebar?.classList.remove('vtt-feedback-open');
        // Drop the form so a half-typed message never resurfaces on the next
        // open — and so the auth state is re-read rather than remembered.
        feedbackPanel.replaceChildren();
        this.elements = { ...this.elements, feedbackTextarea: undefined };
        if (titleEl) titleEl.textContent = msg('ytSettingsTitle', 'Settings');
        if (restoreFocus) this.elements.feedbackLink?.focus();
    }

    // Populated per-open. Signed-in users are identified by the uid the
    // background stamps from their own token, so the form only asks for an
    // email when there is no account to tie the message back to.
    private buildFeedbackScreen(panel: HTMLDivElement): void {
        const intro = document.createElement('p');
        intro.className = 'vtt-feedback-intro';
        intro.textContent = msg(
            'ytFeedbackIntro',
            'Tell us what broke or what you would change. We read every message.',
        );

        const textarea = document.createElement('textarea');
        textarea.id = 'vtt-feedback-text';
        textarea.className = 'vtt-feedback-text';
        textarea.rows = 6;
        textarea.placeholder = feedbackCopy.hint();
        textarea.setAttribute('aria-label', feedbackCopy.hint());

        // Only appears near the byte ceiling — an always-on counter reads as a
        // limit to hit rather than one to ignore.
        const counter = document.createElement('div');
        counter.className = 'vtt-feedback-counter';
        counter.hidden = true;
        counter.setAttribute('aria-live', 'polite');

        const status = document.createElement('div');
        status.className = 'vtt-feedback-status';
        status.hidden = true;

        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'vtt-feedback-send';
        send.textContent = feedbackCopy.send();
        send.disabled = true;

        // Optional reply address, signed-out users only. Rendered async because
        // the auth check is a round trip to the background; the textarea is
        // usable the whole time, so nothing blocks on it.
        const emailRow = document.createElement('div');
        emailRow.className = 'vtt-feedback-email-row';
        emailRow.hidden = true;
        const emailInput = document.createElement('input');
        emailInput.type = 'email';
        emailInput.id = 'vtt-feedback-email';
        emailInput.className = 'vtt-feedback-email';
        emailInput.placeholder = msg('ytFeedbackEmailHint', 'Email (optional, if you want a reply)');
        emailInput.setAttribute('aria-label', msg('ytFeedbackEmailHint', 'Email (optional, if you want a reply)'));
        const emailLabel = document.createElement('label');
        emailLabel.className = 'vtt-feedback-email-label';
        emailLabel.htmlFor = emailInput.id;
        emailLabel.textContent = msg('ytFeedbackEmailLabel', 'Reply address');
        emailRow.append(emailLabel, emailInput);

        void this.isSignedIn().then((signedIn) => {
            // Guard against a close-then-reopen racing this resolve: only touch
            // the row if it is still the one in the live panel.
            if (!signedIn && emailRow.isConnected) emailRow.hidden = false;
        });

        const budget = () => MAX_FEEDBACK_BYTES - utf8Len(composeFeedbackText(textarea.value, emailInput.value));

        // Clamp the field being typed in, never the other one. The email rides
        // inside the same byte budget, so typing an address can push the total
        // over — but taking the overflow out of the MESSAGE would delete text
        // the user wrote earlier, from a field they aren't even looking at.
        // Whoever is typing is the one who gets stopped.
        const clampField = (field: HTMLTextAreaElement | HTMLInputElement) => {
            const over = -budget();
            if (over <= 0) return;
            // selectionStart/setSelectionRange throw on input[type=email] —
            // the selection API is only defined for text-like inputs — so the
            // caret is restored on a best-effort basis.
            let caret: number | null = null;
            try {
                caret = field.selectionStart;
            } catch {
                caret = null;
            }
            const clamped = clampToBytes(field.value, Math.max(0, utf8Len(field.value) - over));
            const dropped = field.value.length - clamped.length;
            if (!dropped) return;
            field.value = clamped;
            if (caret === null) return;
            const next = Math.max(0, caret - dropped);
            try {
                field.setSelectionRange(next, next);
            } catch {
                // Field doesn't support a caret; the clamp still applied.
            }
        };

        const syncLimits = (typed?: HTMLTextAreaElement | HTMLInputElement) => {
            // Hard-clamp on the real budget: typing past the cap stops adding
            // characters instead of letting the send path silently truncate.
            if (typed) clampField(typed);
            const left = budget();
            counter.hidden = left > 200;
            // A bare number announces as "0" and says nothing about what ran
            // out; the visible text carries its unit, and the label spells it
            // out for a screen reader.
            counter.textContent = feedbackCopy.charsLeft(left);
            counter.setAttribute('aria-label', feedbackCopy.charsLeft(left));
            send.disabled = textarea.value.trim().length === 0;
        };
        textarea.addEventListener('input', () => syncLimits(textarea));
        emailInput.addEventListener('input', () => syncLimits(emailInput));

        send.addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (!text) return;
            send.disabled = true;
            send.textContent = feedbackCopy.sending();
            status.hidden = true;
            const ok = await sendFeedback(text, emailRow.hidden ? '' : emailInput.value);
            if (ok) {
                // The panel stays open (unlike the rating card, which removes
                // itself), so the success state has to be a real screen: the
                // form is replaced by a thank-you and the only move is back.
                const done = document.createElement('div');
                done.className = 'vtt-feedback-done';
                done.setAttribute('role', 'status');
                done.textContent = feedbackCopy.sent();
                const back = document.createElement('button');
                back.type = 'button';
                back.className = 'vtt-feedback-send';
                back.textContent = msg('ytFeedbackBackToSettings', 'Back to settings');
                back.addEventListener('click', () => this.closeFeedbackScreen());
                panel.replaceChildren(done, back);
                back.focus();
                return;
            }
            // Don't make the user retype: keep the text, let them try again.
            send.disabled = false;
            send.textContent = feedbackCopy.send();
            status.hidden = false;
            status.textContent = feedbackCopy.failed();
            status.setAttribute('role', 'alert');
        });

        const actions = document.createElement('div');
        actions.className = 'vtt-feedback-actions';
        actions.append(counter, send);

        panel.replaceChildren(intro, textarea, emailRow, status, actions);
        this.elements = { ...this.elements, feedbackTextarea: textarea };
        // NOT focused here: the panel is still hidden at this point, and
        // focusing a display:none element is a no-op that leaves focus on the
        // body. openFeedbackScreen focuses it once the screen is shown.
    }

    private async isSignedIn(): Promise<boolean> {
        try {
            const res = await new Promise<{ signedIn?: boolean }>((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'AUTH_STATUS' }, (r) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(r ?? {});
                });
            });
            return res.signedIn === true;
        } catch {
            // Unknown auth state — offer the email field. Asking a signed-in
            // user for an address is a small redundancy; hiding it from a
            // signed-out one loses the reply path entirely.
            return false;
        }
    }

    // Collapsing the sidebar always exits settings: settings is transient
    // tweak-mode, and the sidebar must re-expand into the transcript — its
    // primary state — no matter how long ago it was collapsed.
    private closeSettingsPanel(): void {
        if (this.elements.settingsPanel?.classList.contains('open')) {
            this.toggleSettingsPanel();
        }
    }

    toggleCollapsed(): void {
        this.setCollapsed(!this.isCollapsed());
    }

    /** Whether the sidebar is currently slid off-screen. */
    isCollapsed(): boolean {
        return this.elements.sidebar?.classList.contains('collapsed') ?? false;
    }

    // Expand the sidebar, whatever state it's in. toggleCollapsed() means
    // "flip", so a caller that means "open" (the player menu) can't use it
    // blind — on an already-open sidebar it would collapse it.
    openPanel(): void {
        this.setCollapsed(false);
    }

    // Paint the collapsed state onto the DOM. Split from setCollapsed() so the
    // prefs-hydration paths can reuse it without writing straight back the
    // value they just read.
    private applyCollapsed(collapsed: boolean): void {
        const sidebar = this.elements.sidebar;
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed', collapsed);
        this.elements.toggleBtn?.setAttribute('aria-expanded', String(!collapsed));
    }

    private setCollapsed(collapsed: boolean): void {
        if (!this.elements.sidebar) return;
        this.applyCollapsed(collapsed);
        if (collapsed) this.closeSettingsPanel();
        savePrefs({ sidebarCollapsed: collapsed });
    }

    // Expand straight into settings. Same reasoning as openPanel(), squared:
    // toggleSettingsPanel() is also a toggle, so it needs the same guard.
    openSettings(): void {
        this.openPanel();
        if (!this.elements.settingsPanel?.classList.contains('open')) this.toggleSettingsPanel();
    }

    /** Direct mode pick — what every mode control calls. */
    setMode(mode: 'single' | 'dual' | 'guess'): void {
        if (!this.state.setDisplayMode(mode)) return;
        this.refresh();
        savePrefs({ displayMode: this.state.displayMode });
    }

    toggleDualMode(): void {
        if (!this.state.toggleDualMode()) return;
        this.refresh();
        savePrefs({ displayMode: this.state.displayMode });
    }

    toggleGuessMode(): void {
        if (!this.state.toggleGuessMode()) return;
        this.refresh();
        savePrefs({ displayMode: this.state.displayMode });
    }

    toggleOverlay(): void {
        this.state.overlayEnabled = !this.state.overlayEnabled;
        this.refresh();
        savePrefs({ overlayEnabled: this.state.overlayEnabled }, this.scope);
    }

    // Lets site-specific code (e.g. YouTube's native-control-bar button, which
    // lives outside the sidebar DOM this class builds) register an element so
    // updateControls() keeps it in sync alongside every other overlay chip —
    // one source of truth instead of a second listener that can drift.
    registerExternalElement<K extends keyof SidebarElements>(key: K, el: SidebarElements[K]): void {
        this.elements = { ...this.elements, [key]: el };
        this.updateControls();
    }

    /**
     * Unbind everything outside the sidebar's own DOM and drop the elements it
     * owns. Safe to call more than once.
     */
    destroy(): void {
        for (const off of this.teardown.splice(0)) off();
        this.elements.sidebar?.remove();
        // The toggle tab is BORN inside the sidebar but a host may re-parent it
        // (packages/embed moves it onto its own tab slot, and fullscreen moves
        // it again), so removing the sidebar no longer takes it along. It is not
        // kept in `elements`, so go by id — otherwise a remount leaves a dead
        // tab behind.
        document.getElementById('vtt-toggle-btn')?.remove();
        document.getElementById('vtt-video-overlay')?.remove();
        // Nothing may outlive this instance holding a detached node.
        this.homeParent = null;
        this.elements = {};
    }

    setupFullscreenHandling(): void {
        const onFullscreenChange = (): void => {
            const sidebar = this.elements.sidebar;
            if (!sidebar) return;

            if (document.fullscreenElement) {
                // Remember where it came from: in the extensions that's <body>,
                // but embedded in a page (packages/embed) it's the layout column
                // it belongs to. Returning it to <body> there would leave it
                // fixed against the whole document instead of the demo block.
                this.homeParent = sidebar.parentElement;
                sidebar.style.display = 'flex';
                sidebar.classList.add('fullscreen');
                this.applyCollapsed(true); // transient — deliberately not persisted
                this.closeSettingsPanel();
                document.fullscreenElement.appendChild(sidebar);
            } else {
                (this.homeParent ?? document.body).appendChild(sidebar);
                sidebar.classList.remove('fullscreen');
                const isTopWindow = window === window.top;
                if (!isTopWindow) {
                    sidebar.style.display = 'none';
                } else {
                    // Entering fullscreen collapses the sidebar transiently (not
                    // persisted), so the stored pref still reflects the user's
                    // last manual toggle. Restore it instead of force-opening —
                    // otherwise leaving fullscreen always re-expands a sidebar
                    // the user had deliberately collapsed.
                    loadPrefs(this.scope).then((prefs) => {
                        this.applyCollapsed(prefs.sidebarCollapsed);
                    }).catch(() => {});
                }
            }

            // Re-parenting resets list scroll to 0. state.currentIndex is unchanged,
            // so highlightSubtitle wouldn't re-scroll on its own — do it explicitly.
            this.scrollActiveIntoView('instant');
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);
        this.teardown.push(() =>
            document.removeEventListener('fullscreenchange', onFullscreenChange),
        );
    }

    private pickScrollMode(targetIndex: number, fromIndex: number): ScrollMode {
        if (fromIndex === -1) return 'instant';
        return Math.abs(targetIndex - fromIndex) <= NEARBY_SUBTITLE_THRESHOLD ? 'smooth' : 'instant';
    }

    // Scroll the list itself rather than calling scrollIntoView on the item:
    // scrollIntoView walks up and scrolls EVERY scrollable ancestor, including
    // the page. The sidebar is fixed in the extensions so nothing above it can
    // scroll, but embedded in a page (packages/embed) that would yank the
    // document back to the player on every new line, fighting the reader.
    private scrollActiveIntoView(mode: ScrollMode): void {
        const list = this.elements.list;
        const active = list?.querySelector<HTMLElement>('.vtt-item.active-sub');
        if (!list || !active) return;
        // Measured, not offsetTop: #vtt-list is not a positioned ancestor, so
        // offsetTop would be relative to something further up the tree.
        const listBox = list.getBoundingClientRect();
        const itemBox = active.getBoundingClientRect();
        const delta = itemBox.top - listBox.top - (listBox.height - itemBox.height) / 2;
        list.scrollTo({ top: list.scrollTop + delta, behavior: mode as ScrollBehavior });
    }

    private buildSecondaryTextElement(overlap: { text: string }[], className = 'vtt-sub-text'): HTMLDivElement | null {
        if (overlap.length === 0) return null;
        const div = document.createElement('div');
        div.className = className;
        div.textContent = overlap.map(s => s.text).join(' | ');
        return div;
    }

    // Satellite UIs that live outside the sidebar DOM (the YouTube player menu)
    // and are too transient to register elements with updateControls(). They
    // repaint themselves from state whenever anything changes it — a hotkey
    // pressed while the menu is open, say.
    private refreshHooks: Array<() => void> = [];

    /** Subscribe to state changes; returns an unsubscribe function. */
    onRefresh(fn: () => void): () => void {
        this.refreshHooks.push(fn);
        return () => {
            this.refreshHooks = this.refreshHooks.filter(f => f !== fn);
        };
    }

    refresh(): void {
        this.updateControls();
        this.renderSubtitles();
        this.syncNativeSubtitles();
        this.app.updateHighlight();
        // A throwing subscriber must not take the sidebar's own refresh down.
        this.refreshHooks.forEach(fn => {
            try { fn(); } catch (e) { console.warn('[Lingogram] refresh hook failed', e); }
        });
    }

    // Whether we've already turned the site's native captions off for the
    // current video while the overlay is on. This makes the suppression a
    // ONE-SHOT per video: we disable native captions once (so they don't stack
    // behind our overlay on open), but if the user re-enables them from the
    // site's own menu afterwards, we leave them alone until the next video.
    private nativeSubsDisabledForVideo = false;

    // Call on a genuine video change so native-caption suppression re-arms for
    // the next video (the user's per-video choice doesn't carry over).
    resetNativeSubsGuard(): void {
        this.nativeSubsDisabledForVideo = false;
    }

    // Called on every refresh(). While the overlay is enabled, turn the site's
    // own captions off ONCE per video so the two subtitle layers don't overlap.
    // Deliberately NOT a persistent hide: after the one-shot, the user is free
    // to switch native captions back on and they stay on for this video. When
    // the overlay is off, we never touch native captions.
    private syncNativeSubtitles(): void {
        if (!this.state.overlayEnabled) {
            this.nativeSubsDisabledForVideo = false; // re-arm for when it's turned back on
            return;
        }
        if (this.nativeSubsDisabledForVideo) return;
        this.nativeSubsDisabledForVideo = true;
        this.app.setNativeSubtitlesEnabled?.(false);
    }

    // Whether the dropdowns act as language pickers (Netflix: pick any language
    // the title offers and it's fetched on demand) rather than track pickers
    // (YouTube/Rezka: switch between already-loaded tracks). Both requirements
    // must hold — a catalog to list and a site handler to fetch the pick.
    private isLanguagePickerMode(): boolean {
        return !!this.state.languageCatalog && !!this.app.requestLanguageTrack;
    }

    // A dropdown changed. In track-picker mode the value is a track index; in
    // language-picker mode it's a language code the site loads on demand.
    private onTrackSelectChange(role: TrackRole, value: string): void {
        if (this.isLanguagePickerMode()) {
            if (role === 'learning') this.state.selectedLearningCode = value;
            else this.state.selectedNativeCode = value;
            this.app.requestLanguageTrack?.(role, value);
            // The track arrives asynchronously; reflect the new selection now so
            // the dropdown doesn't snap back to the old value before it loads.
            this.updateControls();
            return;
        }
        if (role === 'learning') this.state.activeTrackIndex = parseInt(value);
        else this.state.secondaryTrackIndex = parseInt(value);
        this.refresh();
    }

    updateControls(): void {
        if (!this.elements.settingsBtn || !this.elements.mainSelect || !this.elements.subSelect) return;

        this.elements.settingsBtn.style.display = 'flex';

        const hasMultiple = this.state.hasMultipleTracks();
        const mode = this.state.displayMode;

        // Quick bar mirrors the settings chips: same .active semantics, same
        // single-track disables; hidden entirely until subtitles are loaded.
        const { quickModesBar, qmSingleBtn, qmDualBtn, qmGuessBtn, qmOverlayBtn } = this.elements;
        if (quickModesBar) quickModesBar.style.display = this.state.tracks.length ? '' : 'none';
        // The three modes are radio segments (aria-checked); .active carries
        // the pill fill and expands the segment's label. Exactly one is always
        // checked — single is a mode of its own, not "both toggles off".
        const syncRadio = (btn: HTMLButtonElement | undefined, on: boolean): void => {
            if (!btn) return;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-checked', String(on));
        };
        syncRadio(qmSingleBtn, mode === 'single');
        syncRadio(qmDualBtn, mode === 'dual');
        syncRadio(qmGuessBtn, mode === 'guess');
        // On-screen is an independent switch (aria-checked); .active slides
        // the knob and lights the track.
        if (qmOverlayBtn) {
            qmOverlayBtn.classList.toggle('active', this.state.overlayEnabled);
            qmOverlayBtn.setAttribute('aria-checked', String(this.state.overlayEnabled));
        }
        // The YouTube control-bar button (if installed) needs nothing here: it
        // opens the menu, which is always available, so it has no on/off to
        // mirror. The overlay's state shows on the CC button beside it, which
        // player-menu.ts paints from this same state on open and on refresh.
        // The Dual chip is the control the user actually reaches for when the
        // translation is missing, so it has to say WHY it's off. aria-disabled
        // rather than `disabled`: a disabled button fires no pointer events, so
        // its tooltip could never appear. The click handler enforces off.
        if (qmDualBtn) {
            const hint = (!hasMultiple && this.app.missingTrackHint?.()) || '';
            qmDualBtn.disabled = !hasMultiple && !hint;
            qmDualBtn.setAttribute?.('aria-disabled', String(!hasMultiple));
            qmDualBtn.classList?.toggle('vtt-qm-blocked', !hasMultiple && !!hint);
            if (qmDualBtn.dataset) {
                // Keep the mode's own name at the top even when explaining why
                // it's off — the tooltip still has to answer "what is this
                // button?", not only "why can't I press it". CSS renders the
                // first line as a heading. Restores to the plain label once the
                // reason no longer applies.
                const base = qmDualBtn.dataset.baseTip || '';
                qmDualBtn.dataset.tip = hint ? `${base}\n${hint}` : base;
            }
        }

        // The language chip doubles as the swap control: its visual order
        // follows the actual display order (CSS flips it via .vtt-swapped).
        this.elements.sidebar?.classList.toggle('vtt-swapped', this.state.swapped);

        const activeId = document.activeElement?.id;
        this.elements.mainSelect.innerHTML = '';
        this.elements.subSelect.innerHTML = '';

        if (this.isLanguagePickerMode()) {
            // Language-picker mode (Netflix): full catalog split into "this
            // title offers" (selectable) and the rest of the supported catalog
            // (disabled), so the dropdown mirrors the site's own subtitle menu.
            this.populateLanguagePicker(this.elements.mainSelect, this.state.selectedLearningCode);
            this.populateLanguagePicker(this.elements.subSelect, this.state.selectedNativeCode);
        } else {
            // Track-picker mode (YouTube/Rezka): list the already-loaded tracks.
            // Labeled field rows (Learning/Native) make the old 'Main:'/'Sub:'
            // option prefixes redundant noise.
            this.state.tracks.forEach((track, i) => {
                this.elements.mainSelect?.appendChild(new Option(track.name, i.toString(), false, i === this.state.activeTrackIndex));
                this.elements.subSelect?.appendChild(new Option(track.name, i.toString(), false, i === this.state.secondaryTrackIndex));
            });
        }

        if (activeId) {
            const activeEl = document.getElementById(activeId);
            if (activeEl) activeEl.focus();
        }

        // After the dropdowns: the button's tooltip names the track the
        // indexes above were just re-read for.
        this.updateDownloadButton();
    }

    // Fill one dropdown from AppState.languageCatalog: an "available in this
    // title" optgroup (selectable) followed by an "other languages" optgroup
    // (disabled). `selectedCode` is the language currently chosen for this slot.
    private populateLanguagePicker(select: HTMLSelectElement, selectedCode?: string): void {
        const catalog = this.state.languageCatalog ?? [];
        const available = catalog.filter((l) => l.available);
        const others = catalog.filter((l) => !l.available);

        const addGroup = (labelText: string, items: typeof catalog, disabled: boolean): void => {
            if (items.length === 0) return;
            const group = document.createElement('optgroup');
            group.label = labelText;
            for (const lang of items) {
                const opt = new Option(lang.label, lang.code, false, lang.code === selectedCode);
                opt.disabled = disabled;
                group.appendChild(opt);
            }
            select.appendChild(group);
        };

        addGroup(msg('ytLangGroupAvailable', 'Available in this video'), available, false);
        addGroup(msg('ytLangGroupOther', 'Other languages'), others, true);
    }

    buildMaskedContent(text: string, revealedCount: number): HTMLElement {
        const container = document.createElement('div');
        container.className = 'vtt-main-text';
        this.fillMaskedWordsInto(container, text, revealedCount);
        return container;
    }

    // What sits under the frosted pane: the word itself, painted transparent.
    // Its only job is to give the pane a width, and the word is the one string
    // guaranteed to give it the RIGHT width — the pane and the peeked word are
    // the same box, so opening one no longer moves the line around it.
    //
    // This replaced a run of repeated 'n' glyphs, half the word's length. That
    // filler was always a guess at the word's width and always wrong: peek had
    // to animate the capsule from filler width to word width, and the line
    // visibly re-flowed every time the cursor crossed a word. Halving was
    // itself a patch — one 'n' per letter ran WIDER than real text, which broke
    // lines onto two rows — so the width was wrong in both directions and only
    // roughly wrong in between.
    //
    // The word being really in the node means it can be selected or copied out.
    // That is deliberate: guess mode is a puzzle the user sets for themselves,
    // and someone who reaches for the clipboard to beat it has simply chosen to
    // look. The blur is the puzzle, not a lock. translate="no" on the capsule
    // stops the one reader that would expose it WITHOUT being asked — a page
    // translator rewriting the node in place.
    private maskGlyphs(token: string, _spaced: boolean): string {
        return token;
    }

    // Both sidebar and on-screen overlay share this layout so the quick-add
    // selection extractor can recover the real word from data-word — even when
    // the visible glyphs are masked.
    private fillMaskedWordsInto(container: HTMLElement, text: string, revealedCount: number): void {
        const { tokens, sep } = tokenizeForGuess(text);
        const spaced = sep === ' ';
        // The reveal index walks maskable tokens only. Punctuation and sound
        // cues ("-", "♪", a stray bracket) render as plain text: a capsule over
        // them is nothing anyone can guess, and counting them let the "free"
        // first word come up as a lone symbol.
        let m = 0;
        tokens.forEach((word, i) => {
            if (i > 0 && sep) container.appendChild(document.createTextNode(sep));
            if (!isMaskableToken(word)) {
                const plain = document.createElement('span');
                plain.className = 'vtt-guess-filler';
                plain.textContent = word;
                container.appendChild(plain);
                return;
            }
            const span = this.makeMaskedSpan(word, m < revealedCount, this.maskGlyphs(word, spaced));
            // Only the word that opens next is lit. Dressing every hidden word
            // as a target implied you could pick one, but reveal always runs in
            // order — the lit word is the honest version of that.
            if (m === revealedCount) span.classList.add('vtt-next-word');
            container.appendChild(span);
            m++;
        });
    }

    // data-word is what the quick-add selection reads, so it carries the real
    // word only while that word is on screen. A word still masked is parked in
    // data-hidden instead: offering to save a word the user has not been shown
    // is the confusing half of the reveal/quick-add collision, and dropping the
    // attribute is also what makes quick-add's `span[data-word]` queries skip
    // masked words without any change on their side.
    private makeMaskedSpan(word: string, revealed: boolean, maskText: string): HTMLSpanElement {
        const span = document.createElement('span');
        span.dataset.mask = maskText;
        if (revealed) {
            span.dataset.word = word;
            span.className = 'vtt-revealed-word';
            span.textContent = word;
        } else {
            span.dataset.hidden = word;
            span.className = 'vtt-masked-word';
            // The masked node holds the real word (see maskGlyphs), so this is
            // what keeps a page translator from rewriting it into a legible
            // one: a user reaching for the clipboard chose to look, a browser
            // translating the page did not ask.
            span.translate = false;
            span.textContent = maskText;
        }
        return span;
    }

    // Non-guess subtitles still wrap each word in a span carrying data-word
    // so the quick-add selection can snap to whole-word boundaries. Inline
    // spans without a class read identically to the previous text node.
    private fillPlainWordsInto(container: HTMLElement, text: string): void {
        const { tokens, sep } = tokenizeForGuess(text);
        tokens.forEach((word, i) => {
            if (i > 0 && sep) container.appendChild(document.createTextNode(sep));
            const span = document.createElement('span');
            span.dataset.word = word;
            span.textContent = word;
            container.appendChild(span);
        });
    }

    updateGuessItem(index: number): void {
        if (!this.elements.list) return;
        const item = this.elements.list.querySelector(`.vtt-item[data-index="${index}"]`) as HTMLDivElement | null;
        if (!item) return;

        const mainTrack = this.state.getMainTrack();
        if (!mainTrack || !mainTrack[index]) return;

        const main = item.querySelector('.vtt-main-text');
        if (!main) return;

        // Patch spans in place so an active selection inside the item survives
        // the reveal — replacing the parent would orphan the user's Range.
        // Query by class, not [data-word]: masked spans deliberately lack that
        // attribute (see makeMaskedSpan), and missing them here would shift
        // every index and mask the wrong words.
        const revealedCount = this.state.getRevealedCount(index);
        const spans = main.querySelectorAll<HTMLSpanElement>('.vtt-masked-word, .vtt-revealed-word');
        spans.forEach((span, i) => {
            const shouldReveal = i < revealedCount;
            if (shouldReveal && !span.classList.contains('vtt-revealed-word')) {
                const word = span.dataset.word ?? span.dataset.hidden ?? '';
                span.dataset.word = word;
                delete span.dataset.hidden;
                // Only this transition animates: the pane clearing is the
                // reveal. Words already out must not re-focus on every repaint.
                span.className = 'vtt-revealed-word vtt-just-revealed';
                // A word that is out is ordinary text again, so it drops the
                // no-translate guard the mask put on it.
                span.translate = true;
                span.textContent = word;
            } else if (!shouldReveal && !span.classList.contains('vtt-masked-word')) {
                span.dataset.hidden = span.dataset.hidden ?? span.dataset.word ?? '';
                delete span.dataset.word;
                span.className = 'vtt-masked-word';
                // Re-masking puts the real word back in the node, so it must
                // also put back the guard that makeMaskedSpan sets.
                span.translate = false;
                span.textContent = span.dataset.mask ?? '***';
            }
        });

        // Mark the next word up, so exactly one target is lit at a time.
        spans.forEach((span, i) => span.classList.toggle('vtt-next-word', i === revealedCount));

        if (this.state.isFullyRevealed(index)) {
            item.classList.add('fully-revealed');
            if (!item.querySelector('.vtt-sub-text')) {
                const subText = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(mainTrack[index]));
                if (subText) item.appendChild(subText);
            }
        }
    }

    renderSubtitles(): void {
        if (!this.elements.list) return;
        this.elements.list.innerHTML = '';
        this.state.currentIndex = -1;

        const mainTrack = this.state.getMainTrack();
        if (!mainTrack) return;

        const isGuessMode = this.state.displayMode === 'guess';
        const df = document.createDocumentFragment();

        mainTrack.forEach((sub, index) => {
            df.appendChild(isGuessMode ? this.buildGuessItem(sub, index) : this.buildPlainItem(sub, index));
        });

        this.elements.list.appendChild(df);
    }

    private createSubtitleItem(index: number): HTMLDivElement {
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = index.toString();
        // Rapid replay-clicks would otherwise hit the browser's
        // double-click-selects-word / triple-click-selects-line behavior,
        // and the resulting selection then blocks our click→seek handler.
        // Drag-select still fires with detail === 1, so this only kills the
        // multi-click auto-selection.
        item.addEventListener('mousedown', (e) => {
            if (e.detail > 1) e.preventDefault();
        });
        return item;
    }

    private buildGuessItem(sub: Subtitle, index: number): HTMLDivElement {
        const item = this.createSubtitleItem(index);
        item.appendChild(this.buildMaskedContent(sub.text, this.state.getRevealedCount(index)));
        // The whole line is the reveal target, so say so to assistive tech —
        // the words themselves are not individually actionable. role="button"
        // obliges the rest: a div is not focusable and answers no key on its
        // own, so announcing it as operable without these would promise a
        // control keyboard users cannot reach. Same pattern as #vtt-toggle-btn.
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', msg('ytGuessRevealAria', 'Reveal the next word of this subtitle'));
        item.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault(); // Space would scroll the transcript
            this.revealOrSeek(index, sub);
        });

        if (this.state.isFullyRevealed(index)) {
            item.classList.add('fully-revealed');
            const subText = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(sub));
            if (subText) item.appendChild(subText);
        }

        // Masked words reveal on pointerdown, not click — see the overlay
        // handler for why (a mid-click DOM rebuild makes Chrome drop the click
        // entirely). The sidebar patches its spans in place so it is not bitten
        // the same way, but the two surfaces must feel identical.
        item.addEventListener('pointerdown', (e) => {
            this.pointerRevealed = false;
            if (e.button !== 0) return;
            if (!(e.target as Element | null)?.closest?.('.vtt-masked-word')) return;
            this.pointerRevealed = true;
            this.revealOrSeek(index, sub);
        });
        item.addEventListener('click', (e) => {
            // The pointerdown above already revealed for this press.
            if (this.pointerRevealed) { this.pointerRevealed = false; return; }
            // Drag-selecting inside the item fires this click too; stand down
            // for a live selection and keep the quick-add pill usable.
            if (!shouldReveal(e, item)) return;
            this.revealOrSeek(index, sub);
        });
        return item;
    }

    // True between a pointerdown that revealed a word and the click the same
    // press delivers afterwards; that click must not reveal a second one.
    private pointerRevealed = false;

    // The masked word the cursor is currently holding open. Guess mode trades
    // on the tension of not knowing, but a hidden word you cannot glance at is
    // a wall rather than a puzzle: hovering lifts the pane for exactly as long
    // as the cursor stays on it, then drops it back. Nothing about the reveal
    // state changes — a peek is looking, not answering, so the word is masked
    // again the moment the cursor leaves and the line is still unsolved.
    private peekedSpan: HTMLSpanElement | null = null;

    // The peek turns the capsule over on its horizontal axis: frosted pane on
    // the front, the word on the back. Done as ONE face rotating rather than
    // two stacked ones: the text is swapped at the halfway point, where the
    // face is edge on to the viewer and a hundred percent invisible, so the
    // swap lands in the one frame nobody can see. That is what the timer below
    // is for, and why it must stay in step with the CSS duration.
    //
    // Both sides now measure the same — the mask holds the real word (see
    // maskGlyphs) — so the swap is a repaint of identical geometry. It was not
    // always so: the filler used to be half the word's length, and hiding that
    // width change is the reason the halfway swap exists at all.
    //
    // What rotates is an INNER layer, never the span itself. Rotating the span
    // turned it into an endless flip loop: at 90deg the box leaves the cursor's
    // hit area, Chrome fires mouseout, the capsule flops back under the cursor,
    // mouseover fires again — measured with a dead-still mouse, OVER/OUT
    // repeating forever and the word never once showing. The span stays flat
    // and keeps the hit area; only its contents turn.
    // Two halves of 180ms. The stylesheet's `transition: width 0.36s` on
    // .vtt-masked-word is this doubled — the pane eases across the whole turn
    // while the face rotates in halves — so the two must move together.
    private static readonly PEEK_FLIP_MS = 180;
    // Keyed by span, NOT one shared timer: sliding the cursor from one capsule
    // to the next closes the first and opens the second in the same breath, and
    // a single timer meant the opening cancelled the closing — the word left
    // behind stayed face-up and mid-flip forever.
    private peekFlips = new Map<HTMLSpanElement, ReturnType<typeof setTimeout>>();

    // The rotating layer, added for the length of a peek and unwrapped once the
    // capsule is frosted and flat again. Absent at rest so a masked span in its
    // resting state is exactly the markup everything else expects — and
    // span.textContent still reads through it either way.
    private faceOf(span: HTMLSpanElement): HTMLElement {
        const existing = span.firstElementChild as HTMLElement | null;
        if (existing?.classList.contains('vtt-peek-face')) return existing;
        const face = document.createElement('span');
        face.className = 'vtt-peek-face';
        face.textContent = span.textContent ?? '';
        span.textContent = '';
        span.appendChild(face);
        return face;
    }

    // Drop the layer, folding its text back into the span. Called where the
    // span's plain form matters — a reveal is about to rewrite it — rather than
    // on a timer chasing the end of the closing turn.
    private unwrapFace(span: HTMLSpanElement): void {
        const face = span.firstElementChild as HTMLElement | null;
        if (face?.classList.contains('vtt-peek-face')) span.textContent = face.textContent;
    }

    // Turn a capsule over. `word` is the text the far side carries: the real
    // word when opening, the filler when closing.
    private flipSpan(span: HTMLSpanElement, word: string, peeked: boolean): void {
        this.cancelFlip(span);

        // Asked for less motion: swap now, no turn, no wait. The stylesheet
        // already drops the rotation, but the 180ms timer is JS — left in, it
        // gave reduced-motion users a dead zone with no feedback at all, which
        // is worse than the animation they turned off.
        if (SidebarUI.prefersReducedMotion()) {
            span.classList.remove('vtt-flipping');
            if (!span.isConnected || !span.classList.contains('vtt-masked-word')) return;
            this.faceOf(span).textContent = word;
            span.classList.toggle('vtt-peeked-word', peeked);
            span.style.removeProperty('width');
            if (!peeked) this.unwrapFace(span);
            return;
        }

        // Carry the pane's width across the turn. With the mask holding the
        // real word this measures from and to the same number and animates
        // nothing — kept as the safety net for any font where the transparent
        // and painted states do not measure alike, so such a gap eases across
        // the full 2×PEEK_FLIP_MS instead of jumping in the frame of the swap.
        // That jump is what this was written for, back when the filler was half
        // the word's length.
        this.setFlipWidth(span, word);

        // First half: rotate the face we are leaving out of sight.
        // The face may have just been created, in which case flat is its very
        // first computed style and the browser has nothing to transition FROM —
        // it snapped straight to 90deg and sat there for the whole first half,
        // so the turn had no opening move at all, just a pause and a return.
        // Flushing layout commits the flat pose as the start state.
        const face = this.faceOf(span);
        void face.offsetWidth;
        span.classList.add('vtt-flipping');
        const timer = setTimeout(() => {
            this.peekFlips.delete(span);
            // Edge on to the viewer — swap the content and let the second half
            // of the turn bring the new face round. A span that stopped being
            // masked mid-flip (revealed, or repainted) is left alone: its text
            // is no longer ours to write.
            if (!span.isConnected || !span.classList.contains('vtt-masked-word')) {
                span.classList.remove('vtt-flipping');
                span.style.removeProperty('width');
                return;
            }
            this.faceOf(span).textContent = word;
            span.classList.toggle('vtt-peeked-word', peeked);
            span.classList.remove('vtt-flipping');
            // Hand the width back to the content once the turn is over: a
            // pinned px width would survive into the next repaint and fight
            // whatever text lands in the span then. Same moment the closing
            // turn earns its unwrap — the capsule is frosted and flat again, so
            // the rotating layer has nothing left to do and a span at rest is
            // once more exactly the markup the rest of the code expects.
            const release = setTimeout(() => {
                this.peekWidthReleases.delete(span);
                span.style.removeProperty('width');
                if (!peeked) this.unwrapFace(span);
            }, SidebarUI.PEEK_FLIP_MS);
            this.peekWidthReleases.set(span, release);
        }, SidebarUI.PEEK_FLIP_MS);
        this.peekFlips.set(span, timer);
    }

    // Measure what the far side will need and start the pane moving there.
    // Measured off a detached clone rather than by writing the word into the
    // live span: the span is on screen mid-turn, and a one-frame flash of the
    // real word inside a capsule that has not opened yet would give away the
    // very thing being hidden.
    private setFlipWidth(span: HTMLSpanElement, word: string): void {
        const from = span.getBoundingClientRect().width;
        // jsdom has no layout, so every box measures 0. Nothing to animate.
        if (!from) return;
        const probe = span.cloneNode(false) as HTMLSpanElement;
        probe.textContent = word;
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.width = 'auto';
        probe.style.left = '-9999px';
        span.parentElement?.appendChild(probe);
        const to = probe.getBoundingClientRect().width;
        probe.remove();
        if (!to) return;
        span.style.width = `${from}px`;
        // Force the pinned width to take before the target overwrites it,
        // otherwise the browser coalesces both into one style and never
        // transitions.
        void span.offsetWidth;
        span.style.width = `${to}px`;
    }

    // Width releases are tracked so a repaint can drop a pinned px width that
    // would otherwise outlive the span's turn.
    private peekWidthReleases = new Map<HTMLSpanElement, ReturnType<typeof setTimeout>>();

    // Read fresh each time rather than cached: the OS setting can change while
    // the page is open, and a peek is cheap enough to ask on.
    private static prefersReducedMotion(): boolean {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    private cancelFlip(span: HTMLSpanElement): void {
        const release = this.peekWidthReleases.get(span);
        if (release !== undefined) {
            clearTimeout(release);
            this.peekWidthReleases.delete(span);
        }
        const timer = this.peekFlips.get(span);
        if (timer === undefined) return;
        clearTimeout(timer);
        this.peekFlips.delete(span);
    }

    private cancelAllFlips(): void {
        this.peekFlips.forEach((timer) => clearTimeout(timer));
        this.peekFlips.clear();
        this.peekWidthReleases.forEach((timer, span) => {
            clearTimeout(timer);
            span.style.removeProperty('width');
        });
        this.peekWidthReleases.clear();
    }

    // Let go of the peek without touching the span — for the paths where the
    // spans are going away (or already gone from view) and so must not be
    // written to. peekOff is the opposite: it closes the capsule on screen.
    private dropPeek(): void {
        this.peekedSpan = null;
        this.cancelAllFlips();
    }

    private peekOn(span: HTMLSpanElement): void {
        if (this.peekedSpan === span) return;
        this.peekOff();
        const word = span.dataset.hidden;
        if (!word) return;
        // data-word stays absent: quick-add's contract is that only words the
        // user has actually revealed can be saved, and a peek does not reveal.
        this.peekedSpan = span;
        this.flipSpan(span, word, true);
    }

    private peekOff(): void {
        const span = this.peekedSpan;
        this.peekedSpan = null;
        if (!span) return;
        // Only put the filler back if this span is still masked. A reveal (or
        // a repaint that promoted it) already owns its text, and restoring the
        // mask here would cover a word that is now legitimately out.
        if (!span.classList.contains('vtt-masked-word')) {
            this.cancelFlip(span);
            span.classList.remove('vtt-flipping', 'vtt-peeked-word');
            span.style.removeProperty('width');
            this.unwrapFace(span);
            return;
        }
        this.flipSpan(span, span.dataset.mask ?? '', false);
    }

    // Delegated hover for the peek. The overlay only: peeking is for the line
    // you are watching, and the sidebar is a transcript you scroll — sweeping
    // the cursor down it would flip capsules the whole way.
    // Attached to the container rather than each span because the overlay
    // rebuilds its children ~4x/sec and per-span listeners would die with them.
    // mouseover / mouseout (not mouseenter/leave) so the events bubble up.
    private attachPeek(container: HTMLElement): void {
        container.addEventListener('mouseover', (e) => {
            if (this.state.displayMode !== 'guess') return;
            const span = (e.target as Element | null)?.closest?.('.vtt-masked-word');
            if (!span) return;
            this.peekOn(span as HTMLSpanElement);
        });
        container.addEventListener('mouseout', (e) => {
            const span = (e.target as Element | null)?.closest?.('.vtt-masked-word');
            if (!span || span !== this.peekedSpan) return;
            // Ignore moves that stay inside the same capsule.
            const to = (e as MouseEvent).relatedTarget as Node | null;
            if (to && span.contains(to)) return;
            this.peekOff();
        });
    }

    // Reveal one word and follow the line, the single action guess mode is made
    // of. Shared by the sidebar item and the overlay so the two cannot drift.
    // Where playback is, refreshed on every timeupdate and again the moment we
    // seek — the video's own currentTime lags a seek by a tick or two, and a
    // stale reading here would misread the click that follows as a jump.
    private playbackTime = 0;

    // How far a sidebar click may sit from the playhead and still count as
    // "the line I am working on". Past this, the click is navigation.
    private static readonly REVEAL_REACH_S = 5;

    // A click far from the playhead is someone moving through the transcript,
    // not someone trying to open the next word — so it only seeks. Reveal is a
    // deliberate act on the line you are actually on: spending it on a line you
    // are jumping to would uncover a word you never asked about, and there is
    // no way to put it back.
    //
    // Distance in seconds rather than in lines: a line is a unit of dialogue,
    // not of time, and three of them can span a rapid exchange or half a minute
    // of silence. What separates "this line" from "over there" is how far the
    // video has to move.
    //
    // Measured to the nearest point of the cue, not to its start: a film cue
    // routinely runs 5-7s, so measuring from startTime alone made a long line
    // un-revealable as soon as playback was REVEAL_REACH_S into it — and the
    // click then seeked backwards to the cue start, which is the opposite of
    // what pressing the line you are watching should do. Pausing mid-cue hit
    // the same wall. While the playhead is anywhere inside the cue the
    // distance is zero, which is the honest answer: that IS the line you are
    // on, however long it lasts.
    private isNavigationClick(sub: Subtitle): boolean {
        const nearest = Math.min(Math.max(this.playbackTime, sub.startTime), sub.endTime);
        return Math.abs(nearest - this.playbackTime) > SidebarUI.REVEAL_REACH_S;
    }

    // Every sidebar route into guess mode goes through here, so the
    // navigation rule cannot be applied on one of them and forgotten on the
    // next. The overlay calls revealAndSeek directly: it only ever shows the
    // line that is playing, so its distance is always zero.
    private revealOrSeek(index: number, sub: Subtitle): void {
        if (this.isNavigationClick(sub)) {
            this.seekTo(sub.startTime);
            return;
        }
        this.revealAndSeek(index, sub);
    }

    private revealAndSeek(index: number, sub: Subtitle): void {
        // A peek is transient paint on a span the repaint below is about to
        // rewrite; let go of it first so peekOff can never restore the mask
        // over a word the reveal has just uncovered.
        this.peekOff();
        this.state.revealNextWord(index);
        // Drop any leftover highlight: the user has moved on to revealing, and
        // updateOverlay refuses to repaint while a selection is inside (it would
        // orphan the Range), so the mask would advance in state but not on screen.
        window.getSelection()?.removeAllRanges();
        this.updateGuessItem(index);
        this.updateOverlay(index);
        this.seekTo(sub.startTime);
    }

    private seekTo(time: number): void {
        this.playbackTime = time;
        this.app.seekVideo(time);
    }

    private buildPlainItem(sub: Subtitle, index: number): HTMLDivElement {
        const item = this.createSubtitleItem(index);

        const mainText = document.createElement('div');
        mainText.className = 'vtt-main-text';
        this.fillPlainWordsInto(mainText, sub.text);
        item.appendChild(mainText);

        if (this.state.displayMode === 'dual') {
            const subText = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(sub));
            if (subText) item.appendChild(subText);
        }

        item.addEventListener('click', () => {
            if (hasSelectionInside(item)) return;
            this.app.seekVideo(sub.startTime);
        });
        return item;
    }

    highlightSubtitle(currentTime: number): void {
        this.playbackTime = currentTime;
        const mainTrack = this.state.getMainTrack();
        if (!mainTrack || !this.elements.list) return;

        // End-exclusive: adjacent cues share a boundary (one's endTime is the
        // next's startTime), so `<= endTime` would match BOTH at that instant
        // and findIndex returns the earlier one. Clicking a line seeks to its
        // startTime — exactly a shared boundary — which would flash the
        // previous line active for a frame before playback moved on. `<` makes
        // the boundary belong to the cue that starts there.
        const activeIndex = mainTrack.findIndex(s => currentTime >= s.startTime && currentTime < s.endTime);

        if (activeIndex !== this.state.currentIndex) {
            this.moveActiveSubtitleClass(activeIndex);
            this.state.currentIndex = activeIndex;
        }
        this.updateOverlay(this.state.currentIndex);
    }

    private moveActiveSubtitleClass(newIndex: number): void {
        if (!this.elements.list) return;
        this.elements.list.querySelector('.vtt-item.active-sub')?.classList.remove('active-sub');
        if (newIndex === -1) return;

        const newActive = this.elements.list.querySelector(`.vtt-item[data-index="${newIndex}"]`) as HTMLDivElement | null;
        if (!newActive) return;

        newActive.classList.add('active-sub');
        if (!this.state.isHovering) {
            // Via scrollActiveIntoView, which scrolls the list alone: this runs
            // on every subtitle change, so scrollIntoView here would drag the
            // whole page back to the player throughout playback.
            this.scrollActiveIntoView(this.pickScrollMode(newIndex, this.state.currentIndex));
        }
    }

    updateOverlay(index: number): void {
        const existing = document.getElementById('vtt-video-overlay');

        if (!this.state.overlayEnabled) {
            if (existing) {
                existing.style.display = 'none';
                // Forget the signature along with the peek. The children stay
                // in the DOM while hidden, so without this the sig check would
                // short-circuit the rebuild when the overlay comes back and
                // hand back the very capsule that was open under the cursor —
                // face-up, showing a word nobody revealed, with no cursor on it
                // to close it again. Guess mode's whole contract is that a
                // peeked word is masked the moment the cursor leaves.
                delete existing.dataset.sig;
            }
            this.dropPeek();
            return;
        }

        // Preserve an in-progress selection inside the overlay. timeupdate
        // ticks every ~250ms; rebuilding would destroy the user's Range.
        if (existing && hasSelectionInside(existing)) return;

        const desiredParent = this.app.getOverlayParent?.() ?? document.querySelector('video')?.parentElement ?? null;
        if (existing && desiredParent && existing.parentElement !== desiredParent) {
            existing.remove();
        }
        const overlay = document.getElementById('vtt-video-overlay') ?? this.createOverlayElement();
        if (!overlay) return; // No video to attach to yet.

        overlay.style.display = 'flex';

        const sub = index === -1 ? null : this.state.getMainTrack()?.[index];

        // Rebuild only when the rendered content would differ. This runs on
        // every timeupdate (~4×/sec); unconditionally recreating the children
        // made every capsule a newborn four times a second — for one frame it
        // had no :hover, then the 0.16s transition replayed, so the lit word
        // flickered under a resting cursor. (It also made Chrome drop clicks
        // whose press straddled a rebuild — see the pointerdown handler.)
        // Everything the children are derived from is in the signature: the
        // line, the mode, how much of it is uncovered, and which tracks feed
        // the text and the translation.
        // The adjusting flag is part of the signature because it changes what is
        // rendered (arrows, and a stand-in line where there would be nothing).
        // Between cues while adjusting, the PREVIEW's own identity has to be in
        // there too: 'empty' is a constant, so the preview would paint once and
        // then freeze, still showing the line nearest to wherever playback
        // happened to be when the panel opened.
        const preview = !sub && this.overlayAdjusting ? this.previewSubtitleFor(index) : null;
        const sig = sub
            ? [index, this.state.displayMode, this.state.getRevealedCount(index),
               this.state.activeTrackIndex, this.state.secondaryTrackIndex, this.state.swapped,
               this.overlayAdjusting].join('|')
            : preview
                ? ['preview', preview.sub.startTime, preview.sub.text.length,
                   this.state.displayMode, this.state.secondaryTrackIndex, this.state.swapped].join('|')
                : `empty|${this.overlayAdjusting}`;
        if (overlay.dataset.sig === sig) return;
        overlay.dataset.sig = sig;

        // The peeked span is about to be detached with the rest of the
        // children; drop the reference so peekOff never touches an orphan, and
        // cancel any half-finished flip along with it.
        this.dropPeek();
        // The grip must SURVIVE this wipe: it is a long-lived control the user
        // may be holding right now, and innerHTML = '' runs ~4x/sec, so a grip
        // rebuilt with the text would be torn out from under the pointer
        // mid-drag (losing its capture). Detached first, re-appended after.
        this.overlayHandle?.remove();
        overlay.innerHTML = '';

        // With the settings panel open the caption block has a second job: it is
        // the thing being positioned, so it must stay on screen even at a moment
        // the video has no line to show. Otherwise the arrows the user is
        // dragging would vanish under their own pointer between cues — the
        // control disappearing exactly while it is being used.
        overlay.classList.toggle('vtt-overlay-adjusting', this.overlayAdjusting);
        const shown = sub ?? preview?.sub ?? null;
        if (!shown) return;

        this.applyOverlayStyle();
        // A stand-in must not read as a real line: see .vtt-overlay-placeholder.
        // Taken from the lookup that produced it, never inferred by comparing
        // text — a real cue that happened to read the same would be dimmed.
        const placeholder = preview?.placeholder ?? false;

        const mainDiv = this.buildOverlayMain(shown, index);
        if (placeholder) mainDiv.classList.add('vtt-overlay-placeholder');
        // Grip first, caption second: the row stacks vertically, so the grip
        // fuses to the caption's top edge — see .vtt-overlay-row.
        const row = document.createElement('div');
        row.className = 'vtt-overlay-row';
        row.appendChild(this.ensureOverlayHandle());
        row.appendChild(mainDiv);
        overlay.appendChild(row);
        // Deferred to after the translation row is appended below, so the
        // measurement covers the whole block.
        queueMicrotask(() => this.reclampNudge());
        // A preview line is not the playing line, so it gets no guess-mode
        // translation gate — the point is to show the block's real shape,
        // which in dual mode means both rows.
        if (sub ? this.shouldShowOverlayTranslation(index) : this.state.displayMode !== 'single') {
            const subDiv = placeholder
                ? this.buildPlaceholderSecondary()
                : this.buildSecondaryTextElement(this.state.getOverlappingSecondary(shown), 'vtt-overlay-sub');
            if (subDiv) overlay.appendChild(subDiv);
        }
    }

    // What to show in the caption block while the settings panel is open and the
    // video is between cues (or has no track at all). Two fallbacks, in order:
    // the nearest real line to the current time, so the user positions against
    // text of a realistic length in their own languages; failing that a neutral
    // stand-in, so there is still a block to aim the arrows at.
    private previewSubtitleFor(index: number): { sub: Subtitle; placeholder: boolean } {
        const track = this.state.getMainTrack();
        if (track && track.length) {
            const near = index >= 0 && index < track.length ? track[index] : this.nearestSubtitle(track);
            if (near) return { sub: near, placeholder: false };
        }
        return { sub: { startTime: 0, endTime: 0, text: placeholderCaption() }, placeholder: true };
    }

    // Closest cue to the playhead by gap, so a pause between lines shows the one
    // just finished or about to start rather than always the first in the file.
    private nearestSubtitle(track: Subtitle[]): Subtitle | null {
        let best: Subtitle | null = null;
        let bestGap = Infinity;
        for (const s of track) {
            const gap = this.playbackTime < s.startTime
                ? s.startTime - this.playbackTime
                : this.playbackTime > s.endTime
                    ? this.playbackTime - s.endTime
                    : 0;
            if (gap < bestGap) { bestGap = gap; best = s; }
            if (gap === 0) break;
        }
        return best;
    }

    private buildPlaceholderSecondary(): HTMLDivElement {
        const div = document.createElement('div');
        div.className = 'vtt-overlay-sub vtt-overlay-placeholder';
        div.textContent = msg('ytOverlayPreviewSub', 'Translation appears here');
        return div;
    }

    // Whether the settings panel is open — while it is, the caption block stays
    // on screen between cues (borrowing the nearest line, or a placeholder) so
    // the user styles and positions against something visible. The grip itself
    // is NOT gated on this: it rides with the captions at all times.
    private overlayAdjusting = false;

    // The grip that drags the captions up and down. Created once and reused:
    // updateOverlay wipes the overlay's children ~4x/sec, and a control the
    // user is actively holding cannot be rebuilt under them.
    private overlayHandle: HTMLButtonElement | null = null;

    private ensureOverlayHandle(): HTMLButtonElement {
        if (this.overlayHandle) return this.overlayHandle;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vtt-overlay-handle';
        // A real button, so the control is reachable by keyboard and announced.
        // Six dots, the standing sign for "this is a handle, drag it" — and a
        // wide tab is the shape that reads as grippable. Dots rather than any
        // arrow precisely because the grip gives in BOTH axes now: an arrow
        // glyph would promise one direction and quietly deny the other.
        btn.innerHTML =
            '<svg viewBox="0 0 15 8" width="100%" height="100%" fill="currentColor" ' +
            'aria-hidden="true">' +
            '<circle cx="2" cy="2" r="1.2"/><circle cx="7.5" cy="2" r="1.2"/><circle cx="13" cy="2" r="1.2"/>' +
            '<circle cx="2" cy="6" r="1.2"/><circle cx="7.5" cy="6" r="1.2"/><circle cx="13" cy="6" r="1.2"/>' +
            '</svg>';
        const label = msg('ytOverlayDragHandle', 'Drag to move the subtitles');
        btn.title = label;
        btn.setAttribute('aria-label', label);
        this.attachOverlayDrag(btn);
        // The grip lives INSIDE the player element, and the player toggles
        // playback on a click anywhere on itself. Stopping pointerdown alone is
        // not enough: preventDefault there cancels the compatibility
        // mousedown/mouseup, but `click` is dispatched regardless, and a drag's
        // pointerup is followed by one too — so every drag also paused or
        // resumed the video. The whole pointer→mouse→click chain stops here.
        for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerup', 'touchstart', 'touchend'] as const) {
            btn.addEventListener(type, (e) => e.stopPropagation());
        }
        this.overlayHandle = btn;
        return btn;
    }

    // Dragging the grip moves the captions in both axes and persists where they
    // landed. Pointer events, not mouse: one code path covers mouse, touch and
    // pen, and setPointerCapture keeps the drag alive when the pointer leaves
    // the small grip — which it immediately does, since the caption moves out
    // from under it.
    private attachOverlayDrag(btn: HTMLButtonElement): void {
        let startX = 0;
        let startY = 0;
        let startNudge = 0;
        let startInline = 0;
        let dragging = false;

        const overlayEl = () => document.getElementById('vtt-video-overlay');

        btn.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            // Without this the press also reaches the player and toggles
            // playback, so every drag would pause the video.
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startNudge = this.overlayStyle.overlayBottomNudge;
            startInline = this.overlayStyle.overlayInlineNudge;
            btn.setPointerCapture(e.pointerId);
            btn.classList.add('vtt-dragging');
            overlayEl()?.classList.add('vtt-drag-active');
        });

        btn.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            e.preventDefault();
            // Both axes move on one drag: the grip is a position control, not a
            // vertical slider, so a diagonal pull has to land where the pointer
            // went. Each axis is measured against its own dimension — vertical
            // against the player's height, horizontal against its width — since
            // that is the unit each one is stored in.
            //
            // Screen y grows downward while `bottom` grows upward, so that delta
            // is inverted: drag up, the caption goes up. Screen x and the
            // translate agree in direction, so that one is not. Live feedback
            // without touching prefs — the write happens once, on release.
            this.overlayStyle.overlayBottomNudge = this.clampNudgeToPlayer(
                startNudge + this.pxToPct(startY - e.clientY),
            );
            this.overlayStyle.overlayInlineNudge = this.clampInlineToPlayer(
                startInline + this.pxToPctX(e.clientX - startX),
            );
            this.applyOverlayStyle();
        });

        const end = (e: PointerEvent) => {
            if (!dragging) return;
            dragging = false;
            btn.releasePointerCapture?.(e.pointerId);
            btn.classList.remove('vtt-dragging');
            overlayEl()?.classList.remove('vtt-drag-active');
            savePrefs(
                {
                    overlayBottomNudge: this.overlayStyle.overlayBottomNudge,
                    overlayInlineNudge: this.overlayStyle.overlayInlineNudge,
                },
                this.scope,
            );
        };
        btn.addEventListener('pointerup', end);
        btn.addEventListener('pointercancel', end);

        // Keyboard parity: the control is a real button, so it has to work
        // without a pointer. Arrows nudge, Shift jumps, and the write is
        // per-keystroke since there is no release to batch on.
        btn.addEventListener('keydown', (e) => {
            const step = e.shiftKey ? NUDGE_STEP_BIG_PX : NUDGE_STEP_PX;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const delta = e.key === 'ArrowUp' ? step : -step;
                this.overlayStyle.overlayBottomNudge = this.clampNudgeToPlayer(
                    this.overlayStyle.overlayBottomNudge + this.pxToPct(delta),
                );
                this.applyOverlayStyle();
                savePrefs({ overlayBottomNudge: this.overlayStyle.overlayBottomNudge }, this.scope);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const delta = e.key === 'ArrowRight' ? step : -step;
                this.overlayStyle.overlayInlineNudge = this.clampInlineToPlayer(
                    this.overlayStyle.overlayInlineNudge + this.pxToPctX(delta),
                );
                this.applyOverlayStyle();
                savePrefs({ overlayInlineNudge: this.overlayStyle.overlayInlineNudge }, this.scope);
            }
        });
    }

    /** Mirror of the settings panel's open state. Drives the caption preview. */
    setOverlayAdjusting(on: boolean): void {
        if (this.overlayAdjusting === on) return;
        this.overlayAdjusting = on;
        // The signature short-circuits identical rebuilds, so a mode change that
        // does not change the LINE would otherwise not repaint — the preview
        // would wait for the next cue to appear or disappear.
        const overlay = document.getElementById('vtt-video-overlay');
        if (overlay) delete overlay.dataset.sig;
        this.updateOverlay(this.state.currentIndex);
    }

    private playerHeight(): number {
        const overlay = document.getElementById('vtt-video-overlay');
        return overlay?.parentElement?.offsetHeight || REFERENCE_PLAYER_H;
    }

    // Screen pixels → share of the current player's height. The nudge is STORED
    // as that share, so a drag made in fullscreen lands at the same place on
    // the inline player instead of at the same number of px up a frame a third
    // the size.
    private pxToPct(px: number): number {
        return (px / this.playerHeight()) * 100;
    }

    private playerWidth(): number {
        const overlay = document.getElementById('vtt-video-overlay');
        return overlay?.parentElement?.offsetWidth || REFERENCE_PLAYER_W;
    }

    // The horizontal twin of pxToPct, against the player's WIDTH — which is what
    // a percentage translateX on the overlay resolves against, so the number
    // stored here and the number CSS applies are the same quantity.
    private pxToPctX(px: number): number {
        return (px / this.playerWidth()) * 100;
    }

    // Keep the caption inside the player it belongs to. Without this a drag can
    // push it off the top of the frame, where there is nothing to grab it by —
    // the control that moved it has gone with it, and the only way back is the
    // settings panel. The bound is derived from the live player height rather
    // than a constant so it holds in fullscreen too, where the frame is several
    // times taller than inline.
    private clampNudgeToPlayer(next: number): number {
        const preset = OVERLAY_BOTTOM_PCT[this.overlayStyle.overlayBottomOffset];
        const margin = 2.5;
        // The ceiling has to be measured against the caption's TOP edge, not its
        // bottom. `bottom` positions the block's lower edge, so a bound that
        // only looked at that let the block itself keep going: at bottom 77% a
        // two-line dual caption (~20% of the frame) has its top at 97%, and the
        // rest is off the top of the player — the state a user could reach by
        // dragging, and then could not undo, because the grip had gone with it.
        //
        // Measured live where possible: the caption's height depends on the
        // user's font size, on how many lines the text wrapped to, and on
        // whether the translation row is showing. The fallback covers the tick
        // before the block is first laid out (and jsdom, which has no layout) —
        // deliberately generous, since erring large only costs a little reach at
        // the very top, while erring small is what put the caption off-screen.
        const blockPct = this.overlayBlockHeightPct() ?? 22;
        const maxUp = Math.max(0, 100 - preset - blockPct - margin);
        const maxDown = Math.max(0, preset - margin);
        // Two decimals: fine enough that a 1px move on a 1080p frame (0.09%)
        // is not lost, coarse enough that prefs do not fill with float noise.
        return Math.round(Math.min(maxUp, Math.max(-maxDown, next)) * 100) / 100;
    }

    /** Height of the whole caption block as a share of the player, or null before layout. */
    private overlayBlockHeightPct(): number | null {
        const overlay = document.getElementById('vtt-video-overlay');
        const h = overlay?.offsetHeight ?? 0;
        const playerH = overlay?.parentElement?.offsetHeight ?? 0;
        if (!h || !playerH) return null;
        return (h / playerH) * 100;
    }

    // Keep the caption inside the frame sideways, the mirror of
    // clampNudgeToPlayer. The geometry is different, though: the block starts
    // CENTRED, so the room on either side is half of what the caption does not
    // already occupy — a caption filling 60% of the width can travel 20% before
    // its edge reaches the frame's, not 100%. Measured live, because that width
    // depends on the line's length, the font size and the user's max-width.
    private clampInlineToPlayer(next: number): number {
        // 4% of the width, not 1: measured on a 1205px player, a short caption
        // is narrow enough that a 1% margin let it travel until its edge sat
        // 20px from the frame's — technically inside the picture, and visibly
        // wrong. Native captions never touch the edge either.
        const margin = 4;
        // Fallback 80%: .vtt-overlay-main's max-width, the widest a caption can
        // legally get. Erring wide only costs a little travel before layout has
        // happened; erring narrow is what would let the text leave the frame.
        const blockPct = this.overlayBlockWidthPct() ?? 80;
        const room = Math.max(0, (100 - blockPct) / 2 - margin);
        return Math.round(Math.min(room, Math.max(-room, next)) * 100) / 100;
    }

    /** Width of the widest caption row as a share of the player, or null before layout. */
    private overlayBlockWidthPct(): number | null {
        const overlay = document.getElementById('vtt-video-overlay');
        const playerW = overlay?.parentElement?.offsetWidth ?? 0;
        if (!overlay || !playerW) return null;
        // NOT the overlay's own width: it is width: 100% of the player by
        // design (it has to be, for the container query), so measuring it would
        // report 100% every time and leave no travel at all. The rows inside it
        // are the ink.
        let w = 0;
        for (const child of Array.from(overlay.querySelectorAll<HTMLElement>(
            '.vtt-overlay-row, .vtt-overlay-main, .vtt-overlay-sub',
        ))) {
            w = Math.max(w, child.offsetWidth);
        }
        if (!w) return null;
        return (w / playerW) * 100;
    }

    // A stored position can be out of range even though nothing was dragged: the
    // player can get shorter (window resize, leaving fullscreen), the caption can
    // grow (a longer line, a bigger font, the translation row appearing), or the
    // value can predate a change in how it is measured. Any of those can leave
    // the block off the top of the frame with its own grip out of reach, so the
    // bound is re-applied on every render rather than only at drag time.
    private reclampNudge(): void {
        const patch: Partial<Prefs> = {};
        const bottom = this.clampNudgeToPlayer(this.overlayStyle.overlayBottomNudge);
        if (bottom !== this.overlayStyle.overlayBottomNudge) {
            this.overlayStyle.overlayBottomNudge = bottom;
            patch.overlayBottomNudge = bottom;
        }
        // The horizontal bound moves with the TEXT, not just the player: a
        // longer line is a wider block, so a position that was in frame for a
        // short caption can be out of it for the next one. Re-checked on every
        // render for that reason, exactly like the vertical one.
        const inline = this.clampInlineToPlayer(this.overlayStyle.overlayInlineNudge);
        if (inline !== this.overlayStyle.overlayInlineNudge) {
            this.overlayStyle.overlayInlineNudge = inline;
            patch.overlayInlineNudge = inline;
        }
        if (!Object.keys(patch).length) return;
        this.applyOverlayStyle();
        // Persist, or the out-of-range value comes back on the next page load
        // and the caption is off-screen again.
        savePrefs(patch, this.scope);
    }

    private createOverlayElement(): HTMLDivElement | null {
        const parent = this.app.getOverlayParent?.() ?? document.querySelector('video')?.parentElement;
        if (!parent) return null;
        const overlay = document.createElement('div');
        overlay.id = 'vtt-video-overlay';
        // In guess mode, the overlay reveals words one at a time exactly like a
        // click on the sidebar line does: same reveal, same seek, same reach of
        // the full translation once every word is out. The listener lives on the
        // container (not the inner div, which updateOverlay rebuilds every
        // ~250ms) so it survives those rebuilds.
        // Revealing is a run of quick clicks in the same spot, which the browser
        // reads as a double-click and turns into a word selection — that
        // selection then blocked the next reveal. The sidebar has always
        // suppressed this (see createSubtitleItem); the overlay never did, which
        // is why it was the surface that felt broken. Guess mode only: elsewhere
        // a double-click is a fair way to select a word for the dictionary.
        overlay.addEventListener('mousedown', (e) => {
            if (this.state.displayMode === 'guess' && e.detail > 1) e.preventDefault();
        });
        // Masked words reveal on pointerdown, not click. updateOverlay rebuilds
        // this element's children on every timeupdate (~4×/sec), and when that
        // rebuild lands between mousedown and mouseup Chrome drops the click
        // outright — measured with trusted CDP input: 40 presses on a capsule
        // over a 250ms-rebuild container delivered 40 pointerdowns and only 22
        // clicks. pointerdown fires at press time, before any rebuild can
        // detach the word. Clicks elsewhere on the caption stay click-based so
        // drag-selecting revealed words keeps working.
        //
        // The caption text is NOT a drag surface: moving the captions is the
        // grip's job (see ensureOverlayHandle). A press here that also had to
        // decide "reveal, select, or move?" made all three feel unreliable —
        // which is why the grip is a separate body beside the text.
        overlay.addEventListener('pointerdown', (e) => {
            this.pointerRevealed = false;
            if (this.state.displayMode !== 'guess' || e.button !== 0) return;
            if (!(e.target as Element | null)?.closest?.('.vtt-masked-word')) return;
            const index = this.state.currentIndex;
            const sub = index === -1 ? null : this.state.getMainTrack()?.[index];
            if (!sub) return;
            this.pointerRevealed = true;
            this.revealAndSeek(index, sub);
        });
        overlay.addEventListener('click', (e) => {
            if (this.state.displayMode !== 'guess') return;
            // The pointerdown above already revealed for this press.
            if (this.pointerRevealed) { this.pointerRevealed = false; return; }
            if (!shouldReveal(e, overlay)) return;
            const index = this.state.currentIndex;
            const sub = index === -1 ? null : this.state.getMainTrack()?.[index];
            if (!sub) return;
            this.revealAndSeek(index, sub);
        });
        // Keep the caption's own clicks off the player. The overlay is a CHILD of
        // the player element, and the player toggles playback on a click
        // anywhere inside itself — so every press on a subtitle (selecting a
        // word for the dictionary, revealing one in guess mode) also paused or
        // resumed the video.
        //
        // Scoped to the text boxes via .closest, not the whole overlay: the
        // overlay spans the full player width, and swallowing clicks across all
        // of it would break play/pause on the bare video beside a short caption.
        //
        // preventDefault is deliberately NOT called: it would kill the text
        // selection that quick-add depends on. Only propagation stops, which is
        // all the player's own listener needs to miss. mousedown/mouseup go too
        // — a player that toggles on either would otherwise still fire.
        for (const type of ['mousedown', 'mouseup', 'click', 'dblclick'] as const) {
            overlay.addEventListener(type, (e) => {
                if ((e.target as Element | null)?.closest?.('.vtt-overlay-main, .vtt-overlay-sub')) {
                    e.stopPropagation();
                }
            });
        }
        this.attachPeek(overlay);
        parent.appendChild(overlay);
        this.applyOverlayStyle();
        return overlay;
    }

    // Pushes the current overlayStyle prefs onto the overlay element as CSS
    // custom properties. The stylesheet reads var(--vtt-overlay-*) with default
    // fallbacks, so setting these inline restyles the captions live.
    private applyOverlayStyle(): void {
        const s = this.overlayStyle;
        const targets = [document.getElementById('vtt-video-overlay')];
        for (const el of targets) {
            if (!el) continue;
            el.style.setProperty('--vtt-overlay-font-family', OVERLAY_FONT_STACK[s.overlayFontFamily]);
            el.style.setProperty('--vtt-overlay-font-variant', OVERLAY_FONT_VARIANT[s.overlayFontFamily]);
            el.style.setProperty('--vtt-overlay-font-size', overlaySizePx(s.overlayFontSize));
            el.style.setProperty('--vtt-overlay-color', s.overlayColor);
            el.style.setProperty('--vtt-overlay-sub-font-size', overlaySizePx(s.overlaySubFontSize));
            el.style.setProperty('--vtt-overlay-sub-color', s.overlaySubColor);
            el.style.setProperty('--vtt-overlay-text-opacity', String(s.overlayTextOpacity));
            el.style.setProperty('--vtt-overlay-bg-color', s.overlayBgColor);
            el.style.setProperty('--vtt-overlay-bottom', `${OVERLAY_BOTTOM_PCT[s.overlayBottomOffset]}%`);
            el.style.setProperty('--vtt-overlay-nudge', `${s.overlayBottomNudge}%`);
            el.style.setProperty('--vtt-overlay-inline-nudge', `${s.overlayInlineNudge}%`);
            el.style.setProperty('--vtt-overlay-bg-opacity', OVERLAY_BG_OPACITY[s.overlayBgOpacity]);
            // The edge keeps glyphs legible where the box is see-through and raw
            // video shows behind them, so it contrasts with the TEXT, not the
            // box: dark text gets a light edge and vice versa. A hardcoded black
            // edge (what this used to be) vanished against the default black box
            // and made the Edge control look like it did nothing.
            //
            // Emit it ONCE PER LINE, each already resolved against that line's
            // own color. A single shared --vtt-overlay-edge cannot work:
            // var() substitution happens where the referencing property is
            // declared, so by the time .vtt-overlay-sub rebinds the color the
            // inherited value is already a literal with no var() left to
            // re-resolve -- the translation line silently drew the main edge.
            el.style.setProperty(
                '--vtt-overlay-edge',
                edgeValue(s.overlayEdgeStyle, hexLuminance(s.overlayColor) > 0.5 ? '#000' : '#fff'),
            );
            el.style.setProperty(
                '--vtt-overlay-sub-edge',
                edgeValue(s.overlayEdgeStyle, hexLuminance(s.overlaySubColor) > 0.5 ? '#000' : '#fff'),
            );
        }
    }

    private buildOverlayMain(sub: Subtitle, index: number): HTMLDivElement {
        const mainDiv = document.createElement('div');
        mainDiv.className = 'vtt-overlay-main';
        mainDiv.dataset.index = String(index);
        if (this.state.displayMode === 'guess') {
            this.fillMaskedWordsInto(mainDiv, sub.text, this.state.getRevealedCount(index));
        } else {
            this.fillPlainWordsInto(mainDiv, sub.text);
        }
        return mainDiv;
    }

    private shouldShowOverlayTranslation(index: number): boolean {
        if (this.state.displayMode === 'dual') return true;
        if (this.state.displayMode === 'guess') return this.state.isFullyRevealed(index);
        return false;
    }
}
