import { AppState } from './AppState';
import {
    loadPrefs,
    onPrefsChanged,
    savePrefs,
    Prefs,
    OverlaySizeToken,
    OverlayLevelToken,
    OverlayEdgeToken,
} from './prefs';
import { SidebarElements, AppInterface, Subtitle, TrackRole } from './types';
import { tokenizeForGuess, isMaskableToken } from './guess-tokenize';
import { msg } from './i18n';

// Smooth-scroll budget. Jumps within this many subtitle indices animate;
// bigger jumps snap instantly so the user doesn't watch a full-list scroll.
const NEARBY_SUBTITLE_THRESHOLD = 20;

// Overlay-style preset tokens → concrete CSS values. These drive the
// --vtt-overlay-* custom properties set inline on #vtt-video-overlay; the
// stylesheet reads them with matching fallbacks (apps/rezka/src/assets/styles.css).
const OVERLAY_FONT_SIZE_PX: Record<OverlaySizeToken, string> = {
    small: '18px',
    medium: '24px',
    large: '32px',
};
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

const OVERLAY_EDGE: Record<OverlayEdgeToken, string> = {
    none: 'none',
    shadow: '1px 1px 3px #000',
    // Faux outline via 4-direction shadows (text-stroke isn't reliable cross-site).
    outline: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
};

// Fixed color palette offered as swatches in the settings panel.
const OVERLAY_COLORS: string[] = ['#ffffff', '#ffd700', '#00e5ff', '#7CFC00', '#ff9800'];

const OVERLAY_STYLE_DEFAULTS: Pick<
    Prefs,
    'overlayFontSize' | 'overlayColor' | 'overlayBottomOffset' | 'overlayBgOpacity' | 'overlayEdgeStyle'
> = {
    overlayFontSize: 'medium',
    overlayColor: '#ffffff',
    overlayBottomOffset: 'medium',
    overlayBgOpacity: 'medium',
    overlayEdgeStyle: 'shadow',
};

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
    swap: svgIcon('<path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>'),
    // Mode glyphs share one visual language — subtitle bars — instead of
    // abstractions (the old "?" read as Help/FAQ, the columns as split view).
    // dual: two stacked subtitle lines; guess: a line with mask dots below it
    // (text → "•••"); onScreen: a video frame with a caption bar inside.
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
        backBtn.type = 'button';
        backBtn.innerHTML = `${ICONS.back}<span>${msg('ytSidebarTitle', 'Subtitles')}</span>`;
        backBtn.addEventListener('click', () => this.toggleSettingsPanel());
        headerTop.appendChild(backBtn);

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

        const dualBtn = this.buildModeChip('vtt-dual-btn', ICONS.dual,
            msg('ytModeDual', 'Dual'), 'Toggle Dual Mode (Shift+D)');
        dualBtn.addEventListener('click', () => this.toggleDualMode());
        modes.appendChild(dualBtn);

        const guessBtn = this.buildModeChip('vtt-guess-btn', ICONS.guess,
            msg('ytModeGuess', 'Guess'), 'Toggle Guess Mode (Shift+G)');
        guessBtn.addEventListener('click', () => this.toggleGuessMode());
        modes.appendChild(guessBtn);

        const overlayBtn = this.buildModeChip('vtt-overlay-btn', ICONS.onScreen,
            msg('ytModeOnScreen', 'On-screen'), 'Toggle On-Screen Overlay (Shift+O)');
        overlayBtn.addEventListener('click', () => this.toggleOverlay());
        modes.appendChild(overlayBtn);

        modeGroup.appendChild(modes);
        settingsPanel.appendChild(modeGroup);

        // -- Group 3: Overlay appearance -----------------------------------------
        const styleGroup = this.buildGroup(ICONS.appearance, msg('ytGroupOverlay', 'Overlay appearance'));
        const resetBtn = document.createElement('button');
        resetBtn.className = 'vtt-reset';
        resetBtn.textContent = msg('ytStyleReset', 'Reset');
        resetBtn.addEventListener('click', () => this.resetOverlayStyle());
        (styleGroup.firstChild as HTMLElement).appendChild(resetBtn);

        styleGroup.appendChild(this.buildOverlayPreview());
        styleGroup.appendChild(this.buildStyleControls());
        settingsPanel.appendChild(styleGroup);

        // Exits from settings are the header "‹ Subtitles" back chip and the gear
        // toggle; no separate Done button at the panel bottom.
        header.appendChild(settingsPanel);
        sidebar.appendChild(header);

        // Subtitles List
        const list = document.createElement('div');
        list.id = 'vtt-list';
        sidebar.appendChild(list);

        document.body.appendChild(sidebar);

        // Store DOM references (style preset buttons registered in buildStyleControls).
        this.elements = {
            ...this.elements,
            sidebar, settingsBtn, settingsPanel, mainSelect, subSelect, dualBtn, overlayBtn, list,
            titleEl, backBtn,
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
            btn.dataset.tip = `${label} (${shortcut})`;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('role', role);
            btn.setAttribute(role === 'radio' ? 'aria-checked' : 'aria-pressed', 'false');
            btn.innerHTML = iconSvg;
            return btn;
        };

        // Dual + Guess are mutually exclusive (both are displayMode values), so
        // they share a segmented track with a sliding thumb — radiogroup
        // semantics. A third state (neither) is possible: the thumb hides.
        // NB: distinct class from the settings .vtt-seg (overlay-style picker) —
        // that one has a permanently-visible thumb and equal-flex text buttons.
        const seg = document.createElement('div');
        seg.className = 'vtt-modeseg';
        seg.dataset.sel = 'none';
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', msg('ytGroupReadingMode', 'Reading mode'));
        const thumb = document.createElement('span');
        thumb.className = 'vtt-modeseg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        seg.appendChild(thumb);

        const qmDualBtn = makeBtn('vtt-qm-dual', ICONS.dual, msg('ytModeDual', 'Dual'), 'Shift+D', 'radio');
        qmDualBtn.addEventListener('click', () => this.toggleDualMode());
        seg.appendChild(qmDualBtn);

        const qmGuessBtn = makeBtn('vtt-qm-guess', ICONS.guess, msg('ytModeGuess', 'Guess'), 'Shift+G', 'radio');
        qmGuessBtn.addEventListener('click', () => this.toggleGuessMode());
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

        this.elements = { ...this.elements, quickModesBar: bar, quickModesSeg: seg, qmDualBtn, qmGuessBtn, qmOverlayBtn };
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
    private buildStyleControls(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.id = 'vtt-style-controls';

        this.elements.styleSizeBtns = this.buildSegRow(
            wrap,
            msg('ytStyleSizeLabel', 'Size'),
            (['small', 'medium', 'large'] as OverlaySizeToken[]).map((v) => ({
                value: v,
                html: `<span class="vtt-a vtt-a-${v === 'small' ? 's' : v === 'medium' ? 'm' : 'l'}">A</span>`,
            })),
            (v) => this.setOverlayFontSize(v as OverlaySizeToken),
        );

        this.elements.styleColorBtns = this.buildSwatchRow(
            wrap,
            msg('ytStyleColorLabel', 'Color'),
            (v) => this.setOverlayColor(v),
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

        this.markActiveStyleButtons();
        return wrap;
    }

    // One labeled segmented control: equal-width buttons over a sliding thumb.
    // The thumb is moved by markActiveStyleButtons (translateX(index*100%)).
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
    // ring plus a dark check mark (readable even on low-contrast colors).
    private buildSwatchRow(
        parent: HTMLElement,
        label: string,
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
        for (const color of OVERLAY_COLORS) {
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
        row.appendChild(group);
        parent.appendChild(row);
        return buttons;
    }

    // Reflects the current overlayStyle in the controls: .active class on the
    // matching button plus the segmented thumb slid under it. Safe to call
    // before the buttons exist.
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
        };
        mark(this.elements.styleSizeBtns, this.overlayStyle.overlayFontSize);
        mark(this.elements.styleColorBtns, this.overlayStyle.overlayColor);
        mark(this.elements.styleOffsetBtns, this.overlayStyle.overlayBottomOffset);
        mark(this.elements.styleBgBtns, this.overlayStyle.overlayBgOpacity);
        mark(this.elements.styleEdgeBtns, this.overlayStyle.overlayEdgeStyle);
    }

    // Restores the default overlay appearance with a single storage write so
    // other tabs converge in one onPrefsChanged tick.
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

    private resetOverlayStyle(): void {
        this.overlayStyle = { ...OVERLAY_STYLE_DEFAULTS };
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ ...OVERLAY_STYLE_DEFAULTS });
    }

    private setOverlayFontSize(v: OverlaySizeToken): void {
        this.overlayStyle.overlayFontSize = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayFontSize: v });
    }

    private setOverlayColor(v: string): void {
        this.overlayStyle.overlayColor = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayColor: v });
    }

    private setOverlayBottomOffset(v: OverlayLevelToken): void {
        this.overlayStyle.overlayBottomOffset = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayBottomOffset: v });
    }

    private setOverlayBgOpacity(v: OverlayLevelToken): void {
        this.overlayStyle.overlayBgOpacity = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayBgOpacity: v });
    }

    private setOverlayEdgeStyle(v: OverlayEdgeToken): void {
        this.overlayStyle.overlayEdgeStyle = v;
        this.applyOverlayStyle();
        this.markActiveStyleButtons();
        savePrefs({ overlayEdgeStyle: v });
    }

    // Loads persisted prefs into AppState + DOM, then subscribes so cross-tab
    // changes (or popup-driven changes later) propagate in. Fire-and-forget —
    // the initial render uses defaults; the prefs swap re-renders if needed.
    private hydrateFromPrefs(): void {
        loadPrefs().then((prefs) => {
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
        }));
    }

    // Copies overlay-style fields from a Prefs snapshot into local state, then
    // restyles the live overlay and re-marks the active preset buttons. Shared
    // by the initial hydrate and cross-tab onPrefsChanged.
    private adoptOverlayStyle(prefs: Prefs): void {
        this.overlayStyle = {
            overlayFontSize: prefs.overlayFontSize,
            overlayColor: prefs.overlayColor,
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
        savePrefs({ overlayEnabled: this.state.overlayEnabled });
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
                    loadPrefs().then((prefs) => {
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
        this.elements.dualBtn.classList.toggle('active', this.state.displayMode === 'dual');
        this.elements.overlayBtn.classList.toggle('active', this.state.overlayEnabled);

        const guessBtn = document.getElementById('vtt-guess-btn') as HTMLButtonElement | null;
        if (guessBtn) guessBtn.classList.toggle('active', this.state.displayMode === 'guess');

        // Quick bar mirrors the settings chips: same .active semantics, same
        // single-track disables; hidden entirely until subtitles are loaded.
        const { quickModesBar, quickModesSeg, qmDualBtn, qmGuessBtn, qmOverlayBtn } = this.elements;
        if (quickModesBar) quickModesBar.style.display = this.state.tracks.length ? '' : 'none';
        const dualOn = this.state.displayMode === 'dual';
        const guessOn = this.state.displayMode === 'guess';
        // Dual/Guess are radio segments (aria-checked); the sliding thumb tracks
        // the selection via data-sel ('none' when neither → thumb hides).
        const syncRadio = (btn: HTMLButtonElement | undefined, on: boolean): void => {
            if (!btn) return;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-checked', String(on));
        };
        syncRadio(qmDualBtn, dualOn);
        syncRadio(qmGuessBtn, guessOn);
        if (quickModesSeg) quickModesSeg.dataset.sel = dualOn ? 'dual' : guessOn ? 'guess' : 'none';
        // On-screen is an independent toggle (aria-pressed).
        if (qmOverlayBtn) {
            qmOverlayBtn.classList.toggle('active', this.state.overlayEnabled);
            qmOverlayBtn.setAttribute('aria-pressed', String(this.state.overlayEnabled));
        }
        // The YouTube control-bar button (if installed) needs nothing here: it
        // opens the menu, which is always available, so it has no on/off to
        // mirror. The overlay's state shows on the CC button beside it, which
        // player-menu.ts paints from this same state on open and on refresh.
        if (qmDualBtn) qmDualBtn.disabled = !hasMultiple;

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

        this.elements.dualBtn.disabled = !hasMultiple;

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
        // the words themselves are not individually actionable.
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', msg('ytGuessRevealAria', 'Reveal the next word of this subtitle'));

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
            el.style.setProperty('--vtt-overlay-font-size', OVERLAY_FONT_SIZE_PX[s.overlayFontSize]);
            el.style.setProperty('--vtt-overlay-color', s.overlayColor);
            el.style.setProperty('--vtt-overlay-bottom', OVERLAY_BOTTOM_PX[s.overlayBottomOffset]);
            el.style.setProperty('--vtt-overlay-bg-opacity', OVERLAY_BG_OPACITY[s.overlayBgOpacity]);
            el.style.setProperty('--vtt-overlay-edge', OVERLAY_EDGE[s.overlayEdgeStyle]);
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
