import { WEBVTT_PROFILE } from './subtitles';

// ── Netflix MAIN-world manifest hook ────────────────────────────────────────
// Runs in the page's own JS world (document_start) so it can wrap JSON.parse /
// JSON.stringify before Netflix builds its playback manifest request.
//
//  • On the REQUEST side we push the `webvtt-lssdh-ios8` profile into the
//    manifest's `profiles` array so Netflix returns a WebVTT downloadable for
//    every subtitle track (WebVTT is what the shared parser understands).
//  • On the RESPONSE side we pull `{ movieId, timedtexttracks }` out of the
//    parsed manifest and hand it to the isolated content script.
//  • It also fetches WebVTT files (page origin → passes the CDN's CORS) and
//    drives the player's `seek` on request.
//
// Ported from the approach used by competing extensions; every hook is wrapped
// in try/catch so a Netflix-side schema change can never break their JSON usage.

const MANIFEST_URL_RE = /manifest|licensedManifest/i;

// BFS: does this object tree contain a `url` that looks like a manifest request?
// Used to gate profile injection so we only ever touch manifest payloads.
function hasManifestUrl(root: unknown, limit = 500): boolean {
    if (!root || typeof root !== 'object') return false;
    const queue: unknown[] = [root];
    let seen = 0;
    while (queue.length && seen < limit) {
        const node = queue.shift();
        seen++;
        if (!node || typeof node !== 'object') continue;
        const obj = node as Record<string, unknown>;
        if (typeof obj.url === 'string' && MANIFEST_URL_RE.test(obj.url)) return true;
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v === 'object') queue.push(v);
        }
    }
    return false;
}

// Push the WebVTT profile into every `profiles` string-array in a manifest
// request object. Returns whether anything was changed.
function injectProfileIntoObject(root: unknown, profile = WEBVTT_PROFILE, limit = 500): boolean {
    if (!root || typeof root !== 'object' || !hasManifestUrl(root, limit)) return false;
    const queue: unknown[] = [root];
    let seen = 0;
    let changed = false;
    while (queue.length && seen < limit) {
        const node = queue.shift();
        seen++;
        if (!node || typeof node !== 'object') continue;
        const obj = node as Record<string, unknown>;
        const profiles = obj.profiles;
        if (Array.isArray(profiles) && profiles.length > 0 && profiles.every((p) => typeof p === 'string') && !profiles.includes(profile)) {
            profiles.push(profile);
            changed = true;
        }
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v === 'object') queue.push(v);
        }
    }
    return changed;
}

// String-level fallback: inject the profile straight into the serialized JSON if
// the object hook missed it (e.g. a frozen profiles array). The regex requires a
// non-empty string array (`"profiles":["`) and inserts before the first element,
// so it can never produce a trailing comma / invalid JSON on an empty array.
function injectProfileIntoString(json: string, profile = WEBVTT_PROFILE): string {
    if (
        typeof json !== 'string' ||
        json.indexOf(profile) !== -1 ||
        json.indexOf('"profiles":["') === -1 ||
        !/"url":"[^"]*(?:manifest|licensedManifest)/i.test(json)
    ) {
        return json;
    }
    return json.replace(/("profiles":\[)(")/, `$1"${profile}",$2`);
}

// Does this array look like a `timedtexttracks` list?
function looksLikeTracks(arr: unknown): boolean {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const first = arr[0];
    if (!first || typeof first !== 'object') return false;
    return 'downloadables' in first || 'ttDownloadables' in first || 'isNoneTrack' in first;
}

function findTracksArray(obj: Record<string, unknown>): unknown[] | null {
    if (looksLikeTracks(obj.timedtexttracks)) return obj.timedtexttracks as unknown[];
    if (looksLikeTracks(obj.textTracks)) return obj.textTracks as unknown[];
    for (const k of Object.keys(obj)) {
        if (looksLikeTracks(obj[k])) return obj[k] as unknown[];
    }
    return null;
}

// BFS: find a manifest node carrying a movieId and a timed-text track list.
function findManifestResult(root: unknown, nodeLimit = 2000): { movieId: string; tracks: unknown[] } | null {
    if (!root || typeof root !== 'object') return null;
    const queue: unknown[] = [root];
    let seen = 0;
    while (queue.length && seen < nodeLimit) {
        const node = queue.shift();
        seen++;
        if (!node || typeof node !== 'object') continue;
        const obj = node as Record<string, unknown>;
        const tracks = findTracksArray(obj);
        if ((typeof obj.movieId === 'number' || typeof obj.movieId === 'string') && tracks && tracks.length > 0) {
            return { movieId: String(obj.movieId), tracks };
        }
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v === 'object') queue.push(v);
        }
    }
    return null;
}

// A Netflix timed-text track descriptor. The "Off" entry is flagged isNoneTrack.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NflxTextTrack = { isNoneTrack?: boolean; displayName?: string; [k: string]: any };

// Reach into Netflix's player API for the active video player session.
function getVideoPlayer(): {
    seek?: (ms: number) => void;
    getTimedTextTrackList?: () => NflxTextTrack[];
    setTimedTextTrack?: (track: NflxTextTrack | null) => void;
} | null {
    try {
        const nf = (window as unknown as { netflix?: any }).netflix;
        const playerApp = nf?.appContext?.state?.playerApp ?? nf?.appContext?.getState?.()?.playerApp;
        const videoPlayer = playerApp?.getAPI?.()?.videoPlayer;
        if (!videoPlayer) return null;
        const ids: string[] =
            videoPlayer.getAllPlayerSessionIds?.() ?? videoPlayer.getAllPlayerSessionId?.() ?? [];
        if (!ids || ids.length === 0) return null;
        return videoPlayer.getVideoPlayerBySessionId?.(ids[ids.length - 1]) ?? null;
    } catch {
        return null;
    }
}

// Select Netflix's "Off" timed-text track. The player session and its track
// list may not exist yet when the overlay is toggled (or on a fresh episode),
// so retry a handful of times before giving up. Idempotent — re-selecting Off
// when it's already Off is a no-op.
const TAG_SUBS = '[NFLX-VTT hook]';
function forceNativeSubsOff(attempt = 0): void {
    const player = getVideoPlayer();
    const list = player?.getTimedTextTrackList?.();
    if (player && typeof player.setTimedTextTrack === 'function' && Array.isArray(list)) {
        const off = list.find((t) => t && t.isNoneTrack);
        if (off) {
            try {
                player.setTimedTextTrack(off);
                console.log(TAG_SUBS, 'native captions -> Off');
            } catch (e) {
                console.warn(TAG_SUBS, 'set-native-subs failed', e);
            }
            return;
        }
    }
    if (attempt < 10) {
        setTimeout(() => forceNativeSubsOff(attempt + 1), 500);
    } else {
        console.warn(TAG_SUBS, 'set-native-subs: player/track API never ready');
    }
}

export function installNetflixHook(): void {
    const w = window as unknown as { __lingogramNflxHook?: boolean };
    if (w.__lingogramNflxHook) return;
    w.__lingogramNflxHook = true;

    const TAG = '[NFLX-VTT hook]';
    const originalFetch = window.fetch.bind(window);
    // Cache the most recent manifest so a content script that attaches AFTER the
    // manifest was parsed (direct load onto /watch) can still get the tracks by
    // sending NFLX_QUERY — mirrors YouTube's YT_QUERY_CAPTIONS.
    let lastManifest: { movieId: string; tracks: unknown[] } | null = null;
    function broadcastManifest(): void {
        if (lastManifest) {
            window.postMessage(
                { type: 'NFLX_MANIFEST', movieId: lastManifest.movieId, tracks: lastManifest.tracks },
                '*',
            );
        }
    }

    // ---- request side: force the WebVTT profile ----
    const originalStringify = JSON.stringify;
    JSON.stringify = function (value: unknown, replacer?: unknown, space?: unknown) {
        try {
            injectProfileIntoObject(value);
        } catch {
            // ignore — never break Netflix's serialization
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let out = originalStringify.call(this, value as any, replacer as any, space as any);
        try {
            out = injectProfileIntoString(out);
        } catch {
            // ignore
        }
        return out;
    };

    // ---- response side: capture the track list ----
    const originalParse = JSON.parse;
    JSON.parse = function (text: string, reviver?: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = originalParse.call(this, text, reviver as any);
        try {
            const result = findManifestResult(value);
            if (result) {
                lastManifest = result;
                console.log(TAG, 'manifest captured for', result.movieId, '— tracks:', result.tracks.length);
                window.postMessage(
                    { type: 'NFLX_MANIFEST', movieId: result.movieId, tracks: result.tracks },
                    '*',
                );
            }
        } catch {
            // ignore
        }
        return value;
    };

    // ---- fetch a WebVTT file for the content script ----
    // The subtitle CDN (nflxvideo.net) answers with `Access-Control-Allow-Origin: *`
    // and carries its own auth token in the query string, so the request must be
    // credential-less: a wildcard ACAO is rejected by the browser when credentials
    // are included. (This is how Netflix's own player fetches these files.)
    async function fetchVtt(key: string, url: string): Promise<void> {
        try {
            const res = await originalFetch(url, { credentials: 'omit' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const text = await res.text();
            window.postMessage({ type: 'NFLX_VTT_RESULT', key, text }, '*');
        } catch (e) {
            console.warn(TAG, 'fetch failed for', key, e);
            window.postMessage({ type: 'NFLX_VTT_RESULT', key, text: '', error: String(e) }, '*');
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data) return;
        if (data.type === 'NFLX_QUERY') {
            broadcastManifest();
            return;
        }
        if (data.type === 'NFLX_FETCH_VTT' && typeof data.key === 'string' && typeof data.url === 'string') {
            void fetchVtt(data.key, data.url);
            return;
        }
        if (data.type === 'NFLX_SET_NATIVE_SUBS' && typeof data.enabled === 'boolean') {
            // Turn Netflix's own captions on/off at the source so they don't
            // stack behind our dual-subtitle overlay. We only force them OFF
            // (select the isNoneTrack); we never force them back ON — the user's
            // own caption choice is theirs to restore from Netflix's menu.
            if (data.enabled) return;
            forceNativeSubsOff();
            return;
        }
        if (data.type === 'NFLX_SEEK' && typeof data.time === 'number') {
            const player = getVideoPlayer();
            if (!player || typeof player.seek !== 'function') {
                console.warn(TAG, 'seek: no player available');
                return;
            }
            const ms = Math.round(data.time * 1000);
            try {
                player.seek(ms);
                console.log(TAG, 'seek ->', ms, 'ms');
            } catch (e) {
                console.warn(TAG, 'seek failed', e);
            }
        }
    });

    console.log(TAG, 'installed');
}
