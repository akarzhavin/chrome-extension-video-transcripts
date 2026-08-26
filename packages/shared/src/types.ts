export interface Subtitle {
  startTime: number;
  endTime: number;
  text: string;
}

export interface Track {
  name: string;
  subtitles: Subtitle[];
}

/**
 * One entry in the settings-panel language dropdowns when a site drives them as
 * language pickers (Netflix) instead of track pickers. `available` marks the
 * languages the current title actually ships — those go in the top optgroup and
 * are selectable; the rest are shown disabled so the user sees the full catalog.
 */
export interface LanguageChoice {
  /** Base language code, e.g. 'en', 'ru', 'zh'. */
  code: string;
  /** Display name shown in the dropdown, e.g. 'English (CC)', 'Russian'. */
  label: string;
  /** True when the current title offers a subtitle track for this language. */
  available: boolean;
}

/** Which dropdown a language pick targets. */
export type TrackRole = 'learning' | 'native';

// A size slider row: the range input plus its live "123%" readout, kept
// together since markActiveStyleButtons updates both from the same value.
export interface SliderRowElements {
  input: HTMLInputElement;
  val: HTMLSpanElement;
}

export interface SidebarElements {
  sidebar?: HTMLDivElement;
  settingsBtn?: HTMLButtonElement;
  settingsPanel?: HTMLDivElement;
  mainSelect?: HTMLSelectElement;
  subSelect?: HTMLSelectElement;
  list?: HTMLDivElement;
  // Overlay-style preset buttons, each carrying a data-value; markActiveStyleButtons
  // toggles the .active class (and slides the segmented thumb) by matching
  // against the current prefs.
  styleColorBtns?: HTMLButtonElement[];
  styleSubColorBtns?: HTMLButtonElement[];
  styleBgColorBtns?: HTMLButtonElement[];
  styleTextOpacityBtns?: HTMLButtonElement[];
  styleOffsetBtns?: HTMLButtonElement[];
  styleBgBtns?: HTMLButtonElement[];
  styleEdgeBtns?: HTMLButtonElement[];
  themeBtns?: HTMLButtonElement[];
  // Live readout of the active theme's localized name (the theme strip).
  themeValueEl?: HTMLSpanElement;
  // Font family dropdown (a full-width row — the CEA-708 class names run too
  // long for the standard label-column layout the segmented rows use).
  styleFontSelect?: HTMLSelectElement;
  // The two size sliders (main line, translation line) plus their live
  // percent readouts.
  styleSizeSlider?: SliderRowElements;
  styleSubSizeSlider?: SliderRowElements;
  // Settings-takeover navigation: header title (swaps Subtitles ↔ Settings)
  // and the "‹ Subtitles" back chip.
  titleEl?: HTMLHeadingElement;
  backBtn?: HTMLButtonElement;
  // Feedback screen: a takeover reached from the settings panel's last line,
  // with its own "‹ Settings" back chip. Content is rebuilt on each open.
  feedbackPanel?: HTMLDivElement;
  feedbackBackBtn?: HTMLButtonElement;
  feedbackLink?: HTMLButtonElement;
  // Rebuilt on each open; openFeedbackScreen focuses it once the panel shows.
  feedbackTextarea?: HTMLTextAreaElement;
  // Quick-mode bar in the sub-header (icon-only Dual/Guess/On-screen; swap
  // lives on the language-pair chip). Dual/Guess share a segmented radio
  // control (quickModesSeg) whose sliding thumb tracks the selection.
  quickModesBar?: HTMLDivElement;
  quickModesSeg?: HTMLDivElement;
  qmSingleBtn?: HTMLButtonElement;
  qmDualBtn?: HTMLButtonElement;
  qmGuessBtn?: HTMLButtonElement;
  qmOverlayBtn?: HTMLButtonElement;
  // The tab at the screen edge that slides the sidebar in and out; the only
  // part of it still visible while collapsed.
  toggleBtn?: HTMLDivElement;
}

export interface AppInterface {
  updateHighlight(): void;
  seekVideo(time: number): void;
  getOverlayParent?(): HTMLElement | null;
  /**
   * The chosen learning/native languages, or null when the user hasn't picked
   * yet — nothing renders in that state, whatever the overlay pref says.
   * Structurally identical to LanguagePrefs (languages.ts); spelled out here
   * because this module deliberately has no imports.
   */
  langPrefs?: { learning: string; native: string } | null;
  /**
   * Turn the site's own native captions on/off at the source (in addition to
   * the CSS overlay-hide). Called with `false` while our overlay is enabled so
   * the two subtitle layers don't overlap, and `true` when it's disabled.
   */
  setNativeSubtitlesEnabled?(enabled: boolean): void;
  /**
   * When present, the settings-panel language dropdowns become language pickers
   * (populated from AppState.languageCatalog) instead of track pickers. Called
   * when the user picks a language for the learning/native slot; the site
   * fetches and loads that language's track on demand. Netflix implements this;
   * YouTube/Rezka leave it undefined and keep the legacy track-picker dropdowns.
   */
  requestLanguageTrack?(role: TrackRole, code: string): void;
  /**
   * Why a requested subtitle track is missing (rate-limited, no translation
   * offered, expired link…), or null when nothing failed. The sidebar uses it
   * to explain the disabled Dual chip; the same string backs the tooltip on
   * the partial-failure notice, so every surface tells one story.
   */
  missingTrackHint?(): string | null;
}
