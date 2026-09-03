// Overlay style: the preset tokens, colour maths and typography stacks behind
// the on-video captions.
//
// Lifted verbatim from SidebarUI.ts, where it sat at module level and was never
// part of the class at all — 8% of that file that no method could reach into.
// Nothing here closes over the sidebar, so nothing here needs it.
//
// NOT re-exported from src/index.ts: that barrel is also the surface of
// packages/embed, and it does not need to grow for an internal split.
import { msg } from './i18n';
import {
    Prefs,
    OverlaySizePercent,
    OverlayBackdropToken,
    OverlayEdgeToken,
    OverlayFontFamily,
} from './prefs';

// Overlay-style preset tokens → concrete CSS values. These drive the
// --vtt-overlay-* custom properties set inline on #vtt-video-overlay; the
// stylesheet reads them with matching fallbacks (apps/rezka/src/assets/styles.css).
// Font size is a percentage of a 24px base, not a token — the sidebar drives
// it with a slider (50-400, step 5) rather than a fixed set of presets, since
// a 3-way token left the 100-150% range most people want unreachable.
export const OVERLAY_SIZE_BASE_PX = 24;
export function overlaySizePx(pct: OverlaySizePercent): string {
    return `${(OVERLAY_SIZE_BASE_PX * pct) / 100}px`;
}
// One arrow-key press on the grip moves the captions this far on screen; Shift
// multiplies it. Screen px, converted to a share of the player at the moment of
// the press (see pxToPct), so the felt step is the same in fullscreen and inline
// while the stored value stays proportional.
export const NUDGE_STEP_PX = 4;
export const NUDGE_STEP_BIG_PX = 20;
// Shown in the caption box while the settings panel is open and the video has no
// line at this moment and no track to borrow one from. It must read as a sample
// of a caption, not as a caption — see .vtt-overlay-placeholder. A function, not
// a const: msg() reads chrome.i18n, which is not ready at module-evaluation
// time, and a const would freeze the English fallback for every locale.
export const placeholderCaption = () => msg('ytOverlayPreviewMain', 'Subtitles appear here');

// Fallback player height for the px→% conversions when the overlay is not
// mounted yet (or offsetHeight is 0, as in jsdom): a 1080p frame, the reference
// every other overlay unit was tuned at.
export const REFERENCE_PLAYER_H = 1080;
export const REFERENCE_PLAYER_W = 1920;
export const OVERLAY_BG_OPACITY: Record<OverlayBackdropToken, string> = {
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
export function edgeValue(style: OverlayEdgeToken, color: string): string {
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
export function hexLuminance(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// The seven CEA-708 font classes, each resolved to a system stack — nothing
// is bundled (the BBC's own guidance: a platform font beats a shipped one for
// on-screen legibility). 'smallCaps' has no reliable cross-platform typeface,
// so it is font-variant-caps on the proportional-sans stack instead.
export const OVERLAY_FONT_STACK: Record<OverlayFontFamily, string> = {
    monoSerif: "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace",
    propSerif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, 'Times New Roman', serif",
    monoSans: "ui-monospace, Menlo, Consolas, 'Cascadia Code', 'DejaVu Sans Mono', 'Liberation Mono', monospace",
    propSans: "Inter, Roboto, 'Helvetica Neue', 'Arial Nova', 'Nimbus Sans', Arial, sans-serif",
    casual: "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, 'Arial Rounded MT Bold', 'Segoe Print', sans-serif",
    cursive: "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', 'Apple Chancery', cursive",
    smallCaps: "Inter, Roboto, 'Helvetica Neue', 'Arial Nova', 'Nimbus Sans', Arial, sans-serif",
};
export const OVERLAY_FONT_VARIANT: Record<OverlayFontFamily, string> = {
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
export const OVERLAY_COLORS: string[] = ['#ffffff', '#ffd700', '#00e5ff', '#7CFC00', '#ff9800'];
// The caption box sits behind text, so its useful range is neutral, not the
// accent hues offered for the text itself.
export const OVERLAY_BG_COLORS: string[] = ['#000000', '#3a3a3a', '#7a7a7a', '#ffffff', '#0a1a3c'];

// The two Reset buttons' payloads — one per panel group, each resetting only
// the fields in its own group. Neither includes overlayEnabled: Reset
// restores DEFAULT appearance, not the on/off state; a user who turned the
// overlay off and then reset styling would not expect it to switch back on.
export const OVERLAY_TEXT_DEFAULTS: Pick<
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

export const OVERLAY_BOX_DEFAULTS: Pick<
    Prefs,
    | 'overlayBgColor'
    | 'overlayBottomOffset'
    | 'overlayBgOpacity'
    | 'overlayEdgeStyle'
> = {
    overlayBgColor: '#000000',
    overlayBottomOffset: 'medium',
    overlayBgOpacity: 'medium',
    overlayEdgeStyle: 'shadow',
};

// Union of both — the initial value of the local overlayStyle mirror, before
// prefs are hydrated.
export const OVERLAY_STYLE_DEFAULTS: Pick<
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
