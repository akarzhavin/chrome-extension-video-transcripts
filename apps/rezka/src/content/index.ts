import {
    AppState,
    SidebarUI,
    parseVTT,
    LanguageUtils,
    AppInterface,
    installAuthStatusBadge,
    installQuickAddOverlay,
    loadLanguagePrefs,
    saveLanguagePrefs,
    onLanguagePrefsChanged,
    labelForLanguage,
    shortCodeForLanguage,
    msg as i18nMsg,
    setI18nOverride,
    OncePerScope,
    platformOf,
    type Platform,
    trackVia,
    SUPPORTED_LANGUAGES,
    LanguagePrefs,
    fetchAndRenderNotification,
} from '@video-transcripts/shared';
import { FEATURES, SUBTITLE_LANGUAGES } from '../config';

// Localized content-UI string from _locales/<lang>/messages.json. Falls back to
// the English default when a key is missing (or outside an extension context).
function t(key: string, fallback: string): string {
    return i18nMsg(key, fallback);
}

// How long to keep "Searching…" before declaring "No subtitles". Auto-search now
// reads the player's CDN data up front, so tracks usually arrive within a second
// or two — a short window means the manual how-to appears promptly when nothing
// loads. The "Search again" button re-arms this for the start-playback-then-retry
// flow.
const NO_SUBS_GRACE_MS = 3000;

class VttApp implements AppInterface {
    state: AppState;
    ui: SidebarUI;
    // False when another copy of the extension owns the sidebar on this page.
    // Public so the bootstrap can also gate page-level installers (auth badge).
    uiOwned = true;
    isTopWindow: boolean;
    detector: VttDetector;
    langPrefs: LanguagePrefs | null = null;
    noSubsTimer: number | null = null;
    // How many times the user hit "Search again" for the current no-subs banner
    // without a track loading. Once they've retried and it's still empty we offer
    // a page reload as the next fallback. Reset when a track finally loads.
    noSubsRetries: number = 0;
    // ── analytics bookkeeping ───────────────────────────────────────────────
    // One page is one title on rezka, so the one-shot scope is the page load;
    // there is no per-video reset like YouTube's.
    analyticsOnce = new OncePerScope();
    /** Debounce for subtitles_loaded, so track_count counts every track. */
    subsLoadedTimer: number | null = null;
    hadFailures: boolean = false;
    firstFailureAt: number = 0;
    lastRecoveryTrigger: 'auto_probe' | 'manual_retry' | 'late_arrival' = 'late_arrival';
    // Last reported fetch failure, so declareNoSubtitles() can say why rather
    // than blaming the video.
    lastFailure: string = '';
    lastFailureStatus?: number;

    constructor() {
        this.isTopWindow = window === window.top;
        this.state = new AppState();
        this.ui = new SidebarUI(this.state, this);
        this.detector = new VttDetector(this);

        console.log("VTT Sidebar: Running in " + (this.isTopWindow ? "top window." : "iframe."));
        // False → a #vtt-sidebar from another installed copy of the extension
        // already owns this page; keep our UI writers off it (shared ids would
        // otherwise let us graft controls into a sidebar we didn't build).
        this.uiOwned = this.ui.init();
        this.setupListeners();
        this.startVideoPolling();
        this.detector.start();
        // The onboarding picker, language-pair chip and status banners belong to
        // the visible sidebar, which only renders in the top window (iframes get
        // a hidden one). Subtitle detection still runs in every frame.
        if (this.isTopWindow && this.uiOwned) void this.initLanguagePrefs();
        // Same gate as the onboarding above: one lookup per page, from the
        // frame that actually has a visible sidebar. Rezka runs this script in
        // every iframe, so without the guard each player frame would fire its
        // own request for a banner nobody can see.
        if (this.isTopWindow && this.uiOwned) {
            void fetchAndRenderNotification(platformOf(location.hostname));
        }
    }

    startVideoPolling(): void {
        setInterval(() => {
            document.querySelectorAll('video').forEach(video => {
                if (!video.dataset.vttAttached) {
                    video.dataset.vttAttached = "true";
                    console.log("VTT Sidebar: Attached timeupdate to a video element.");

                    video.addEventListener('timeupdate', () => {
                        // Extension reloaded → stale content scripts lose runtime.id.
                        // Bail silently so we don't spam the console every tick.
                        if (!chrome?.runtime?.id) return;
                        try {
                            chrome.runtime.sendMessage({ action: "TIME_UPDATE", time: video.currentTime });
                        } catch (e: any) {
                            if (!e.message.includes("Extension context invalidated")) console.error(e);
                        }
                    });
                }
            });
        }, 1000);
    }

    setupListeners(): void {
        chrome.runtime.onMessage.addListener((request) => {
            if (request.action === "VTT_LOADED") {
                this.handleNewSubtitles(request.payload);
            } else if (request.action === "VTT_LOAD_FAILED") {
                this.handleVttLoadFailed({ status: request.status, failure: request.failure });
            } else if (request.action === "TIME_UPDATE") {
                this.ui.highlightSubtitle(request.time);
            } else if (request.action === "SEEK_VIDEO") {
                this.seekVideoLocal(request.time);
            } else if (request.action === "RESCAN") {
                // "Search again" broadcast — every frame re-scans its own tracks.
                this.detector.rescan();
            }
        });

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.shiftKey && e.code === 'KeyS') {
                if (this.state.swapTracks()) this.ui.refresh();
            }
            if (e.shiftKey && e.code === 'KeyD') this.ui.toggleDualMode();
            if (e.shiftKey && e.code === 'KeyO') this.ui.toggleOverlay();
            if (e.shiftKey && e.code === 'KeyG') this.ui.toggleGuessMode();
        });
    }

    /**
     * Reports subtitles_loaded once the tracks have stopped arriving.
     *
     * Mirrors BaseVttApp.scheduleSubtitlesLoadedReport — rezka does not extend
     * that class, so the same bug had to be fixed in both places. Each new
     * track pushes the timer out, so the count reflects everything that landed.
     * No cancellation path here: one page is one title, so there is no video
     * change that could mis-attribute a pending report.
     */
    scheduleSubtitlesLoadedReport(site: Platform, settleMs: number = 1_500): void {
        if (this.analyticsOnce.hasFired('subtitles_loaded')) return;
        if (this.subsLoadedTimer !== null) clearTimeout(this.subsLoadedTimer);
        this.subsLoadedTimer = window.setTimeout(() => {
            this.subsLoadedTimer = null;
            const count = this.state.tracks.length;
            if (count === 0) return;
            this.analyticsOnce.fire('subtitles_loaded', () => {
                trackVia('subtitles_loaded', { site, track_count: count });
            });
        }, settleMs);
    }

    handleNewSubtitles(vttText: string): void {
        const newSubs = parseVTT(vttText);
        if (newSubs.length === 0) return;

        if (!this.state.isDuplicate(newSubs)) {
            const name = LanguageUtils.generateTrackName(newSubs, this.state.tracks);
            this.state.addTrack(name, newSubs);
        }
        this.ui.refresh();

        // Everything below is top-window only. The tracks above are not: every
        // frame needs its own to render, but VTT_LOADED is broadcast to every
        // frame and each one carries a private OncePerScope, so reporting from
        // all of them multiplied each event by the frame count. The sidebar
        // notices at the end were already scoped this way.
        if (!this.isTopWindow) return;

        // One page is one title here, so the scope is the page load — there is
        // no per-video reset to hang the one-shots off, unlike YouTube.
        const site = platformOf(location.hostname);
        // Debounced for the same reason as the YouTube edition: reporting from
        // the first track freezes track_count at 1, and the second track lands
        // ~100ms later. Measured here too — every dual load was arriving as a
        // single-track one.
        this.scheduleSubtitlesLoadedReport(site);
        if (this.state.tracks.length >= 2) {
            this.analyticsOnce.fire('dual_subs_shown', () => {
                trackVia('dual_subs_shown', {
                    site,
                    learning: this.langPrefs?.learning ?? '',
                    native: this.langPrefs?.native ?? '',
                });
            });
        }
        if (this.hadFailures) {
            this.hadFailures = false;
            trackVia('subs_recovered', {
                site,
                via: this.lastRecoveryTrigger,
                waited_s: Math.round((Date.now() - this.firstFailureAt) / 1000),
            });
        }

        // Subtitles arrived — drop any pending/visible "searching"/"no subtitles"
        // notice (only the top window shows one).
        this.clearNoSubtitlesTimer();
        this.hideStatusBanner();
        this.noSubsRetries = 0;
    }

    /**
     * A subtitle fetch failed in the background worker. Before this existed the
     * status was swallowed in a console.error and the UI blamed the video for
     * what was often a rate limit — the same bug that was fixed on the YouTube
     * side. Records the reason and reports it.
     */
    handleVttLoadFailed(info: { status?: number; failure?: string }): void {
        const failure = info.failure ?? 'unknown';
        if (!this.hadFailures) {
            this.hadFailures = true;
            this.firstFailureAt = Date.now();
        }
        this.lastFailure = failure;
        this.lastFailureStatus = info.status;
        // The worker answers with chrome.tabs.sendMessage(tabId, …), which
        // reaches EVERY frame, and this script runs in all of them
        // (all_frames: true) with a private OncePerScope each. Without this
        // gate one 429 arrived as N copies of every event below. The top
        // window is the same scope the sidebar and its notices already use.
        if (!this.isTopWindow) return;
        if (failure === 'rate-limited') {
            this.analyticsOnce.fire('subs_rate_limited', () => {
                trackVia('subs_rate_limited', {
                    site: platformOf(location.hostname),
                    // Rezka serves ready-made tracks; there is no machine
                    // translation request to distinguish.
                    translation: false,
                    attempts: 0,
                    retry_after_s: 0,
                    breaker_step: 0,
                });
            });
        }
        // Something already plays and something else didn't: same partial state
        // YouTube reports, minus the learning/native split (rezka names tracks
        // by sniffing their content, so it cannot say which half is missing).
        if (this.state.tracks.length > 0) {
            this.analyticsOnce.fire('subs_partial', () => {
                trackVia('subs_partial', {
                    site: platformOf(location.hostname),
                    failure,
                    missing: 'other',
                    throttled: failure === 'rate-limited',
                    learning: this.langPrefs?.learning ?? '',
                    native: this.langPrefs?.native ?? '',
                });
            });
        }
    }

    // ── Language prefs, onboarding, chip & status (top window only) ─────────

    async initLanguagePrefs(): Promise<void> {
        // Dev only: force the content-UI locale (incl. this banner) without
        // changing the OS/browser language — install the override BEFORE anything
        // localized renders.
        await this.applyDevLocaleOverride();

        this.langPrefs = await loadLanguagePrefs();
        this.applyLangPrefsToState();
        this.updateOnboardingState();

        onLanguagePrefsChanged((prefs) => {
            this.langPrefs = prefs;
            this.applyLangPrefsToState();
            this.updateOnboardingState();
            // Re-order any already-loaded tracks to the newly chosen pair.
            this.ui.refresh();
        });
    }

    // DEV-ONLY i18n override. chrome.i18n follows the browser UI locale, which
    // can't be forced on macOS — so for verifying translations, append `&lng=ru`
    // (or `&lng=uk`) to the URL HASH, e.g. `…84221-….html#t:238-s:1-e:1&lng=ru`.
    // Use the hash, not a query: HDrezka strips `?…` query params on load but
    // keeps the hash. The background reads that locale's messages.json and we
    // install it as an override (msg() consults overrides first). Compiled out of
    // prod builds via the __EXT_ENV__ guard.
    async applyDevLocaleOverride(): Promise<void> {
        if (__EXT_ENV__ !== 'dev') return;
        const m = location.href.match(/[?#&]lng=([a-z_-]+)/i);
        if (!m) return;
        const locale = m[1];
        try {
            const res = await chrome.runtime.sendMessage({ action: 'DEV_LOAD_LOCALE', locale });
            if (res && res.ok && res.map) {
                setI18nOverride(res.map);
                const h2 = document.querySelector('#vtt-header-top h2');
                if (h2) h2.textContent = t('ytSidebarTitle', 'Subtitles');
                console.log('[dev] i18n override applied:', locale);
            } else {
                console.warn('[dev] locale load failed:', res);
            }
        } catch (e) {
            console.warn('[dev] locale override error:', e);
        }
    }

    // Drive AppState's primary/secondary selection from the chosen pair: the
    // language being learned becomes the main track, the native one the
    // secondary. Clearing prefs falls back to the legacy English/Russian
    // heuristic. Track names from generateTrackName ("English"/"Russian"/…)
    // match the English labels here, so the ordering actually takes effect.
    applyLangPrefsToState(): void {
        if (!this.langPrefs) {
            this.state.setLanguagePreferences(undefined, undefined);
            return;
        }
        this.state.setLanguagePreferences(
            labelForLanguage(this.langPrefs.learning),
            labelForLanguage(this.langPrefs.native),
        );
    }

    // HDrezka content (watch) pages end in `.html`; the homepage, catalogs and
    // search do not. Gate the sidebar prompts on this so non-watch pages keep
    // the previous behaviour (an empty sidebar) instead of showing onboarding or
    // a "No subtitles" notice where there's no player. URL-based on purpose — no
    // brittle dependency on HDrezka's player DOM selectors.
    isWatchPage(): boolean {
        try {
            return /\.html$/.test(new URL(location.href).pathname);
        } catch {
            return false;
        }
    }

    updateOnboardingState(): void {
        if (!this.uiOwned) return; // sidebar belongs to another extension copy
        if (!this.isWatchPage()) return; // not a player page → keep the sidebar quiet
        this.updateLanguagePairChip();
        if (this.langPrefs) {
            this.hideLanguageOnboarding();
            this.scheduleNoSubtitlesCheck();
        } else {
            this.clearNoSubtitlesTimer();
            this.hideStatusBanner();
            this.showLanguageOnboarding();
        }
    }

    // An "EN ⇄ RU" chip at the header's left edge (mirroring the settings gear
    // on the right) reflecting the chosen pair, so it's always clear which two
    // languages are in play.
    updateLanguagePairChip(): void {
        // Mount ONLY into our own header slot, no fallbacks: the ids are
        // shared across extension versions, so a fallback would graft the
        // chip into a sidebar built by another installed copy.
        const headerTop = document.getElementById('vtt-header-top');
        const existing = document.getElementById('vtt-langpair');
        if (!this.langPrefs) {
            existing?.remove();
            return;
        }
        const { learning, native } = this.langPrefs;
        const chip = (existing as HTMLElement) ?? document.createElement('div');
        chip.id = 'vtt-langpair';
        // Compact abbreviations (EN ⇄ RU); each language is one span so the
        // .vtt-swapped row-reverse flip reorders them cleanly. The
        // bidirectional arrow advertises that the chip itself swaps.
        chip.innerHTML =
            '<span class="vtt-langpair-inner">' +
            `<span class="vtt-langpair-lang">${shortCodeForLanguage(learning)}</span>` +
            '<span class="vtt-langpair-arrow">⇄</span>' +
            `<span class="vtt-langpair-lang">${shortCodeForLanguage(native)}</span>` +
            '</span>';
        // The chip IS the swap control: tapping the pair swaps which track is
        // primary, and .vtt-swapped (set in updateControls) flips the visual
        // order to match. Language changes live behind the settings gear.
        if (!existing) {
            const label = `${t('ytModeSwap', 'Swap')} (Shift+S)`;
            chip.setAttribute('role', 'button');
            chip.setAttribute('tabindex', '0');
            chip.setAttribute('aria-label', t('ytModeSwap', 'Swap'));
            chip.title = label;
            const swap = () => {
                if (!this.state.swapTracks()) return;
                chip.classList.remove('vtt-pulse');
                void chip.offsetWidth;
                chip.classList.add('vtt-pulse');
                this.ui.refresh();
            };
            chip.addEventListener('click', swap);
            chip.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    swap();
                }
            });
        }
        if (!existing && headerTop) headerTop.prepend(chip);
    }

    showLanguageOnboarding(): void {
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar || document.getElementById('vtt-lang-onboarding')) return;

        // After the early return: counts banners actually shown, not calls made.
        this.analyticsOnce.fire('onboarding_shown', () => {
            trackVia('onboarding_shown', { site: platformOf(location.hostname) });
        });

        const banner = document.createElement('div');
        banner.id = 'vtt-lang-onboarding';
        banner.className = 'vtt-lang-onboarding';

        const title = document.createElement('div');
        title.className = 'vtt-lang-onboarding-title';
        title.textContent = t('ytOnboardingTitle', 'Choose your languages');
        banner.appendChild(title);

        const text = document.createElement('div');
        text.className = 'vtt-lang-onboarding-text';
        text.textContent = t(
            'ytOnboardingText',
            "Pick the language you're learning and your native language to start.",
        );
        banner.appendChild(text);

        const learning = this.buildOnboardingSelect(t('ytLearningLabel', "I'm learning"));
        const native = this.buildOnboardingSelect(t('ytNativeLabel', 'My native language'));
        banner.appendChild(learning.wrap);
        banner.appendChild(native.wrap);

        const persist = () => {
            const l = learning.select.value;
            const n = native.select.value;
            if (!l || !n) return; // both required
            void saveLanguagePrefs({ learning: l, native: n }, 'onboarding');
        };
        learning.select.addEventListener('change', persist);
        native.select.addEventListener('change', persist);

        // Place it at the top of the content area (under the header) so it's the
        // first thing the user sees, not pinned to the bottom of an empty list.
        const list = document.getElementById('vtt-list');
        if (list) sidebar.insertBefore(banner, list);
        else sidebar.appendChild(banner);
    }

    buildOnboardingSelect(labelText: string): { wrap: HTMLElement; select: HTMLSelectElement } {
        const wrap = document.createElement('label');
        wrap.className = 'vtt-lang-onboarding-row';

        const span = document.createElement('span');
        span.textContent = labelText;
        wrap.appendChild(span);

        const select = document.createElement('select');
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = t('ytSelectPlaceholder', 'Select…');
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
        // Only the languages HDrezka actually ships subtitles in (see config).
        for (const code of SUBTITLE_LANGUAGES) {
            const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
            if (!lang) continue;
            const opt = document.createElement('option');
            opt.value = lang.code;
            // Endonym only (e.g. "Español", "中文") so the picker reads naturally
            // in any UI locale instead of prefixing the English language name.
            opt.textContent = lang.native;
            select.appendChild(opt);
        }
        wrap.appendChild(select);
        return { wrap, select };
    }

    hideLanguageOnboarding(): void {
        document.getElementById('vtt-lang-onboarding')?.remove();
    }

    // While waiting for subtitles we show a "Searching…" status so the sidebar is
    // never blank. If nothing arrives within the grace period it flips to "No
    // subtitles". Cleared as soon as a track loads or onboarding is showing.
    scheduleNoSubtitlesCheck(graceMs: number = NO_SUBS_GRACE_MS): void {
        this.clearNoSubtitlesTimer();
        this.hideStatusBanner();
        if (!this.langPrefs) return;
        if (this.state.tracks.length > 0) return; // already have something to show

        this.showStatusBanner(
            t('ytSearchingTitle', 'Searching for subtitles…'),
            t('ytSearchingText', 'Looking for subtitles for this video.'),
        );

        this.noSubsTimer = window.setTimeout(() => {
            this.noSubsTimer = null;
            if (!this.langPrefs) return;
            if (this.state.tracks.length === 0) this.declareNoSubtitles();
        }, graceMs);
    }

    declareNoSubtitles(): void {
        this.clearNoSubtitlesTimer();
        if (!this.langPrefs) return;
        if (this.state.tracks.length > 0) return;

        // On rezka the player only fetches a track once it's picked in the CC
        // menu, so "nothing reported a failure" means the user hasn't picked
        // one yet — 'not-selected', an expected absence, not an error. Never
        // the empty string: GA4 keeps '' as an undiagnosable bucket.
        this.analyticsOnce.fire('no_subtitles', () => {
            trackVia('no_subtitles', {
                site: platformOf(location.hostname),
                retried: this.noSubsRetries > 0,
                failure: this.lastFailure || 'not-selected',
                status: this.lastFailureStatus ?? 0,
                attempts: 0,
                learning: this.langPrefs?.learning ?? '',
                native: this.langPrefs?.native ?? '',
            });
        });
        // Auto-search came up empty. The player only fetches a track when it's
        // picked in the CC menu, so walk the user through loading them by hand —
        // the (always-on) interceptor grabs each one as it's selected.
        // The manual how-to (illustration + steps) is the primary recovery path
        // and stays in every failure state. After a failed "Search again" the
        // banner additionally grows a quiet, red "Reload page" emergency button —
        // a last-resort escape hatch, deliberately NOT styled as a feature. The
        // body text switches to acknowledge the failed retry and point at it.
        const retried = this.noSubsRetries > 0;
        const actions: Array<{ label: string; onClick: () => void; emergency?: boolean }> = [
            {
                label: '↻ ' + t('ytSearchAgain', 'Search again'),
                onClick: () => this.searchAgain(),
            },
        ];
        if (retried) {
            actions.push({
                label: '⟳ ' + t('ytReloadPage', 'Reload page'),
                onClick: () => void this.reportNoSubsAndReload(),
                emergency: true,
            });
        }
        this.showStatusBanner(
            t('ytNoSubsTitle', "Subtitles didn't load"),
            retried
                ? t(
                      'ytNoSubsRetryText',
                      "Still no subtitles. If loading them by hand doesn't help, reload the page.",
                  )
                : t('ytNoSubsText', 'If this title has subtitles, load them by hand:'),
            actions,
            [
                t('ytNoSubsStep1', 'Open the subtitles menu (CC) in the player.'),
                t('ytNoSubsStep2', 'Click each language once — they load here.'),
                t('ytNoSubsStep3', 'Then set the player subtitles back to Off.'),
            ],
            this.buildNoSubsIllustration(),
        );
    }

    // A small, self-contained SVG mock of HDrezka's player subtitle menu (no real
    // video frames): the CC menu with each language highlighted in turn by a
    // sweeping cursor, and a glowing "CC" button on the player bar below — so it's
    // visually obvious where to click. Brand-colored (violet → cyan).
    buildNoSubsIllustration(): string {
        return `
<svg viewBox="0 0 240 212" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Player subtitle menu">
  <defs>
    <linearGradient id="vtt-il-hi" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5aff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="vtt-il-panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2f3a"/><stop offset="1" stop-color="#1a1e26"/>
    </linearGradient>
    <linearGradient id="vtt-il-btn" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7c5aff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect x="8" y="6" width="224" height="150" rx="12" fill="url(#vtt-il-panel)" stroke="rgba(255,255,255,0.10)"/>
  <text x="22" y="30" fill="#ffffff" font-family="Inter, sans-serif" font-size="14" font-weight="600">Субтитры</text>
  <circle cx="212" cy="25" r="5" fill="none" stroke="#8a93a3" stroke-width="1.5"/>
  <circle cx="212" cy="25" r="1.5" fill="#8a93a3"/>
  <line x1="16" y1="42" x2="224" y2="42" stroke="rgba(255,255,255,0.10)"/>
  <rect x="14" y="50" width="184" height="24" rx="7" fill="url(#vtt-il-hi)" opacity="0.30">
    <animate attributeName="y" values="50;50;76;76;102;102;50" dur="3.6s" repeatCount="indefinite"/>
  </rect>
  <text x="26" y="66" fill="#ffffff" font-family="Inter, sans-serif" font-size="13">Русский</text>
  <text x="26" y="92" fill="#e6e8ee" font-family="Inter, sans-serif" font-size="13">Українська</text>
  <text x="26" y="118" fill="#e6e8ee" font-family="Inter, sans-serif" font-size="13">English</text>
  <text x="26" y="144" fill="#4da3ff" font-family="Inter, sans-serif" font-size="13">откл.</text>
  <circle cx="214" cy="140" r="4" fill="#4da3ff"/>
  <path d="M0 0 L0 16 L4.5 11.5 L8 19 L11 17.5 L7.5 10.5 L13.5 10.5 Z" fill="#ffffff" stroke="#0b0e14" stroke-width="1">
    <animateTransform attributeName="transform" type="translate"
      values="170 54;170 54;170 80;170 80;170 106;170 106;170 54" dur="3.6s" repeatCount="indefinite"/>
  </path>
  <rect x="8" y="168" width="224" height="36" rx="10" fill="#11151c" stroke="rgba(255,255,255,0.08)"/>
  <path d="M20 180 L20 192 L30 186 Z" fill="#8a93a3"/>
  <text x="38" y="190" fill="#8a93a3" font-family="Inter, sans-serif" font-size="10">00:12 / 27:40</text>
  <rect x="150" y="177" width="30" height="18" rx="5" fill="url(#vtt-il-btn)">
    <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite"/>
  </rect>
  <text x="165" y="190" fill="#06121b" font-family="Inter, sans-serif" font-size="11" font-weight="700" text-anchor="middle">CC</text>
  <g stroke="#8a93a3" stroke-width="1.6" fill="none">
    <path d="M196 180 h6 M196 180 v6"/><path d="M218 180 h-6 M218 180 v6"/>
    <path d="M196 192 h6 M196 192 v-6"/><path d="M218 192 h-6 M218 192 v-6"/>
  </g>
</svg>`;
    }

    // Re-arm "Searching…" and ask every frame's detector to re-scan. The player's
    // subtitle requests are also caught passively, so a fresh grace window is
    // usually enough once playback has started.
    // Emergency "Reload page" handler. The banner copy qualifies the click
    // ("this video HAS subtitles but we aren't showing them"), so it doubles as
    // a bug report: fire a best-effort diagnostic to the background worker, then
    // reload no matter what. The 400ms race caps how long a slow/dead worker can
    // delay the reload the user actually asked for.
    async reportNoSubsAndReload(): Promise<void> {
        try {
            if (chrome?.runtime?.id) {
                await Promise.race([
                    chrome.runtime
                        .sendMessage({
                            action: 'REPORT_NO_SUBS',
                            site: location.hostname,
                            videoRef: location.href,
                            version: chrome.runtime.getManifest().version,
                            locale: chrome.i18n.getUILanguage(),
                            // The chosen pair tells triage which subtitle
                            // languages failed to materialize. Always set:
                            // the no-subs banner only renders with prefs.
                            learning: this.langPrefs?.learning ?? '',
                            native: this.langPrefs?.native ?? '',
                        })
                        .catch(() => undefined),
                    new Promise((resolve) => setTimeout(resolve, 400)),
                ]);
            }
        } catch {
            // Extension context invalidated — the reload below fixes that too.
        }
        location.reload();
    }

    searchAgain(): void {
        // Remember the retry so the next empty result can escalate to a reload
        // prompt rather than looping on "Search again".
        this.noSubsRetries++;
        this.detector.rescan();
        try {
            if (chrome?.runtime?.id) chrome.runtime.sendMessage({ action: 'RESCAN' });
        } catch {
            // Extension context invalidated — ignore.
        }
        this.scheduleNoSubtitlesCheck();
    }

    clearNoSubtitlesTimer(): void {
        if (this.noSubsTimer !== null) {
            clearTimeout(this.noSubsTimer);
            this.noSubsTimer = null;
        }
    }

    showStatusBanner(
        titleText: string,
        bodyText: string,
        action?:
            | { label: string; onClick: () => void; emergency?: boolean }
            | Array<{ label: string; onClick: () => void; emergency?: boolean }>,
        steps?: string[],
        illustration?: string,
    ): void {
        if (document.getElementById('vtt-lang-onboarding')) return; // onboarding wins
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar) return;

        let banner = document.getElementById('vtt-status');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'vtt-status';
            banner.className = 'vtt-empty-state';
            const title = document.createElement('div');
            title.className = 'vtt-empty-state-title';
            const text = document.createElement('div');
            text.className = 'vtt-empty-state-text';
            banner.appendChild(title);
            banner.appendChild(text);
            const list = document.getElementById('vtt-list');
            if (list) sidebar.insertBefore(banner, list);
            else sidebar.appendChild(banner);
        }
        const textEl = banner.querySelector('.vtt-empty-state-text') as HTMLElement;
        (banner.querySelector('.vtt-empty-state-title') as HTMLElement).textContent = titleText;
        textEl.textContent = bodyText;

        // Rich variant (with illustration) gets the colorful treatment; the plain
        // "Searching…" banner reuses the same element, so rebuild/clear each call.
        banner.classList.toggle('vtt-status--rich', !!illustration);
        banner.querySelector('.vtt-empty-state-figure')?.remove();
        if (illustration) {
            const fig = document.createElement('div');
            fig.className = 'vtt-empty-state-figure';
            fig.innerHTML = illustration; // trusted static SVG, no user input
            textEl.insertAdjacentElement('afterend', fig);
        }

        // Rebuild the steps list each call so the "Searching…" banner (no steps)
        // and the "No subtitles" banner (with the manual how-to) can reuse the
        // same element without leftovers.
        banner.querySelector('.vtt-empty-state-steps')?.remove();
        if (steps && steps.length) {
            const ol = document.createElement('ol');
            ol.className = 'vtt-empty-state-steps';
            for (const step of steps) {
                const li = document.createElement('li');
                li.textContent = step;
                ol.appendChild(li);
            }
            // Place after the illustration when present, else right after the text.
            const anchor = (banner.querySelector('.vtt-empty-state-figure') as HTMLElement) ?? textEl;
            anchor.insertAdjacentElement('afterend', ol);
        }

        // Rebuild the action button(s) each call so stale labels/handlers don't
        // linger (e.g. the "Searching…" banner reuses this element with none).
        banner.querySelector('.vtt-empty-state-actions')?.remove();
        banner.querySelector('.vtt-empty-state-action')?.remove();
        const actions = action ? (Array.isArray(action) ? action : [action]) : [];
        if (actions.length) {
            const row = document.createElement('div');
            row.className = 'vtt-empty-state-actions';
            for (const a of actions) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = a.emergency
                    ? 'vtt-empty-state-action vtt-empty-state-action--emergency'
                    : 'vtt-empty-state-action';
                btn.textContent = a.label;
                btn.addEventListener('click', a.onClick);
                row.appendChild(btn);
            }
            banner.appendChild(row);
        }
    }

    hideStatusBanner(): void {
        document.getElementById('vtt-status')?.remove();
    }

    seekVideo(time: number): void {
        if (chrome?.runtime?.id) {
            try {
                chrome.runtime.sendMessage({ action: "SEEK_VIDEO", time });
            } catch (e: any) {
                if (!e.message.includes("Extension context invalidated")) console.error(e);
            }
        }
        this.seekVideoLocal(time);
    }

    seekVideoLocal(time: number): void {
        document.querySelectorAll('video').forEach(video => {
            video.currentTime = time;
            video.play().catch(() => {});
        });
    }

    updateHighlight(): void {
        const video = document.querySelector('video');
        if (video) this.ui.highlightSubtitle(video.currentTime);
    }
}

class VttDetector {
    app: VttApp;
    processedUrls: Set<string> = new Set();

    constructor(app: VttApp) {
        this.app = app;
    }

    // Absolute .vtt URLs in a blob of text. HDrezka escapes JSON slashes (\/),
    // so scanText normalizes before matching.
    static VTT_RE = /https?:\/\/[^\s"'<>,\]\\]+\.vtt[^\s"'<>,\]\\]*/g;

    start(): void {
        this.observeDOM();
        this.pollVideoTracks();
        this.interceptNetwork();
        // Auto-search: proactively pull the full track list from the inline
        // player config. Off → subtitles load only when manually selected.
        if (FEATURES.autoSubtitleSearch) this.scanInlineSubtitles();
    }

    // Movies embed the player's full subtitle track list (every language's .vtt
    // URL) in an inline config script, so we can load them all up front instead
    // of waiting for the user to pick each one in the CC menu. Series/translation
    // switches arrive via AJAX and are caught by the network interceptor. Re-scan
    // a few times because the player config can run slightly after document_idle.
    scanInlineSubtitles(): void {
        const scan = () => this.scanText(document.documentElement.outerHTML);
        scan();
        setTimeout(scan, 1500);
        setTimeout(scan, 4000);
    }

    scanText(text: string): void {
        if (!text || text.indexOf('.vtt') === -1) return;
        const normalized = text.replace(/\\\//g, '/');
        VttDetector.VTT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = VttDetector.VTT_RE.exec(normalized)) !== null) {
            this.loadVtt(m[0]);
        }
    }

    observeDOM(): void {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node instanceof HTMLTrackElement) {
                        this.handleTrackElement(node);
                    } else if (node instanceof HTMLElement) {
                        node.querySelectorAll('track').forEach(track => this.handleTrackElement(track));
                    }
                });
            });
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    pollVideoTracks(): void {
        setInterval(() => {
            document.querySelectorAll('video').forEach(video => {
                for (let i = 0; i < video.textTracks.length; i++) {
                    const track = video.textTracks[i];
                    // We can't always get the URL from textTrack, but we can sometimes find the <track> element
                }
            });
        }, 2000);
    }

    // Re-scan the current document for subtitle <track> elements, re-fetching
    // each. Used by "Search again": clears the processed set so tracks whose
    // initial fetch was missed (or failed) get another attempt. Re-fetching a
    // track already loaded is harmless — AppState dedupes by content.
    rescan(): void {
        this.processedUrls.clear();
        document.querySelectorAll('track').forEach(track => this.handleTrackElement(track as HTMLTrackElement));
        if (FEATURES.autoSubtitleSearch) this.scanText(document.documentElement.outerHTML);
    }

    handleTrackElement(track: HTMLTrackElement): void {
        const url = track.src;
        if (url && url.includes('.vtt') && !this.processedUrls.has(url)) {
            console.log("VTT Detector: Found track element:", url);
            this.loadVtt(url);
        }
    }

    async loadVtt(url: string): Promise<void> {
        if (this.processedUrls.has(url)) return;
        this.processedUrls.add(url);

        console.log("VttDetector: Requesting VTT fetch via background:", url);

        try {
            // We send the request to the background because it has host_permissions for voidboost
            // and is not subject to the CORS restrictions that affect the content script.
            chrome.runtime.sendMessage({
                action: "FETCH_VTT",
                url: url
            });
        } catch (err) {
            console.error("VttDetector: Failed to send FETCH_VTT message:", err);
            this.processedUrls.delete(url); // Allow retry
        }
    }

    interceptNetwork(): void {
        // The interceptor runs at document_start in the page's MAIN world (declared
        // in the manifest), so it wraps fetch/XHR before HDrezka requests the
        // player data — which carries the subtitle list and fires before this
        // isolated-world script exists. We listen for what it finds, then signal
        // readiness so it flushes anything detected before we started listening.
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data && event.data.type === 'VTT_URL_DETECTED') {
                this.loadVtt(event.data.url);
            }
        });
        window.postMessage({ type: 'VTT_SINK_READY' }, '*');
    }
}

function bootstrap(): void {
    let isRezka = false;
    const isTopWindow = window === window.top;

    // The manifest matches <all_urls> so we catch every rezka/hdrezka mirror
    // (rotating hash hosts, standby-*, arbitrary TLDs) without maintaining a
    // domain list. Any host containing "rezka" — which also covers "hdrezka" —
    // qualifies; everything else bails out here.
    if (isTopWindow) {
        if (window.location.hostname.includes('rezka')) {
            isRezka = true;
        }
    } else {
        if (window.location.ancestorOrigins) {
            for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
                if (window.location.ancestorOrigins[i].includes('rezka')) {
                    isRezka = true;
                    break;
                }
            }
        }
    }

    if (!isRezka) return;
    const app = new VttApp();
    installQuickAddOverlay();
    // The badge self-attaches to any #vtt-header-top (with an observer retry),
    // so gate it on owning the sidebar — otherwise it grafts into a sidebar
    // built by another installed copy of the extension.
    if (window === window.top && app.uiOwned) installAuthStatusBadge();
}

bootstrap();
