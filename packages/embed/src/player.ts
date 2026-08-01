// Playback sources for the embed. The sidebar only ever needs a clock, a seek
// and play/pause — expressed as PlayerHandle so a plain <video> file and a real
// YouTube IFrame player are interchangeable.
//
// The YouTube path is what makes the site demo honest: the actual YouTube
// player playing a Creative Commons video, with the extension UI running
// against its clock via the official IFrame API. What stays impossible without
// the extension installed is reading caption tracks of arbitrary videos from
// the parent page — which is why the demo's tracks are supplied as data for
// the one chosen video, prepared ahead of time.

export interface PlayerHandle {
    currentTime(): number;
    seek(time: number): void;
    play(): void;
    pause(): void;
    paused(): boolean;
    duration(): number;
    /**
     * Volume as 0..1. Both sources start muted, because autoplay is only
     * allowed that way — raising the volume is a user gesture, which is
     * precisely what lifts the browser's restriction.
     */
    volume(): number;
    setVolume(volume: number): void;
    onTime(fn: () => void): void;
    /** The underlying <video>, when the source is a file. */
    video: HTMLVideoElement | null;
    destroy(): void;
}

// ---------------------------------------------------------------- file source

export function createFilePlayer(
    stage: HTMLElement,
    opts: { src: string; poster?: string; autoplay: boolean; loop: boolean },
): PlayerHandle {
    const video = document.createElement('video');
    video.className = 'lge-video';
    video.src = opts.src;
    if (opts.poster) video.poster = opts.poster;
    video.muted = true; // required for autoplay to be allowed
    video.loop = opts.loop;
    video.playsInline = true;
    video.autoplay = opts.autoplay;
    stage.prepend(video);

    // Seeking a plain <video src> needs HTTP Range: without it the browser
    // reports `seekable` as an empty range and silently snaps every seek back
    // to the start. Clicking a transcript line — the demo's central gesture —
    // then does nothing, and so does the scrubber. Not every host serves Range
    // (Python's http.server, some object stores and CDN configs do not), and
    // the page cannot detect that before the first failed seek.
    //
    // So the clip is also fetched once as a Blob and swapped in: a blob: URL is
    // backed by memory the browser already holds, so it is always fully
    // seekable. The plain src stays as the initial source, which means playback
    // starts immediately from the network rather than waiting on the download;
    // the swap only upgrades seeking, and is skipped entirely if the file is
    // already seekable, if the fetch fails, or if the player is torn down
    // first.
    let blobUrl: string | null = null;
    let destroyed = false;
    let pendingSeek: number | null = null;
    const upgradeSeeking = async (): Promise<void> => {
        try {
            const res = await fetch(opts.src);
            if (!res.ok) return;
            const url = URL.createObjectURL(await res.blob());
            if (destroyed) return void URL.revokeObjectURL(url);
            // Swapping src restarts the element, so its position and playing
            // state are carried across by hand.
            const at = pendingSeek ?? video.currentTime;
            const wasPlaying = !video.paused;
            blobUrl = url;
            video.src = url;
            video.addEventListener('loadedmetadata', () => {
                video.currentTime = at;
                pendingSeek = null;
                if (wasPlaying) void video.play().catch(() => {});
            }, { once: true });
        } catch {
            /* the network src keeps working; only seeking stays limited */
        }
    };
    // `seekable` is only meaningful once metadata has arrived. Without Range
    // the browser still reports one range — it is just empty (0→0) or far short
    // of the duration — so the test is how much of the clip it actually covers,
    // not whether a range exists at all.
    video.addEventListener('loadedmetadata', () => {
        if (blobUrl) return;
        const end = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
        if (end < (video.duration || 0) - 1) void upgradeSeeking();
    }, { once: true });

    const listeners: Array<() => void> = [];
    const tick = () => listeners.forEach((fn) => fn());
    video.addEventListener('timeupdate', tick);

    return {
        video,
        currentTime: () => video.currentTime,
        seek: (t) => {
            // A seek asked for while the blob is still downloading would be
            // thrown away by the src swap, so it is remembered and re-applied
            // once the seekable source is in place.
            pendingSeek = t;
            video.currentTime = t;
            void video.play().catch(() => {});
        },
        play: () => void video.play().catch(() => {}),
        pause: () => video.pause(),
        paused: () => video.paused,
        duration: () => video.duration || 0,
        // `muted` and `volume` are independent in the DOM: a muted element with
        // volume 1 stays silent. Reporting 0 while muted keeps the two in step,
        // so the slider shows what is actually audible.
        volume: () => (video.muted ? 0 : video.volume),
        setVolume: (v) => {
            video.volume = Math.min(1, Math.max(0, v));
            video.muted = v <= 0;
        },
        onTime: (fn) => listeners.push(fn),
        destroy: () => {
            destroyed = true;
            video.removeEventListener('timeupdate', tick);
            video.remove();
            // The blob holds the whole clip in memory until it is revoked.
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        },
    };
}

// ------------------------------------------------------------- youtube source

// Just the sliver of the IFrame API the handle uses.
interface YTPlayer {
    getIframe(): HTMLIFrameElement;
    /** Undocumented but long-stable: unloads/configures the captions renderer. */
    unloadModule?(module: string): void;
    setOption?(module: string, option: string, value: unknown): void;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    playVideo(): void;
    pauseVideo(): void;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getVolume(): number;
    setVolume(volume: number): void;
    destroy(): void;
}
declare global {
    interface Window {
        YT?: { Player: new (el: HTMLElement, cfg: unknown) => YTPlayer; PlayerState: { PLAYING: number } };
        onYouTubeIframeAPIReady?: () => void;
    }
}

let apiPromise: Promise<void> | null = null;
function loadIframeApi(): Promise<void> {
    if (window.YT?.Player) return Promise.resolve();
    if (!apiPromise) {
        apiPromise = new Promise((resolve) => {
            const prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                prev?.();
                resolve();
            };
            const s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(s);
        });
    }
    return apiPromise;
}

// The IFrame API has no timeupdate event, so the clock is polled at the same
// ~250ms cadence the extension effectively works at on YouTube.
const POLL_MS = 250;

// Same job as the extension's native-caption suppression: the dual overlay
// replaces YouTube's own captions, so they must not stack behind it. Both calls
// are undocumented-but-long-stable, and YouTube re-applies the viewer's caption
// preference on state changes — hence this runs repeatedly, not once.
function suppressNativeCaptions(player: YTPlayer): void {
    try {
        player.unloadModule?.('captions'); // legacy module name
        player.unloadModule?.('cc');       // current module name
        player.setOption?.('captions', 'track', {}); // empty track = none
    } catch {
        /* undocumented API — never let this break playback */
    }
}

export function createYouTubePlayer(
    stage: HTMLElement,
    opts: { videoId: string; autoplay: boolean; loop: boolean; start?: number; end?: number; onFail?: () => void },
): PlayerHandle {
    const host = document.createElement('div');
    host.className = 'lge-yt';
    stage.prepend(host);

    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let failed = false;
    const listeners: Array<() => void> = [];
    const fail = () => {
        if (failed) return;
        failed = true;
        opts.onFail?.();
    };

    void loadIframeApi().then(() => {
        player = new window.YT!.Player(host, {
            videoId: opts.videoId,
            playerVars: {
                autoplay: opts.autoplay ? 1 : 0,
                mute: 1,
                // Native controls ON: the point of the YouTube source is that
                // visitors see the player they know. Our own bar belongs to the
                // file source only — replacing YouTube's with a replica made the
                // demo look like an imitation of YouTube rather than YouTube.
                controls: 1,
                // No native fullscreen button: it would full-screen the IFRAME,
                // where the transcript panel cannot follow (cross-origin), and
                // pairing it with our own stage-fullscreen button gave two
                // identical icons with different behaviour. One button, one
                // meaning: the stage button in embed.ts, panel included.
                fs: 0,
                cc_load_policy: 0, // don't force captions on at load
                rel: 0,
                loop: opts.loop ? 1 : 0,
                playlist: opts.loop ? opts.videoId : undefined, // loop requires a playlist
                start: opts.start,
                modestbranding: 1,
                playsinline: 1,
                origin: location.origin,
            },
            events: {
                onError: () => fail(),
                onStateChange: () => { if (player) suppressNativeCaptions(player); },
                onReady: () => {
                    // YT.Player REPLACES the host element with the iframe, so
                    // the styling class has to be re-applied to what's actually
                    // in the DOM now.
                    player!.getIframe().classList.add('lge-yt');
                    player!.mute();
                    suppressNativeCaptions(player!);
                    if (opts.autoplay) player!.playVideo();
                    // Embedded playback can be refused without an onError —
                    // YouTube's bot interstitial just sits there — so a clock
                    // that never starts counts as failure too.
                    if (opts.autoplay) {
                        watchdog = setTimeout(() => {
                            if ((player?.getCurrentTime() ?? 0) <= (opts.start ?? 0) + 0.5) fail();
                        }, 8000);
                    }
                    // The renderer can appear a beat after playback starts,
                    // so re-assert for a few seconds rather than trusting the
                    // onReady + onStateChange calls alone.
                    let ccGuard = 0;
                    timer = setInterval(() => {
                        if (ccGuard < 20 && player) {
                            ccGuard++;
                            suppressNativeCaptions(player);
                        }
                        // Window loop: the demo's tracks cover [start, end), not
                        // the whole film — rewind at the window edge.
                        if (opts.end && player && player.getCurrentTime() >= opts.end) {
                            player.seekTo(opts.start ?? 0, true);
                        }
                        listeners.forEach((fn) => fn());
                    }, POLL_MS);
                },
            },
        });
    });

    return {
        video: null,
        currentTime: () => player?.getCurrentTime() ?? 0,
        seek: (t) => {
            player?.seekTo(t, true);
            player?.playVideo();
        },
        play: () => player?.playVideo(),
        pause: () => player?.pauseVideo(),
        paused: () => (player ? player.getPlayerState() !== window.YT!.PlayerState.PLAYING : true),
        duration: () => player?.getDuration() ?? 0,
        volume: () => (player?.isMuted() ?? true ? 0 : (player?.getVolume() ?? 0) / 100),
        setVolume: (v) => {
            const pct = Math.min(100, Math.max(0, Math.round(v * 100)));
            player?.setVolume(pct);
            if (pct > 0) player?.unMute();
            else player?.mute();
        },
        onTime: (fn) => listeners.push(fn),
        destroy: () => {
            if (timer) clearInterval(timer);
            if (watchdog) clearTimeout(watchdog);
            player?.destroy();
            host.remove();
        },
    };
}
