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
    OverlayEdgeToken,
    OverlayFontFamily,
    PrefScope,
} from './prefs';
import { SidebarElements, AppInterface, Subtitle, TrackRole, SliderRowElements } from './types';
import { tokenizeForGuess, isMaskableToken } from './guess-tokenize';
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
const OVERLAY_BOTTOM_PX: Record<OverlayLevelToken, string> = {
    low: '40px',
    medium: '80px',
    high: '140px',
};
const OVERLAY_BG_OPACITY: Record<OverlayLevelToken, string> = {
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
    'overlayBgColor' | 'overlayBottomOffset' | 'overlayBgOpacity' | 'overlayEdgeStyle'
> = {
    overlayBgColor: '#000000',
    overlayBottomOffset: 'medium',
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
        if (document.getElementById('vtt-sidebar')) return false;

        const sidebar = document.createElement('div');
        sidebar.id = 'vtt-sidebar';

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

        // -- Group 2: Reading mode ---------------------------------------------
        // Swap is not here: it lives on the language-pair chip (clicking the
        // pair swaps the tracks), so a settings button would duplicate it.
        const modeGroup = this.buildGroup(ICONS.reading, msg('ytGroupReadingMode', 'Reading mode'));
        const modes = document.createElement('div');
        modes.id = 'vtt-controls';
        modes.className = 'vtt-modes';

        // Three modes, three chips, one always active. Two toggle chips used to
        // hide `single` as "both off", which read as a third mode smuggled into
        // a button that just… turns things off.
        const singleBtn = this.buildModeChip('vtt-single-btn', ICONS.single,
            msg('ytModeSingle', 'Single'), 'Single Subtitles');
        singleBtn.addEventListener('click', () => this.setMode('single'));
        modes.appendChild(singleBtn);

        const dualBtn = this.buildModeChip('vtt-dual-btn', ICONS.dual,
            msg('ytModeDual', 'Dual'), 'Dual Subtitles (Shift+D)');
        // aria-disabled (see updateControls) keeps the chip hoverable so it can
        // explain itself, which means the off state has to be enforced here.
        dualBtn.addEventListener('click', () => {
            if (dualBtn.getAttribute?.('aria-disabled') === 'true') return;
            this.setMode('dual');
        });
        modes.appendChild(dualBtn);

        const guessBtn = this.buildModeChip('vtt-guess-btn', ICONS.guess,
            msg('ytModeGuess', 'Guess'), 'Guess Mode (Shift+G)');
        guessBtn.addEventListener('click', () => this.setMode('guess'));
        modes.appendChild(guessBtn);

        const overlayBtn = this.buildModeChip('vtt-overlay-btn', ICONS.onScreen,
            msg('ytModeOnScreen', 'On-screen'), 'Toggle On-Screen Overlay (Shift+O)');
        overlayBtn.addEventListener('click', () => this.toggleOverlay());
        modes.appendChild(overlayBtn);

        modeGroup.appendChild(modes);
        settingsPanel.appendChild(modeGroup);

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

        textGroup.appendChild(this.buildOverlayPreview());
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
            sidebar, settingsBtn, settingsPanel, mainSelect, subSelect, dualBtn, overlayBtn, list,
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

    // Reading-mode toggle chip: icon + label + state dot. Active state is the
    // shared .active class (updateControls toggles it).
    private buildModeChip(id: string, iconSvg: string, label: string, title: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.id = id;
        btn.className = 'vtt-mode';
        btn.title = title;
        // Kept so updateControls can restore it after swapping in a contextual
        // "why is this disabled" explanation.
        btn.dataset.baseTitle = title;
        btn.innerHTML = `${iconSvg}<span class="vtt-mode-label">${label}</span><span class="vtt-mode-dot"></span>`;
        return btn;
    }

    // Compact icon-only mode switcher in the sub-header row: Dual · Guess ·
    // On-screen, sharing state with the settings "Reading mode" group via
    // updateControls. Swap lives on the language-pair chip (clicking the pair
    // swaps the tracks), so it has no button here.
    private buildQuickModes(): HTMLDivElement {
        const bar = document.createElement('div');
        bar.id = 'vtt-quickmodes';
        bar.style.display = 'none'; // updateControls shows it once tracks exist
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', msg('ytGroupReadingMode', 'Reading mode'));
        const inner = bar;

        // Visible micro-label so the cluster names itself without hover (the
        // group aria-label above stays the SR name; this span is decorative).
        const barLabel = document.createElement('span');
        barLabel.className = 'vtt-qm-label';
        barLabel.setAttribute('aria-hidden', 'true');
        barLabel.textContent = msg('ytModesLabel', 'Modes');
        inner.appendChild(barLabel);

        // `role` is 'radio' for the exclusive Dual/Guess segments, 'button'
        // (aria-pressed) for the independent On-screen toggle.
        const makeBtn = (id: string, iconSvg: string, label: string, shortcut: string, role: 'radio' | 'button'): HTMLButtonElement => {
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
            btn.setAttribute(role === 'radio' ? 'aria-checked' : 'aria-pressed', 'false');
            btn.innerHTML = iconSvg;
            return btn;
        };

        // The three reading modes share a segmented track with a sliding thumb —
        // radiogroup semantics, exactly one always selected. Single used to be
        // the hidden "neither" state of two toggles, which read as a third mode
        // smuggled into an off switch.
        // NB: distinct class from the settings .vtt-seg (overlay-style picker) —
        // that one has a permanently-visible thumb and equal-flex text buttons.
        const seg = document.createElement('div');
        seg.className = 'vtt-modeseg';
        seg.dataset.sel = 'single';
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', msg('ytGroupReadingMode', 'Reading mode'));
        const thumb = document.createElement('span');
        thumb.className = 'vtt-modeseg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        seg.appendChild(thumb);

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

        const qmOverlayBtn = makeBtn('vtt-qm-overlay', ICONS.onScreen, msg('ytModeOnScreen', 'On-screen'), 'Shift+O', 'button');
        qmOverlayBtn.classList.add('vtt-qm-toggle');
        qmOverlayBtn.addEventListener('click', () => this.toggleOverlay());
        inner.appendChild(qmOverlayBtn);

        this.elements = { ...this.elements, quickModesBar: bar, quickModesSeg: seg, qmSingleBtn, qmDualBtn, qmGuessBtn, qmOverlayBtn };
        return bar;
    }

    // Live preview of the on-video overlay: a fake film frame containing the
    // real .vtt-overlay-main/.vtt-overlay-sub elements, styled by the same
    // --vtt-overlay-* variables (scaled down via CSS) so every preset change
    // is visible without looking at the video.
    private buildOverlayPreview(): HTMLDivElement {
        const preview = document.createElement('div');
        preview.id = 'vtt-style-preview';

        const cap = document.createElement('div');
        cap.className = 'vtt-preview-cap';
        const main = document.createElement('div');
        main.className = 'vtt-overlay-main';
        const sub = document.createElement('div');
        sub.className = 'vtt-overlay-sub';
        cap.appendChild(main);
        cap.appendChild(sub);
        preview.appendChild(cap);

        const off = document.createElement('div');
        off.className = 'vtt-preview-off';
        off.textContent = msg('ytOverlayOffNote', 'On-screen overlay is off');
        preview.appendChild(off);

        this.elements.previewEl = preview;
        this.elements.previewMain = main;
        this.elements.previewSub = sub;
        return preview;
    }

    // Refreshes the preview's text + visibility to mirror the real overlay:
    // current subtitle when a track is loaded (falling back to a sample pair),
    // masked words in guess mode, translation line in dual mode, dimmed state
    // when the overlay is off.
    private updateOverlayPreview(): void {
        const { previewEl, previewMain, previewSub } = this.elements;
        if (!previewEl || !previewMain || !previewSub) return;

        previewEl.classList.toggle('vtt-preview-disabled', !this.state.overlayEnabled);

        const idx = this.state.currentIndex;
        const current = idx >= 0 ? this.state.getMainTrack()?.[idx] : undefined;
        const mainText = current?.text ?? msg('ytPreviewSampleMain', 'The quick brown fox');
        previewMain.innerHTML = '';
        if (this.state.displayMode === 'guess') {
            this.fillMaskedWordsInto(previewMain, mainText, current ? this.state.getRevealedCount(idx) : 1);
        } else {
            previewMain.textContent = mainText;
        }

        const secondary = current
            ? this.state.getOverlappingSecondary(current).map((s) => s.text).join(' | ')
            : '';
        previewSub.textContent = secondary || msg('ytPreviewSampleSub', 'Translation preview');
        previewSub.style.display = this.state.displayMode === 'dual' ? '' : 'none';
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
                { value: 'low', html: msg('ytBackdropLight', 'Light') },
                { value: 'medium', html: msg('ytBackdropMedium', 'Medium') },
                { value: 'high', html: msg('ytBackdropSolid', 'Solid') },
            ],
            (v) => this.setOverlayBgOpacity(v as OverlayLevelToken),
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
        options: { value: string; html: string }[],
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
            btn.title = `${label}: ${opt.value}`;
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
        Object.assign(this.overlayStyle, OVERLAY_TEXT_DEFAULTS);
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ ...OVERLAY_TEXT_DEFAULTS }, this.scope);
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

    private setOverlayBgOpacity(v: OverlayLevelToken): void {
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
            overlayBgOpacity: prefs.overlayBgOpacity,
            overlayEdgeStyle: prefs.overlayEdgeStyle,
        };
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        this.updateOverlayPreview();
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
        this.updateOverlayPreview();
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
        if (!this.elements.settingsBtn || !this.elements.dualBtn || !this.elements.overlayBtn || !this.elements.mainSelect || !this.elements.subSelect) return;

        this.elements.settingsBtn.style.display = 'flex';

        const hasMultiple = this.state.hasMultipleTracks();
        const mode = this.state.displayMode;
        this.elements.dualBtn.classList.toggle('active', mode === 'dual');
        this.elements.overlayBtn.classList.toggle('active', this.state.overlayEnabled);

        const guessBtn = document.getElementById('vtt-guess-btn') as HTMLButtonElement | null;
        if (guessBtn) guessBtn.classList.toggle('active', mode === 'guess');
        const singleBtn = document.getElementById('vtt-single-btn') as HTMLButtonElement | null;
        if (singleBtn) singleBtn.classList.toggle('active', mode === 'single');

        // Quick bar mirrors the settings chips: same .active semantics, same
        // single-track disables; hidden entirely until subtitles are loaded.
        const { quickModesBar, quickModesSeg, qmSingleBtn, qmDualBtn, qmGuessBtn, qmOverlayBtn } = this.elements;
        if (quickModesBar) quickModesBar.style.display = this.state.tracks.length ? '' : 'none';
        // The three modes are radio segments (aria-checked); the sliding thumb
        // tracks the selection via data-sel. Exactly one is always checked —
        // single is a mode of its own, not "both toggles off".
        const syncRadio = (btn: HTMLButtonElement | undefined, on: boolean): void => {
            if (!btn) return;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-checked', String(on));
        };
        syncRadio(qmSingleBtn, mode === 'single');
        syncRadio(qmDualBtn, mode === 'dual');
        syncRadio(qmGuessBtn, mode === 'guess');
        if (quickModesSeg) quickModesSeg.dataset.sel = mode;
        // On-screen is an independent toggle (aria-pressed).
        if (qmOverlayBtn) {
            qmOverlayBtn.classList.toggle('active', this.state.overlayEnabled);
            qmOverlayBtn.setAttribute('aria-pressed', String(this.state.overlayEnabled));
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

        // A disabled control that won't say why reads as broken, so when the
        // app knows why the second track is missing (throttled, not offered,
        // expired link) the chip explains itself on hover — the same string the
        // partial-failure notice shows, so the UI tells one story.
        //
        // aria-disabled, not the `disabled` property: a disabled button fires
        // no pointer events at all, so its tooltip could never appear — the one
        // control most in need of an explanation would be the one unable to
        // give it. It also stays focusable, so a screen reader reaches the
        // reason too. The click handler enforces the off state.
        const hint = (!hasMultiple && this.app.missingTrackHint?.()) || '';
        const dualBtn = this.elements.dualBtn;
        dualBtn.disabled = !hasMultiple && !hint;
        dualBtn.setAttribute?.('aria-disabled', String(!hasMultiple));
        dualBtn.classList?.toggle('vtt-mode-blocked', !hasMultiple && !!hint);
        if (dualBtn.dataset) {
            if (hint) dualBtn.dataset.tip = hint;
            else delete dualBtn.dataset.tip;
        }
        dualBtn.title = hint || dualBtn.dataset?.baseTitle || '';

        if (activeId) {
            const activeEl = document.getElementById(activeId);
            if (activeEl) activeEl.focus();
        }
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

    // What sits under the frosted pane. Its only job is to give the pane the
    // width of the word it hides — the length is the hint guess mode trades on.
    //
    // One repeated neutral glyph, not stand-in letters: fake words survive the
    // blur as readable nonsense ("ptmsph"), so the line reads as gibberish
    // instead of as language out of focus, which is worse than the asterisks
    // this replaced. A single repeated shape blurs into an even smudge.
    // The real word can never go here — a blur is only paint, and the text
    // under it stays selectable and copyable.
    private maskGlyphs(token: string, _spaced: boolean): string {
        // Half the letters, not one per letter: a pane one glyph wide per
        // character runs far wider than the word it stands for — 'n' is a wide
        // glyph and real text averages much narrower — which pushed short lines
        // onto two rows. Halving keeps long words visibly longer than short
        // ones while the line still fits.
        const len = Math.min(Math.max(Math.ceil(token.length / 2), 1), 7);
        return 'n'.repeat(len);
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
                span.textContent = word;
            } else if (!shouldReveal && !span.classList.contains('vtt-masked-word')) {
                span.dataset.hidden = span.dataset.hidden ?? span.dataset.word ?? '';
                delete span.dataset.word;
                span.className = 'vtt-masked-word';
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
            this.revealAndSeek(index, sub);
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
            this.revealAndSeek(index, sub);
        });
        item.addEventListener('click', (e) => {
            // The pointerdown above already revealed for this press.
            if (this.pointerRevealed) { this.pointerRevealed = false; return; }
            // Drag-selecting inside the item fires this click too; stand down
            // for a live selection and keep the quick-add pill usable.
            if (!shouldReveal(e, item)) return;
            this.revealAndSeek(index, sub);
        });
        return item;
    }

    // True between a pointerdown that revealed a word and the click the same
    // press delivers afterwards; that click must not reveal a second one.
    private pointerRevealed = false;

    // Reveal one word and follow the line, the single action guess mode is made
    // of. Shared by the sidebar item and the overlay so the two cannot drift.
    private revealAndSeek(index: number, sub: Subtitle): void {
        this.state.revealNextWord(index);
        // Drop any leftover highlight: the user has moved on to revealing, and
        // updateOverlay refuses to repaint while a selection is inside (it would
        // orphan the Range), so the mask would advance in state but not on screen.
        window.getSelection()?.removeAllRanges();
        this.updateGuessItem(index);
        this.updateOverlay(index);
        this.app.seekVideo(sub.startTime);
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
            if (existing) existing.style.display = 'none';
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
        const sig = sub
            ? [index, this.state.displayMode, this.state.getRevealedCount(index),
               this.state.activeTrackIndex, this.state.secondaryTrackIndex, this.state.swapped].join('|')
            : 'empty';
        if (overlay.dataset.sig === sig) return;
        overlay.dataset.sig = sig;

        overlay.innerHTML = '';
        if (!sub) return;

        this.applyOverlayStyle();
        overlay.appendChild(this.buildOverlayMain(sub, index));
        if (this.shouldShowOverlayTranslation(index)) {
            const subDiv = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(sub), 'vtt-overlay-sub');
            if (subDiv) overlay.appendChild(subDiv);
        }
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
        parent.appendChild(overlay);
        this.applyOverlayStyle();
        return overlay;
    }

    // Pushes the current overlayStyle prefs onto the overlay element — and the
    // sidebar's live preview — as CSS custom properties. The stylesheet reads
    // var(--vtt-overlay-*) with default fallbacks, so setting these inline
    // restyles both live (the preview scales them down via calc()).
    private applyOverlayStyle(): void {
        const s = this.overlayStyle;
        const targets = [document.getElementById('vtt-video-overlay'), this.elements.previewEl];
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
            el.style.setProperty('--vtt-overlay-bottom', OVERLAY_BOTTOM_PX[s.overlayBottomOffset]);
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
