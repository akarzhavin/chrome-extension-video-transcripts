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

export interface SidebarElements {
  sidebar?: HTMLDivElement;
  settingsBtn?: HTMLDivElement;
  settingsPanel?: HTMLDivElement;
  mainSelect?: HTMLSelectElement;
  subSelect?: HTMLSelectElement;
  dualBtn?: HTMLButtonElement;
  overlayBtn?: HTMLButtonElement;
  list?: HTMLDivElement;
  // Overlay-style preset buttons, each carrying a data-value; markActiveStyleButtons
  // toggles the .active class (and slides the segmented thumb) by matching
  // against the current prefs.
  styleSizeBtns?: HTMLButtonElement[];
  styleColorBtns?: HTMLButtonElement[];
  styleOffsetBtns?: HTMLButtonElement[];
  styleBgBtns?: HTMLButtonElement[];
  styleEdgeBtns?: HTMLButtonElement[];
  // Live overlay preview inside the settings panel.
  previewEl?: HTMLDivElement;
  previewMain?: HTMLDivElement;
  previewSub?: HTMLDivElement;
  // Settings-takeover navigation: header title (swaps Subtitles ↔ Settings)
  // and the "‹ Subtitles" back chip.
  titleEl?: HTMLHeadingElement;
  backBtn?: HTMLDivElement;
  // Quick-mode bar in the sub-header (icon-only Dual/Guess/On-screen; swap
  // lives on the language-pair chip). Dual/Guess share a segmented radio
  // control (quickModesSeg) whose sliding thumb tracks the selection.
  quickModesBar?: HTMLDivElement;
  quickModesSeg?: HTMLDivElement;
  qmDualBtn?: HTMLButtonElement;
  qmGuessBtn?: HTMLButtonElement;
  qmOverlayBtn?: HTMLButtonElement;
  // YouTube-only: the toggle injected into YouTube's own native player
  // control bar (.ytp-right-controls), registered via registerExternalElement
  // and kept in sync by updateControls() like every other overlay chip.
  ytpOverlayBtn?: HTMLButtonElement;
}

export interface AppInterface {
  updateHighlight(): void;
  seekVideo(time: number): void;
  getOverlayParent?(): HTMLElement | null;
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
}
