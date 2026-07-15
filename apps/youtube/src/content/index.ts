import {
    installAuthStatusBadge,
    installQuickAddOverlay,
    labelForLanguage,
    markSpansSaved,
    refreshAuthStatusBadge,
    msg as i18nMsg,
    setI18nOverride,
    Subtitle,
} from '@video-transcripts/shared';
import { BaseVttApp, SIDEBAR_CHROME_CSS } from './app-base';
import { parseJson3 } from './json3';
import { CaptionTrack, TrackRequest, planTrackRequests } from './trackPlan';
import { demoLinesFor, baseLangCode } from './demo-subs';
import { DEMO_UI_BY_LANG } from './demo-ui';
import { bootstrapNetflix } from './netflix/app';
import { watchControlsFloor } from './controlsFloor';
import { installPlayerMenu } from './player-menu';

// Localized UI string from _locales/<lang>/messages.json. Falls back to the
// English default when the message isn't registered (non-extension contexts,
// or a key missing from a locale) so the sidebar never shows a blank label.
function t(key: string, fallback: string): string {
    // Delegates to the shared helper, which honors the demo override (installed
    // below), then chrome.i18n, then the fallback.
    return i18nMsg(key, fallback);
}

// ── Promo demo mode ──────────────────────────────────────────────────────
// Loading any watch page with `#vtt-demo` in the URL fills the sidebar with
// canned dual subtitles (no network, so it can't be throttled) and spotlights
// the panel against a dimmed page — purely for capturing store screenshots.
// It is inert for real users: nothing triggers it without the literal token.
const DEMO_MODE = location.href.includes('vtt-demo');
// RTL store locales. YouTube's RTL layout pushes the player to the right, under
// our fixed sidebar — so in demo mode we force the PAGE to LTR (video stays left,
// matching every other locale and keeping the on-video overlay visible) while
// the sidebar itself is set RTL so its own content reads right-to-left.
const DEMO_RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);

// Parse the demo state from the current hash. Re-read on every hashchange so the
// capture tool can switch mode/pair WITHOUT reloading YouTube — it just rewrites
// location.hash (e.g. `#vtt-demo-guess?learn=fr&native=de`) and the content
// script re-renders the panel in place.
function parseDemoState(): { mode: 'onboarding' | 'guess' | 'sidebar'; learn: string; native: string } {
    const h = location.hash;
    const code = (param: string, fb: string): string => {
        const m = h.match(new RegExp('[?&]' + param + '=([A-Za-z_]+)'));
        return m ? m[1] : fb;
    };
    const mode = h.includes('vtt-demo-onboarding') ? 'onboarding'
        : h.includes('vtt-demo-guess') ? 'guess' : 'sidebar';
    return { mode, learn: code('learn', 'es'), native: code('native', 'en') };
}

// Localized extension-UI strings for the native (store) locale, base-code fallback.
function demoUiFor(native: string): Record<string, string> | null {
    return DEMO_UI_BY_LANG[native] || DEMO_UI_BY_LANG[baseLangCode(native)] || null;
}

// Install the override before any UI is built (SidebarUI/auth-badge render during
// construction), so the whole sidebar chrome localizes in screenshots.
if (DEMO_MODE) {
    const ui0 = demoUiFor(parseDemoState().native);
    if (ui0) setI18nOverride(ui0);
}

class YouTubeVttApp extends BaseVttApp {
    detector: YouTubeCaptionDetector;
    demoGen = 0;   // bumped on each demo state apply; stale timeouts bail out

    constructor() {
        super();
        this.detector = new YouTubeCaptionDetector(this);

        console.log('[YT-VTT] content script running');
        this.init();
        if (DEMO_MODE) {
            this.startDemoMode();
            return;
        }
        this.startVideoPolling();
        this.startSite();
        void this.initLanguagePrefs();
    }

    // ── site hooks ──────────────────────────────────────────────────────────
    getVideoId(): string | null {
        return this.detector.getVideoIdFromUrl();
    }

    reprocessCurrentVideo(): void {
        this.detector.reprocessCurrentVideo();
    }

    getOverlayParent(): HTMLElement | null {
        return document.querySelector('#movie_player') as HTMLElement | null
            ?? document.querySelector('video')?.parentElement
            ?? null;
    }

    isAdPlaying(): boolean {
        const player = document.querySelector('#movie_player, .html5-video-player');
        return !!player && player.classList.contains('ad-showing');
    }

    setNativeSubtitlesEnabled(enabled: boolean): void {
        // Turn YouTube's own captions off (once per video, driven by SidebarUI)
        // so they don't stack behind our overlay. Handled in the MAIN world by
        // the page-script, which clicks the CC control only if captions are on.
        window.postMessage({ type: 'YT_SET_NATIVE_SUBS', enabled }, '*');
    }

    seekVideo(time: number): void {
        const video = document.querySelector('video');
        if (video) {
            video.currentTime = time;
            video.play().catch(() => {});
        }
    }

    startSite(): void {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data?.type === 'YT_VTT_RESULT') {
                this.handleVttLoaded(event.data.url, event.data.text || '');
            }
        });
        this.detector.start();
    }

    // ── YouTube caption fetch protocol ──────────────────────────────────────
    requestVtt(req: TrackRequest, videoId: string): void {
        this.pendingRequests.set(req.key, req.name);
        console.log('[YT-VTT] FETCH_VTT ->', req.name);
        window.postMessage(
            { type: 'YT_FETCH_VTT', url: req.key, baseUrl: req.baseUrl, videoId, tlang: req.tlang },
            '*',
        );
    }

    handleVttLoaded(url: string, vttText: string): void {
        const name = this.takePending(url);
        console.log('[YT-VTT] VTT_LOADED <-', name, 'bytes:', vttText?.length ?? 0);
        if (!name) return;
        const subs = parseJson3(vttText);
        console.log('[YT-VTT] parsed subs:', subs.length, 'for', name);
        this.addParsedTrack(name, subs);
    }

    // ── Promo demo mode ─────────────────────────────────────────────────────
    // Spotlights the panel (no network → can't be throttled). The state (picker /
    // dual subs / guess + language pair) is driven by the URL hash and re-applied
    // on hashchange, so the capture tool switches states instantly without
    // reloading the page.
    startDemoMode(): void {
        this.injectPromoStyles();
        document.body.classList.add('vtt-promo');
        this.scheduleDemoNoiseCover();          // hide YouTube noise behind skeletons
        this.applyDemoState();
        window.addEventListener('hashchange', () => this.applyDemoState());
        // Channel for the capture tool to switch state WITHOUT touching the URL
        // (a location.hash change makes YouTube's SPA reset the player to a black
        // 0:00 frame). postMessage crosses the page↔content-script world boundary,
        // unlike a window property, which lives only in this isolated world.
        window.addEventListener('message', (ev) => {
            if (ev.source !== window) return;
            const d = ev.data as { __lingogram?: string; state?: { mode: 'onboarding' | 'guess' | 'sidebar'; learn: string; native: string } };
            if (d && d.__lingogram === 'demo' && d.state) this.applyDemoState(d.state);
        });
    }

    applyDemoState(override?: { mode: 'onboarding' | 'guess' | 'sidebar'; learn: string; native: string }): void {
        const gen = ++this.demoGen;             // stale deferred callbacks bail out
        const { mode, learn, native } = override ?? parseDemoState();
        // Let the (shared) auth badge know the demo mode without reading the URL.
        (window as unknown as { __vttDemo?: { onboarding: boolean } }).__vttDemo = { onboarding: mode === 'onboarding' };

        // Keep YouTube laid out LTR (player on the left, clear of the sidebar) but
        // render the sidebar's own content RTL for right-to-left store locales.
        const isRTL = DEMO_RTL.has(baseLangCode(native));
        document.documentElement.setAttribute('dir', 'ltr');
        document.body.setAttribute('dir', 'ltr');          // body dir drives YT's layout
        document.getElementById('vtt-sidebar')?.setAttribute('dir', isRTL ? 'rtl' : 'ltr');

        // Re-localize the sidebar chrome for the (possibly changed) native locale.
        setI18nOverride(demoUiFor(native));
        const h2 = document.querySelector('#vtt-header-top h2');
        if (h2) h2.textContent = t('ytSidebarTitle', 'Subtitles');
        refreshAuthStatusBadge();               // sign-in prompt vs. chip, by hash

        // Reset to a clean slate, then build the requested state.
        this.state.reset();
        document.getElementById('vtt-video-overlay')?.remove();
        this.hideStatusBanner();

        if (mode === 'onboarding') {
            this.langPrefs = null;
            document.getElementById('vtt-langpair')?.remove();
            this.hideLanguageOnboarding();
            this.ui.refresh();                  // clear the subtitle list
            this.showLanguageOnboarding();
            // Pre-select a pair so the picker reads as a real setup (programmatic
            // .value doesn't fire 'change', so nothing persists).
            const onboarding = document.getElementById('vtt-lang-onboarding');
            const selects = onboarding?.querySelectorAll('select');
            if (selects && selects.length >= 2) {
                (selects[0] as HTMLSelectElement).value = baseLangCode(learn);
                (selects[1] as HTMLSelectElement).value = baseLangCode(native);
            }
            return;
        }

        // Chip/prefs use base codes (flag/endonym lookups strip region anyway).
        const learnBase = baseLangCode(learn);
        const nativeBase = baseLangCode(native);
        const learnLabel = labelForLanguage(learnBase);
        const nativeLabel = labelForLanguage(nativeBase);
        // Full codes for the chip (the abbreviation strips the region itself);
        // track labels stay base so AppState name-matching is unaffected.
        this.langPrefs = { learning: learn, native: native };
        this.state.setLanguagePreferences(learnLabel, nativeLabel);

        const learnLines = demoLinesFor(learn);
        const nativeLines = demoLinesFor(native);
        const learning: Subtitle[] = [];
        const nativeSubs: Subtitle[] = [];
        for (let i = 0; i < learnLines.length; i++) {
            const startTime = i * 3;
            const endTime = startTime + 2.8;
            learning.push({ startTime, endTime, text: learnLines[i] });
            nativeSubs.push({ startTime, endTime, text: nativeLines[i] ?? learnLines[i] });
        }
        this.state.addTrack(learnLabel, learning);
        this.state.addTrack(nativeLabel, nativeSubs);

        this.hideLanguageOnboarding();
        this.updateLanguagePairChip();          // real chip

        if (mode === 'guess') {
            // Guess mode: words masked, revealed progressively. Stagger the reveal
            // counts so it reads as an in-progress recall exercise (top line solved
            // → shows its translation).
            this.state.guessState.set(0, 99);   // fully revealed
            this.state.guessState.set(1, 3);
            this.state.guessState.set(2, 2);
            this.state.guessState.set(3, 1);
            // Re-assert across ticks: SidebarUI.hydrateFromPrefs() async-loads the
            // stored displayMode and would otherwise revert us to 'dual'.
            const applyGuess = () => {
                if (gen !== this.demoGen) return;
                this.state.displayMode = 'guess';
                this.ui.refresh();
                const items = document.querySelectorAll('#vtt-list .vtt-item');
                if (!items.length) return;
                items.forEach((it) => it.classList.remove('active-sub'));
                items[1]?.classList.add('active-sub');
                this.state.currentIndex = 1;
            };
            applyGuess();
            requestAnimationFrame(applyGuess);
            setTimeout(applyGuess, 200);
            setTimeout(applyGuess, 600);
            setTimeout(applyGuess, 1400);
            return;
        }

        this.state.displayMode = 'dual';
        this.ui.refresh();

        // Mark an upper line "active" so the panel shows the live sync highlight,
        // without scrolling the list. Also tag a word as "saved" — via the SAME
        // helper the real save flow uses — to showcase the vocabulary feature.
        const activeIndex = 1;
        const decorate = () => {
            if (gen !== this.demoGen) return;
            const items = document.querySelectorAll('#vtt-list .vtt-item');
            if (!items.length) return;
            items.forEach((it) => it.classList.remove('active-sub'));
            items[activeIndex]?.classList.add('active-sub');
            this.state.currentIndex = activeIndex;
            const line = document.querySelector(`#vtt-list .vtt-item[data-index="${activeIndex}"] .vtt-main-text`);
            // Pick a representative word generically (longest token) so the
            // "saved word" highlight works for any learning language, not just
            // Spanish. CJK lines may be a single span — that's fine.
            const spans = line ? Array.from(line.querySelectorAll('span')) : [];
            const word = spans
                .filter((s) => (s.textContent || '').trim().length > 1)
                .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
            // Clear any prior marker first so repeated decorate runs (and mode
            // switches) never stack duplicate "saved" badges.
            document.querySelectorAll('#vtt-list .vtt-saved-badge').forEach((b) => b.remove());
            document.querySelectorAll('#vtt-list .vtt-saved-word').forEach((s) => s.classList.remove('vtt-saved-word'));
            if (word) markSpansSaved([word as HTMLElement]);
            // Show the dual-subtitle overlay on the video for the same line.
            this.ui.updateOverlay(activeIndex);
        };
        decorate();
        requestAnimationFrame(decorate);
        setTimeout(decorate, 400);
        setTimeout(decorate, 1200);
    }

    injectPromoStyles(): void {
        const style = document.createElement('style');
        style.id = 'vtt-promo-style';
        style.textContent = `
            /* Hide YouTube's region superscript next to the logo (e.g. a stray
               "PL") — it's locale noise that contradicts the screenshot locale. */
            #country-code { display: none !important; }
            /* Hide YouTube's player chrome so the video reads as a clean backdrop
               for the dual-subtitle overlay — no control bar/timer, watermark,
               gradients, info button, or end cards. */
            .vtt-promo .ytp-chrome-bottom,
            .vtt-promo .ytp-chrome-top,
            .vtt-promo .ytp-gradient-bottom,
            .vtt-promo .ytp-gradient-top,
            .vtt-promo .ytp-watermark,
            .vtt-promo .ytp-ce-element,
            .vtt-promo .ytp-cards-teaser,
            .vtt-promo .ytp-paid-content-overlay,
            .vtt-promo .ytp-pause-overlay,
            .vtt-promo .annotation { display: none !important; }
            /* Spotlight: gently dim the page toward the left and pool a warm glow
               behind the sidebar (which sits at the max z-index) so the panel pops
               while the colourful video still reads. */
            body.vtt-promo::before {
                content: '';
                position: fixed;
                inset: 0;
                background:
                    /* warm pool of light behind the sidebar */
                    radial-gradient(58% 78% at 100% 45%, rgba(130,95,255,0.26), transparent 70%),
                    /* cinematic vignette: darker corners for depth */
                    radial-gradient(120% 130% at 38% 45%, transparent 52%, rgba(4,4,12,0.5) 100%),
                    /* base dim, lifting toward the panel */
                    linear-gradient(90deg, rgba(8,8,20,0.40) 0%, rgba(8,8,20,0.18) 64%, rgba(40,30,90,0.05) 100%);
                -webkit-backdrop-filter: saturate(0.96);
                backdrop-filter: saturate(0.96);
                z-index: 2147483646;
                pointer-events: none;
            }
            body.vtt-promo #vtt-sidebar {
                box-shadow:
                    -38px 0 150px rgba(130,95,255,0.7),
                    -8px 0 40px rgba(130,95,255,0.4),
                    0 0 0 1px rgba(160,140,255,0.5),
                    inset 0 0 0 1px rgba(255,255,255,0.07);
            }
            body.vtt-promo #vtt-sidebar .vtt-item.active-sub {
                box-shadow: 0 6px 22px rgba(0,0,0,0.35), 0 0 0 1px rgba(77,163,255,0.35);
            }
            /* Skeleton placeholders that cover YouTube's noisy regions (related
               videos, title/description/comments) — the masthead and the colourful
               player stay visible. */
            #vtt-demo-noise { position: fixed; inset: 0; z-index: 2147483640; pointer-events: none; }
            #vtt-demo-noise .sk-col, #vtt-demo-noise .sk-below {
                position: fixed; background: #ffffff; overflow: hidden; padding: 0 8px;
            }
            #vtt-demo-noise .sk-card { display: flex; gap: 12px; margin-bottom: 14px; }
            #vtt-demo-noise .sk-thumb { width: 168px; height: 94px; border-radius: 12px; background: #e9ebf1; flex: none; }
            #vtt-demo-noise .sk-lines { flex: 1; padding-top: 4px; min-width: 0; }
            #vtt-demo-noise .sk-bar { height: 11px; border-radius: 6px; background: #e9ebf1; margin-bottom: 9px; }
            #vtt-demo-noise .sk-title { height: 24px; width: 72%; border-radius: 7px; background: #e9ebf1; margin: 6px 0 20px; }
            #vtt-demo-noise .sk-row { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
            #vtt-demo-noise .sk-avatar { width: 42px; height: 42px; border-radius: 50%; background: #e9ebf1; flex: none; }
            #vtt-demo-noise .sk-actions { display: flex; gap: 8px; margin-left: auto; }
            #vtt-demo-noise .sk-pill { height: 36px; border-radius: 999px; background: #eef0f5; }
            #vtt-demo-noise .sk-desc { background: #f4f5f8; border-radius: 12px; padding: 16px; }
            #vtt-demo-noise .sk-desc .sk-bar { background: #e3e5ec; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    private skel(cls: string): HTMLDivElement {
        const d = document.createElement('div');
        d.className = cls;
        return d;
    }

    // Rebuild the skeleton cover, anchored to YouTube's real containers so it
    // covers exactly the noisy regions: #secondary (related videos) and #below
    // (title / description / comments). The masthead + player stay visible.
    // Re-run as the page settles.
    buildDemoNoiseCover(): void {
        document.documentElement.setAttribute('dir', 'ltr');   // hold LTR vs late YouTube re-apply
        document.body.setAttribute('dir', 'ltr');
        const sidebar = document.getElementById('vtt-sidebar');
        const secondary = document.querySelector('#secondary') as HTMLElement | null;
        const below = (document.querySelector('#below') ?? document.querySelector('#meta')) as HTMLElement | null;
        const player = document.querySelector('#movie_player') as HTMLElement | null;
        if (!sidebar) return;
        const sr = sidebar.getBoundingClientRect();
        const playerB = player ? player.getBoundingClientRect().bottom : 0;
        const winH = window.innerHeight;

        document.getElementById('vtt-demo-noise')?.remove();
        const layer = document.createElement('div');
        layer.id = 'vtt-demo-noise';

        // Related videos → skeleton card column. Starts just inside the column
        // gutter (8px left of the container) and reaches under the sidebar.
        if (secondary) {
            const r = secondary.getBoundingClientRect();
            if (r.width > 120 && r.height > 80) {
                const left = Math.round(r.left - 8);
                const col = this.skel('sk-col');
                col.style.left = `${left}px`;
                col.style.top = `${Math.round(r.top)}px`;
                // When the related column sits just left of the sidebar (LTR),
                // reach under the sidebar (it paints on top) so no edge peeks. In
                // RTL the recs are on the far side with the player between them and
                // the sidebar — extending there would blanket the video, so cover
                // just the container instead.
                const gap = sr.left - r.right;
                const rightEdge = (gap >= 0 && gap < 80) ? (sr.left + 24) : (r.right + 8);
                col.style.width = `${Math.round(rightEdge - left)}px`;
                col.style.height = `${Math.round(winH - r.top)}px`;
                for (let i = 0; i < 7; i++) {
                    const card = this.skel('sk-card');
                    card.appendChild(this.skel('sk-thumb'));
                    const lines = this.skel('sk-lines');
                    ['92%', '58%', '40%'].forEach((w) => {
                        const b = this.skel('sk-bar');
                        b.style.width = w;
                        lines.appendChild(b);
                    });
                    card.appendChild(lines);
                    col.appendChild(card);
                }
                layer.appendChild(col);
            }
        }

        // Title / channel / description / comments → skeleton block. Right edge
        // stays at the container's right (never crosses into the column gutter),
        // top clamps just below the player so it never covers it.
        if (below) {
            const r = below.getBoundingClientRect();
            if (r.width > 120 && r.height > 40) {
                const left = Math.round(r.left - 8);
                const top = Math.round(Math.max(r.top - 8, playerB + 2));
                const block = this.skel('sk-below');
                block.style.left = `${left}px`;
                block.style.top = `${top}px`;
                block.style.width = `${Math.round(r.right - left)}px`;
                block.style.height = `${Math.round(winH - top)}px`;
                block.appendChild(this.skel('sk-title'));
                const row = this.skel('sk-row');
                row.appendChild(this.skel('sk-avatar'));
                const name = this.skel('sk-lines');
                ['170px', '96px'].forEach((w) => {
                    const b = this.skel('sk-bar');
                    b.style.width = w;
                    name.appendChild(b);
                });
                row.appendChild(name);
                const actions = this.skel('sk-actions');
                for (let i = 0; i < 3; i++) {
                    const pill = this.skel('sk-pill');
                    pill.style.width = `${72 + i * 8}px`;
                    actions.appendChild(pill);
                }
                row.appendChild(actions);
                block.appendChild(row);
                const desc = this.skel('sk-desc');
                ['96%', '88%', '54%'].forEach((w) => {
                    const b = this.skel('sk-bar');
                    b.style.width = w;
                    desc.appendChild(b);
                });
                block.appendChild(desc);
                layer.appendChild(block);
            }
        }

        document.body.appendChild(layer);
    }

    scheduleDemoNoiseCover(): void {
        const run = () => this.buildDemoNoiseCover();
        requestAnimationFrame(run);
        setTimeout(run, 300);
        setTimeout(run, 800);
        setTimeout(run, 1600);
    }
}

class YouTubeCaptionDetector {
    app: YouTubeVttApp;
    currentVideoId: string | null = null;
    captionsLoadedForVideo: string | null = null;

    constructor(app: YouTubeVttApp) {
        this.app = app;
    }

    start(): void {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data?.type === 'YT_CAPTIONS_FOUND') {
                this.handleCaptionTracks(event.data.videoId, event.data.tracks);
            }
            if (event.data?.type === 'YT_NO_CAPTIONS') {
                this.handleNoCaptions(event.data.videoId);
            }
        });

        document.addEventListener('yt-navigate-finish', () => {
            this.checkCurrentVideo();
            this.app.updateSidebarVisibility();
        });

        let lastVideoId = this.getVideoIdFromUrl();
        setInterval(() => {
            const id = this.getVideoIdFromUrl();
            if (id !== lastVideoId) {
                lastVideoId = id;
                this.checkCurrentVideo();
                this.app.updateSidebarVisibility();
            }
        }, 1000);

        // Ask page-script for current video's tracks (it may already have them)
        window.postMessage({ type: 'YT_QUERY_CAPTIONS' }, '*');
    }

    getVideoIdFromUrl(): string | null {
        try {
            const url = new URL(location.href);
            if (url.pathname === '/watch') return url.searchParams.get('v');
            if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || null;
        } catch {
            // ignore
        }
        return null;
    }

    checkCurrentVideo(): void {
        const id = this.getVideoIdFromUrl();
        if (!id || id === this.currentVideoId) return;
        this.currentVideoId = id;
        this.captionsLoadedForVideo = null;
        this.app.resetNoSubsRetries();
        this.app.resetForNewVideo();
        window.postMessage({ type: 'YT_QUERY_CAPTIONS' }, '*');
    }

    handleCaptionTracks(videoId: string, tracks: CaptionTrack[]): void {
        if (!videoId || !tracks || tracks.length === 0) return;

        const currentId = this.getVideoIdFromUrl();
        if (currentId && videoId !== currentId) return;

        if (videoId !== this.currentVideoId) {
            this.currentVideoId = videoId;
            this.captionsLoadedForVideo = null;
            this.app.resetNoSubsRetries();
            this.app.resetForNewVideo();
        }

        if (this.captionsLoadedForVideo === videoId) return;
        this.captionsLoadedForVideo = videoId;

        console.log('[YT-VTT] caption tracks for', videoId, tracks.map((t) => t.lang));

        // First-run gate: don't load anything until the user picks a language
        // pair. The banner tells them to open the popup; storage.onChanged then
        // re-processes this video automatically.
        if (!this.app.langPrefs) {
            this.app.showLanguageOnboarding();
            return;
        }

        const requests = this.buildTrackRequests(tracks, videoId);
        requests.forEach((req) => this.app.requestVtt(req, videoId));
    }

    handleNoCaptions(videoId: string): void {
        const currentId = this.getVideoIdFromUrl();
        if (currentId && videoId !== currentId) return;
        // The page-script confirmed this video has no caption tracks at all —
        // skip the "searching" wait and say so right away.
        this.app.declareNoSubtitles();
    }

    reprocessCurrentVideo(): void {
        this.captionsLoadedForVideo = null;
        this.app.resetForNewVideo();
        window.postMessage({ type: 'YT_QUERY_CAPTIONS' }, '*');
    }

    buildTrackRequests(tracks: CaptionTrack[], videoId: string): TrackRequest[] {
        const prefs = this.app.langPrefs;
        if (!prefs) return [];

        const plan = planTrackRequests(prefs, tracks, videoId);
        if (!plan) return [];

        // Keep AppState's primary/secondary selection aligned with the names the
        // plan assigned (VTTs arrive asynchronously and out of order).
        this.app.state.setLanguagePreferences(plan.primaryLabel, plan.secondaryLabel);

        return plan.requests;
    }
}

function injectLayoutOverrides(): void {
    const style = document.createElement('style');
    style.id = 'yt-vtt-layout';
    style.textContent = `
        body.vtt-sidebar-active:has(#vtt-sidebar:not(.collapsed):not(.fullscreen)) ytd-app {
            width: calc(100vw - 320px) !important;
            min-width: 0 !important;
        }
        body.vtt-sidebar-active:has(#vtt-sidebar:not(.collapsed):not(.fullscreen)) #masthead-container.ytd-app {
            width: calc(100vw - 320px) !important;
        }
        body.vtt-sidebar-active ytd-app {
            transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        ${SIDEBAR_CHROME_CSS}
    `;
    (document.head || document.documentElement).appendChild(style);
}

function watchSidebarState(): void {
    // YouTube's layout uses window.innerWidth via JS, so we must fire a resize event
    // whenever the effective content width changes (sidebar toggled / fullscreen entered).
    const fire = () => window.dispatchEvent(new Event('resize'));

    const startObservingSidebar = () => {
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar) return false;
        new MutationObserver(fire).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        return true;
    };

    if (!startObservingSidebar()) {
        const t = setInterval(() => {
            if (startObservingSidebar()) clearInterval(t);
        }, 200);
    }

    new MutationObserver(fire).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('fullscreenchange', fire);

    // Initial nudge so YouTube reflows on first sidebar appearance
    setTimeout(fire, 500);
}

function bootstrap(): void {
    const host = window.location.hostname;
    let app: BaseVttApp;
    if (host.includes('netflix.com')) {
        app = bootstrapNetflix();
    } else if (host.includes('youtube.com')) {
        injectLayoutOverrides();
        app = new YouTubeVttApp();
        watchSidebarState();
        installPlayerMenu(app);
        // Keep the overlay's control-bar clearance (--vtt-yt-controls-floor)
        // in sync with the real bar geometry; see controlsFloor.ts.
        watchControlsFloor();
        // YouTube tears down/rebuilds its player chrome on SPA navigation;
        // re-run (idempotent) so the button survives it.
        document.addEventListener('yt-navigate-finish', () => installPlayerMenu(app));
    } else {
        return;
    }
    installQuickAddOverlay();
    // The badge self-attaches to any #vtt-header-top (with an observer retry),
    // so gate it on owning the sidebar — otherwise it grafts into a sidebar
    // built by another installed copy of the extension.
    if (window === window.top && app.uiOwned) installAuthStatusBadge();
}

bootstrap();
