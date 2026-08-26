// Runs the Lingogram extension UI inside an ordinary web page.
//
// Everything visible here is the extension's own code, imported from
// @video-transcripts/shared — the sidebar (transcript, quick modes, settings,
// collapse tab), the on-video dual-subtitle overlay, the selection → "add word"
// pill with its toast, and the auth/word-count badge. This module supplies only
// what a website lacks:
//
//   • a host player — a local <video> file OR the real YouTube IFrame player
//     (see player.ts), wrapped in the AppInterface the sidebar drives,
//   • subtitle tracks — passed in by the caller instead of scraped from a site,
//   • a `chrome` shim — so the content modules' background-worker calls resolve.
//
// Layout differences from a real page (the sidebar is position:fixed against
// the viewport there) are corrected with a scoped stylesheet, not by forking
// the component.
import {
    AppState,
    SidebarUI,
    installAuthStatusBadge,
    installQuickAddOverlay,
    refreshAuthStatusBadge,
} from '@video-transcripts/shared';
import type { AppInterface } from '@video-transcripts/shared';
import { installChromeShim } from './chrome-shim';
import { EMBED_CSS } from './embed-css';
// The extension's real stylesheet, inlined at build time (see vite.config.ts).
import { EXTENSION_CSS } from 'virtual:extension-css';
import { createFilePlayer, createYouTubePlayer, PlayerHandle } from './player';
import type { EmbedInstance, EmbedOptions, EmbedTrack } from './types';

const STYLE_ID = 'lingogram-embed-style';

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `${EXTENSION_CSS}\n${EMBED_CSS}`;
    document.head.appendChild(style);
}

class EmbeddedApp implements AppInterface {
    ui!: SidebarUI;

    constructor(
        readonly state: AppState,
        readonly player: PlayerHandle,
        readonly stage: HTMLElement,
    ) {}

    // Same one-liner the extensions use (app-base.ts): hand the clock to the
    // sidebar and let it own highlighting, scrolling and the overlay.
    updateHighlight(): void {
        this.ui?.highlightSubtitle(this.player.currentTime());
    }

    seekVideo(time: number): void {
        this.player.seek(time);
    }

    getOverlayParent(): HTMLElement | null {
        return this.stage;
    }

    // Set from the mounted tracks, not hardcoded: the demo picks the visitor's
    // own language for the second track.
    langPrefs: { learning: string; native: string } | null = null;

    // No site captions of our own to suppress.
    setNativeSubtitlesEnabled(): void {}
}

export function mount(options: EmbedOptions): EmbedInstance {
    const {
        container,
        videoSrc,
        youtubeVideoId,
        poster,
        tracks,
        autoplay = true,
        loop = true,
        mode = 'dual',
        overlay = true,
        collapsible = true,
        playerChrome = true,
    } = options;

    // Our player bar exists for the file source; the YouTube source keeps
    // YouTube's own controls — that familiarity is the point of using it.
    const ownChrome = playerChrome && !youtubeVideoId;

    if (!tracks?.length) throw new Error('[lingogram-embed] at least one track is required');
    if (!videoSrc && !youtubeVideoId) throw new Error('[lingogram-embed] videoSrc or youtubeVideoId is required');

    // An installed Lingogram extension injects into every page — including
    // whatever host this embed runs on — and claims the shared #vtt-* ids
    // first. When the ids are taken, mount NOTHING: grafting our controls into
    // the foreign panel produces UI that looks live but drives a state with no
    // screen presence (the same collision the apps guard with uiOwned). The
    // check runs before any DOM write or player creation, so there is nothing
    // to tear down and, crucially, nothing of the OTHER copy's to tear down:
    // a destroy() from a half-mounted conflicted instance used to remove the
    // extension's own elements by their shared ids.
    if (document.getElementById('vtt-sidebar')) {
        console.warn(
            '[lingogram-embed] #vtt-sidebar is already on this page — another copy of the ' +
            'Lingogram UI (most likely the installed extension) owns it. The embed will not ' +
            'render, because sharing the ids would produce controls that look live but ' +
            'drive nothing.',
        );
        options.onOwnershipConflict?.();
        return { video: null, setMode() {}, setCollapsed() {}, setOverlay() {}, destroy() {} };
    }

    ensureStyles();
    const restoreChrome = installChromeShim(options);

    container.classList.add('lingogram-embed');
    container.innerHTML = `
        <div class="lge-stage" data-lge-stage>
          ${ownChrome ? '<div class="lge-controls" data-lge-controls></div>' : ''}
        </div>
        <div class="lge-sidebar" data-lge-sidebar></div>
        <div class="lge-tab-slot" data-lge-tab></div>`;

    const stage = container.querySelector<HTMLElement>('[data-lge-stage]')!;
    const mountPoint = container.querySelector<HTMLElement>('[data-lge-sidebar]')!;

    const player = youtubeVideoId
        ? createYouTubePlayer(stage, { videoId: youtubeVideoId, autoplay, loop, start: options.youtubeStart, end: options.youtubeEnd, onFail: options.onPlaybackFail })
        : createFilePlayer(stage, { src: videoSrc!, poster, autoplay, loop });

    const state = new AppState();
    for (const track of tracks) state.addTrack(track.name, track.lines);
    state.setLanguagePreferences(tracks[0]?.name, tracks[1]?.name);
    state.displayMode = mode;
    state.overlayEnabled = overlay;

    const app = new EmbeddedApp(state, player, stage);
    app.langPrefs = {
        learning: tracks[0]?.lang ?? tracks[0]?.name ?? 'en',
        native: tracks[1]?.lang ?? tracks[1]?.name ?? '',
    };
    const ui = new SidebarUI(state, app);
    app.ui = ui;

    // init() cannot lose the id race here: mount() already returned on a
    // foreign #vtt-sidebar, and everything since that check has been
    // synchronous — so this sidebar is ours.
    ui.init();
    const sidebar = document.getElementById('vtt-sidebar');
    if (sidebar) mountPoint.appendChild(sidebar);
    // The tab lives outside the sidebar's column: the panel is clipped to its
    // track (so it can't spill over the video when it slides out), while the
    // tab has to stay visible and clickable even at zero width.
    const tabSlot = container.querySelector<HTMLElement>('[data-lge-tab]');
    const toggleTab = document.getElementById('vtt-toggle-btn');
    if (tabSlot && toggleTab) tabSlot.appendChild(toggleTab);
    if (!collapsible) container.classList.add('lge-no-tab');

    // Fullscreen puts the STAGE full-screen, and SidebarUI re-parents the panel
    // into it. The tab lives in the container instead (outside the fullscreen
    // element), so it would vanish exactly when it is the only way back to a
    // panel the extension deliberately collapses on the way in — leaving the
    // transcript unreachable. Send the tab along, and hand it back after.
    //
    // Only the file source is handled. The YouTube source is a cross-origin
    // iframe: its own fullscreen button puts the IFRAME full-screen and nothing
    // of ours can go inside it. Intercepting that (exitFullscreen, then
    // requestFullscreen on the stage) was tried and reverted — it spends the
    // transient user activation the second call needs, so Chrome refuses it and
    // the visitor is left with no fullscreen at all. A broken native control is
    // worse than a panel that steps aside, so YouTube's button is left alone.
    const onFullscreen = (): void => {
        const full = document.fullscreenElement === stage;
        container.classList.toggle('lge-fullscreen', full);
        if (!toggleTab) return;
        if (full) stage.appendChild(toggleTab);
        else tabSlot?.appendChild(toggleTab);
    };
    document.addEventListener('fullscreenchange', onFullscreen);

    // The extension's own content modules, unmodified: selection → save pill
    // with its toast, and the account/word-count badge. Both bind document-level
    // listeners, so their teardowns are collected — a remount (the YouTube→file
    // fallback) would otherwise stack a second set and fire each twice.
    const pageTeardown: Array<() => void> = [
        installQuickAddOverlay(),
        installAuthStatusBadge(),
    ];
    refreshAuthStatusBadge();

    renderLanguagePairChip(state, ui, tracks);

    if (ownChrome) pageTeardown.push(renderPlayerChrome(container, player, state, ui));
    // The YouTube source has no fullscreen at all: its native button is
    // removed (player.ts, fs: 0) because it would full-screen the cross-origin
    // iframe, where the transcript cannot follow, and a stage-level substitute
    // proved to be a second identical icon with different behaviour. The demo
    // lives on the page; fullscreen belongs to the real extension.

    // Collapsing translates the sidebar off-screen in the extension; in a grid
    // that leaves a dead column behind, so mirror the state onto the container
    // and let CSS close the track. The sidebar's own tab and our player button
    // both go through toggleCollapsed, so observing the class is more reliable
    // than wrapping every entry point.
    const syncCollapsed = () => container.classList.toggle('lge-collapsed', ui.isCollapsed());
    const collapseObserver = sidebar ? new MutationObserver(syncCollapsed) : null;
    collapseObserver?.observe(sidebar!, { attributes: true, attributeFilter: ['class'] });
    syncCollapsed();

    player.onTime(() => app.updateHighlight());

    // Mode changes have many entry points inside SidebarUI (quick-mode chips,
    // settings, keyboard shortcuts) and no event of their own, so observe the
    // state on the player tick the embed already runs every frame-ish.
    let lastMode = state.displayMode;
    player.onTime(() => {
        if (state.displayMode !== lastMode) {
            lastMode = state.displayMode;
            options.onModeChange?.(lastMode);
        }
    });
    ui.refresh();

    return {
        video: player.video,
        setMode(next) {
            state.displayMode = next;
            ui.refresh();
        },
        setCollapsed(collapsed) {
            if (ui.isCollapsed() !== collapsed) ui.toggleCollapsed();
            syncCollapsed();
        },
        // Through toggleOverlay(), not state.overlayEnabled: it also repaints
        // the on-video captions, the quick-mode chip and the settings preview,
        // so the panel agrees with what the host page just did.
        setOverlay(on) {
            if (state.overlayEnabled !== on) ui.toggleOverlay();
        },
        destroy() {
            collapseObserver?.disconnect();
            document.removeEventListener('fullscreenchange', onFullscreen);
            player.destroy();
            // Unbinds the sidebar's document-level listeners too. Without this
            // a remount (the YouTube→file fallback) leaves the old instance
            // listening for `fullscreenchange`, and it re-inserts its own
            // sidebar on the next fullscreen exit — two panels on the page.
            ui.destroy();
            document.getElementById('lingogram-quick-add-pill')?.remove();
            document.getElementById('lingogram-quick-add-toast')?.remove();
            document.getElementById('lingogram-auth-badge')?.remove();
            document.getElementById('lingogram-auth-panel')?.remove();
            for (const off of pageTeardown.splice(0)) off();
            container.innerHTML = '';
            container.classList.remove('lingogram-embed', 'lge-no-tab', 'lge-collapsed');
            restoreChrome();
        },
    };
}

// The "EN ⇄ RU" chip at the left edge of the sidebar's header, ported from the
// extensions' app-base.ts (updateLanguagePairChip). It lives in each app
// rather than in SidebarUI, so an embed that only implements AppInterface
// would otherwise be missing it — and the chip is not decoration: it IS the
// swap control, so without it the demo has no way to flip which language leads.
function renderLanguagePairChip(state: AppState, ui: SidebarUI, tracks: EmbedTrack[]): void {
    const headerTop = document.getElementById('vtt-header-top');
    if (!headerTop || document.getElementById('vtt-langpair')) return;
    // Only ever mount into OUR sidebar. #vtt-header-top is a shared id, so
    // without this the chip lands in a foreign panel (see the ownership note in
    // mount) and becomes a control that clicks but never changes anything.
    if (!headerTop.closest('[data-lge-sidebar]')) return;

    // Codes come from the tracks themselves; a track without `lang` shows its
    // name instead, which is still readable ("English ⇄ Русский").
    const codeFor = (index: number): string => {
        const name = state.tracks[index]?.name;
        const track = tracks.find((t) => t.name === name);
        return track?.lang ? track.lang.toUpperCase() : (name ?? '');
    };

    const chip = document.createElement('div');
    chip.id = 'vtt-langpair';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-label', 'Swap');
    chip.title = 'Swap (Shift+S)';

    // Painted ONCE, in mount-time (preference) order — the same contract as
    // the extension's updateLanguagePairChip. The visual flip on swap is done
    // entirely by .vtt-swapped (set in updateControls), which row-reverses the
    // inner span. Repainting from the live indexes here would flip the DOM as
    // well: two reversals cancel and the chip looks frozen while the tracks
    // underneath really do swap.
    chip.innerHTML =
        '<span class="vtt-langpair-inner">' +
        `<span class="vtt-langpair-lang">${codeFor(state.activeTrackIndex)}</span>` +
        '<span class="vtt-langpair-arrow">⇄</span>' +
        `<span class="vtt-langpair-lang">${codeFor(state.secondaryTrackIndex)}</span>` +
        '</span>';

    const swap = (): void => {
        if (!state.swapTracks()) return;
        chip.classList.remove('vtt-pulse');
        void chip.offsetWidth; // restart the animation
        chip.classList.add('vtt-pulse');
        ui.refresh();
    };
    chip.addEventListener('click', swap);
    chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            swap();
        }
    });

    headerTop.prepend(chip);
}

// The mascot from the extension's real player button
// (apps/*/src/assets/icons/player-btn.png), inlined because the embed ships as a
// single JS bundle with no asset pipeline — a URL here would 404 on every host.
const LOGO_SRC = 'data:image/png;base64,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';

// Mascot + subtitle toggle + the mascot's menu, as one unit. Shared by both
// sources: our own control bar embeds it next to CC, and the YouTube source —
// whose toolbar lives in a cross-origin iframe we cannot touch — overlays it
// on top of YouTube's own bar.
const LINGOGRAM_PILL = `
    <span class="lge-anchor">
      <button class="lge-btn lge-lingogram" type="button" title="Lingogram" aria-label="Open Lingogram menu">
        <img src="${LOGO_SRC}" alt="" draggable="false">
      </button>
      <button class="lge-btn lge-subs" type="button" role="switch" aria-checked="true"
              title="Subtitles on video" aria-label="Subtitles on video">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <rect x="3" y="6" width="18" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M7 11.5h4M13 11.5h4M7 14.5h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="lge-menu" data-lge-menu hidden data-page="root" role="menu" aria-label="Lingogram menu">
        <div class="lge-page" data-page="root">
          <button class="lge-row" type="button" role="menuitem" data-act="modes" aria-haspopup="menu">
            <span>Mode</span><span class="lge-row-value" data-lge-mode-value></span>
          </button>
          <button class="lge-row" type="button" role="menuitem" data-act="panel">
            <span data-lge-panel-label>Hide panel</span>
          </button>
          <button class="lge-row" type="button" role="menuitem" data-act="settings">
            <span>Settings</span>
          </button>
        </div>
        <div class="lge-page" data-page="modes" hidden>
          <button class="lge-row lge-row-back" type="button" role="menuitem" data-act="back">
            <span>‹ Mode</span>
          </button>
          <button class="lge-row" type="button" role="menuitemradio" data-mode="single"><span>Original only</span></button>
          <button class="lge-row" type="button" role="menuitemradio" data-mode="dual"><span>Both languages</span></button>
          <button class="lge-row" type="button" role="menuitemradio" data-mode="guess"><span>Guess the word</span></button>
        </div>
      </div>
    </span>`;

// A minimal player bar so the embed reads as a video player: progress, time,
// and a Lingogram button next to CC — the same affordance the YouTube edition
// adds to the real player toolbar.
// Returns a teardown for the document-level listeners wireLingogramPill binds.
function renderPlayerChrome(container: HTMLElement, player: PlayerHandle, state: AppState, ui: SidebarUI): () => void {
    const bar = container.querySelector<HTMLElement>('[data-lge-controls]');
    if (!bar) return () => {}; // nothing rendered, nothing to unbind

    // A replica of YouTube's control bar. The real one is unreachable (it lives
    // in a cross-origin iframe), so the demo rebuilds it: same 48px row, same
    // 24px glyphs, same red scrubber, same left/right split. Anything that is
    // ours — the mascot pill — sits exactly where the extension puts it on
    // youtube.com, immediately left of CC.
    bar.innerHTML = `
        <div class="lge-track" data-lge-track>
          <div class="lge-track-line">
            <div class="lge-buffer"></div>
            <div class="lge-fill"><span class="lge-knob"></span></div>
          </div>
        </div>
        <div class="lge-row">
          <button class="lge-yt-btn lge-play" type="button" aria-label="Play">
            <svg viewBox="0 0 36 36" aria-hidden="true"><path class="lge-play-icon" d="M12 26l17-8L12 10z" fill="currentColor"/><path class="lge-pause-icon" d="M12 26h5V10h-5zm11-16v16h5V10z" fill="currentColor"/></svg>
          </button>
          <span class="lge-vol" data-lge-vol>
            <button class="lge-yt-btn lge-mute" type="button" aria-label="Unmute">
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <path class="lge-vol-loud" d="M8 21h4l5 5V10l-5 5H8zM19.5 13.4c1.9 1 3.1 2.7 3.1 4.6s-1.2 3.6-3.1 4.6v-1.9c1-.7 1.6-1.6 1.6-2.7s-.6-2-1.6-2.7zM19.5 9.2c3.7 1.2 6.3 4.5 6.3 8.8s-2.6 7.6-6.3 8.8v-1.9c2.7-1.1 4.6-3.7 4.6-6.9s-1.9-5.8-4.6-6.9z" fill="currentColor"/>
                <path class="lge-vol-muted" d="M8 21h4l5 5V10l-5 5H8zM26.9 18l2.6-2.6-1.4-1.4-2.6 2.6-2.6-2.6-1.4 1.4 2.6 2.6-2.6 2.6 1.4 1.4 2.6-2.6 2.6 2.6 1.4-1.4z" fill="currentColor"/>
              </svg>
            </button>
            <span class="lge-vol-slider" data-lge-vol-slider role="slider"
                  aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
              <span class="lge-vol-line"><span class="lge-vol-fill" data-lge-vol-fill></span></span>
            </span>
          </span>
          <span class="lge-time"><span data-lge-cur>0:00</span> / <span data-lge-dur>0:00</span></span>
          <span class="lge-spacer"></span>
          ${LINGOGRAM_PILL}
          <button class="lge-yt-btn lge-full" type="button" aria-label="Full screen">
            <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M10 16h2v-4h4v-2h-6zM20 10v2h4v4h2v-6zM24 24h-4v2h6v-6h-2zM12 20h-2v6h6v-2h-4z" fill="currentColor"/></svg>
          </button>
        </div>`;

    const fill = bar.querySelector<HTMLElement>('.lge-fill')!;
    const cur = bar.querySelector<HTMLElement>('[data-lge-cur]')!;
    const dur = bar.querySelector<HTMLElement>('[data-lge-dur]')!;
    const play = bar.querySelector<HTMLButtonElement>('.lge-play')!;
    const track = bar.querySelector<HTMLElement>('[data-lge-track]')!;

    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    player.onTime(() => {
        const d = player.duration() || 1;
        fill.style.width = `${(player.currentTime() / d) * 100}%`;
        cur.textContent = fmt(player.currentTime());
        dur.textContent = fmt(player.duration());
        const paused = player.paused();
        play.classList.toggle('paused', paused);
        play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    });
    play.addEventListener('click', () => (player.paused() ? player.play() : player.pause()));

    // Scrub: press anywhere on the track and drag, as YouTube does — a
    // click-only bar feels broken the moment anyone tries to drag it.
    const seekTo = (clientX: number) => {
        const r = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        player.seek(ratio * player.duration());
    };
    track.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        track.setPointerCapture(e.pointerId);
        bar.classList.add('lge-scrubbing');
        seekTo(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
        if (track.hasPointerCapture(e.pointerId)) seekTo(e.clientX);
    });
    const endScrub = (e: PointerEvent) => {
        if (!track.hasPointerCapture(e.pointerId)) return;
        track.releasePointerCapture(e.pointerId);
        bar.classList.remove('lge-scrubbing');
    };
    track.addEventListener('pointerup', endScrub);
    track.addEventListener('pointercancel', endScrub);

    // Volume. The clip autoplays muted (browsers allow no other kind), so the
    // control opens at zero and the speaker shows crossed out — the click that
    // raises it is itself the user gesture that lets sound through.
    const muteBtn = bar.querySelector<HTMLButtonElement>('.lge-mute')!;
    const volSlider = bar.querySelector<HTMLElement>('[data-lge-vol-slider]')!;
    const volFill = bar.querySelector<HTMLElement>('[data-lge-vol-fill]')!;
    // Restores the pre-mute level, the way every player's mute button behaves:
    // muting and unmuting must land back where the volume was, not at full.
    let lastVolume = 1;

    const renderVolume = () => {
        const v = player.volume();
        volFill.style.width = `${v * 100}%`;
        muteBtn.classList.toggle('is-muted', v <= 0);
        muteBtn.setAttribute('aria-label', v <= 0 ? 'Unmute' : 'Mute');
        volSlider.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    };
    const applyVolume = (v: number) => {
        const clamped = Math.min(1, Math.max(0, v));
        if (clamped > 0) lastVolume = clamped;
        player.setVolume(clamped);
        renderVolume();
    };

    muteBtn.addEventListener('click', () => {
        applyVolume(player.volume() > 0 ? 0 : lastVolume);
    });

    const volumeFromEvent = (clientX: number) => {
        const r = volSlider.getBoundingClientRect();
        applyVolume((clientX - r.left) / r.width);
    };
    volSlider.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        volSlider.setPointerCapture(e.pointerId);
        volumeFromEvent(e.clientX);
    });
    volSlider.addEventListener('pointermove', (e) => {
        if (volSlider.hasPointerCapture(e.pointerId)) volumeFromEvent(e.clientX);
    });
    const endVolDrag = (e: PointerEvent) => {
        if (volSlider.hasPointerCapture(e.pointerId)) volSlider.releasePointerCapture(e.pointerId);
    };
    volSlider.addEventListener('pointerup', endVolDrag);
    volSlider.addEventListener('pointercancel', endVolDrag);
    // Arrow keys, because the slider is focusable and announces itself as one.
    volSlider.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05
            : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
        if (!step) return;
        e.preventDefault();
        applyVolume(player.volume() + step);
    });
    renderVolume();

    // No separate CC or settings buttons: the mascot's pill already owns both —
    // its right half toggles the on-video subtitles (wired in
    // wireLingogramPill) and its menu opens Settings. A second copy of each,
    // sitting in the same row, was decoration standing in for YouTube's toolbar
    // rather than a control the demo needs.

    bar.querySelector<HTMLButtonElement>('.lge-full')!.addEventListener('click', () => {
        const stageEl = container.querySelector<HTMLElement>('[data-lge-stage]')!;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void stageEl.requestFullscreen?.().catch(() => {});
    });

    // The bar hides after a few seconds of stillness and comes back on any
    // movement — the behaviour that makes a player feel like a player. It stays
    // put while paused or while the mascot's menu is open, both of which mean
    // the visitor is looking at it.
    const stage = container.querySelector<HTMLElement>('[data-lge-stage]')!;
    const menuEl = bar.querySelector<HTMLElement>('[data-lge-menu]')!;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
        stage.classList.remove('is-idle');
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (player.paused() || !menuEl.hidden) return wake();
            stage.classList.add('is-idle');
        }, 3000);
    };
    stage.addEventListener('mousemove', wake);
    stage.addEventListener('mouseleave', () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (!player.paused() && menuEl.hidden) stage.classList.add('is-idle');
    });
    wake();

    // Click the picture to play/pause, the way every video player behaves. The
    // file source got this free from the <video> element's own controls and the
    // YouTube source from its iframe; with our bar owning both, the stage has to
    // provide it. Clicks that land on the bar, the subtitle overlay's selectable
    // text, or the quick-add pill are not "clicks on the picture".
    stage.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.lge-controls, #vtt-video-overlay, #lingogram-quick-add-pill')) return;
        if (window.getSelection()?.toString()) return; // finishing a word selection
        player.paused() ? player.play() : player.pause();
    });

    return wireLingogramPill(bar, state, ui);
}

// Wires the shared pill: the mascot's menu and the subtitle toggle. `root` is
// whatever element the pill was rendered into.
function wireLingogramPill(root: HTMLElement, state: AppState, ui: SidebarUI): () => void {
    // The mascot opens the menu — the same affordance as the YouTube edition's
    // player button. The extension's own menu also carries account and
    // subtitle-health rows; both are meaningless here (no sign-in, tracks are
    // passed in, so there is nothing to retry), so this is the subset that
    // actually does something in the demo.
    const menuBtn = root.querySelector<HTMLButtonElement>('.lge-lingogram')!;
    const menu = root.querySelector<HTMLElement>('[data-lge-menu]')!;
    const modeValue = menu.querySelector<HTMLElement>('[data-lge-mode-value]')!;
    const panelLabel = menu.querySelector<HTMLElement>('[data-lge-panel-label]')!;
    const MODE_NAMES: Record<string, string> = {
        single: 'Original only',
        dual: 'Both languages',
        guess: 'Guess the word',
    };

    const showPage = (name: string) => {
        menu.dataset.page = name;
        for (const page of menu.querySelectorAll<HTMLElement>('.lge-page')) {
            page.hidden = page.dataset.page !== name;
        }
    };

    const renderMenu = () => {
        modeValue.textContent = MODE_NAMES[state.displayMode] ?? '';
        panelLabel.textContent = ui.isCollapsed() ? 'Show panel' : 'Hide panel';
        for (const btn of menu.querySelectorAll<HTMLElement>('[data-mode]')) {
            btn.setAttribute('aria-checked', String(btn.dataset.mode === state.displayMode));
        }
    };

    const closeMenu = () => {
        menu.hidden = true;
        menuBtn.setAttribute('aria-expanded', 'false');
        showPage('root');
    };

    menuBtn.setAttribute('aria-haspopup', 'menu');
    closeMenu();

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!menu.hidden) return closeMenu();
        renderMenu();
        menu.hidden = false;
        menuBtn.setAttribute('aria-expanded', 'true');
    });

    // Held for teardown: these close over `menu`, which destroy() detaches, so
    // a remount would leave them poking a dead element on every page click.
    const onDocClick = (): void => { if (!menu.hidden) closeMenu(); };
    const onDocKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && !menu.hidden) closeMenu();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKeydown);

    menu.addEventListener('click', (e) => {
        // Any click on the stage plays/pauses the video, and the document
        // listener above dismisses the menu — so the menu swallows its own
        // clicks before acting on the row.
        e.stopPropagation();
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-mode]');
        if (!row) return;
        const { act, mode } = row.dataset;
        if (mode) {
            state.displayMode = mode as 'single' | 'dual' | 'guess';
            ui.refresh();
            renderMenu();
            closeMenu();
        } else if (act === 'modes') showPage('modes');
        else if (act === 'back') showPage('root');
        else if (act === 'panel') { ui.toggleCollapsed(); closeMenu(); }
        else if (act === 'settings') { ui.openSettings(); closeMenu(); }
    });

    // Its neighbour toggles the on-video subtitles — the one thing wanted
    // mid-video, which is why the YouTube edition gives it its own control
    // instead of burying it in the menu.
    const subs = root.querySelector<HTMLButtonElement>('.lge-subs')!;
    subs.setAttribute('aria-checked', String(state.overlayEnabled));
    subs.addEventListener('click', () => {
        ui.toggleOverlay();
        subs.setAttribute('aria-checked', String(state.overlayEnabled));
    });

    return () => {
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onDocKeydown);
    };
}

