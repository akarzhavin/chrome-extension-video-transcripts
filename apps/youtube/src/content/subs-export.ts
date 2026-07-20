// Dev-only subtitle export, behind a URL flag.
//
// Loading a watch page with `#vtt-export` in the URL adds a button that
// downloads EVERY caption track available for the video — the video's own
// tracks plus YouTube's auto-translations into every language the extension
// supports — shaped like the site's apps/site/src/data/demo-subs.json. The hero
// demo needs real tracks for its chosen video, and this captures them without
// re-implementing YouTube's caption endpoints outside the extension.
//
// It reuses the extension's own MAIN-world bridge (page-script.ts): the track
// catalog arrives as YT_CAPTIONS_FOUND, each track is fetched with YT_FETCH_VTT
// and comes back as YT_VTT_RESULT — the same path the sidebar uses, so anything
// the extension can read, this can export.
//
// Inert for real users: nothing runs without the literal token in the URL.
import { AppState, SUPPORTED_LANGUAGES } from '@video-transcripts/shared';
import { parseJson3 } from './json3';
import type { CaptionTrack } from './trackPlan';

const BUTTON_ID = 'vtt-export-btn';

// Auto-translation targets: every language the extension supports
// (languages.ts), minus the ones the video already ships as real tracks.
// YouTube can translate into ~130 languages, but only the supported set is
// useful here — those are the pairs the product can actually be used with.
function translateTargets(available: CaptionTrack[]): string[] {
    return SUPPORTED_LANGUAGES.map((l) => l.code).filter(
        (code) => !available.some((t) => t.lang === code || t.lang.startsWith(code + '-')),
    );
}

// Read live, not once at module load: the flag is usually appended to an
// already-open tab, and a hash change doesn't re-run the content script.
export function exportModeOn(): boolean {
    return location.href.includes('vtt-export');
}

interface ExportedLine {
    startTime: number;
    endTime: number;
    text: string;
}

interface ExportedTrack {
    name: string;
    lang: string;
    kind?: string;
    /** True when the track is YouTube's machine translation, not a real track. */
    translated?: boolean;
    lines: ExportedLine[];
}

const round = (n: number): number => Math.round(n * 100) / 100;

// Latest catalog seen for the current video, captured from the extension's own
// MAIN-world broadcast.
let catalog: { videoId: string; tracks: CaptionTrack[] } | null = null;

function watchCatalog(): void {
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const d = event.data;
        if (d?.type === 'YT_CAPTIONS_FOUND' && Array.isArray(d.tracks)) {
            catalog = { videoId: String(d.videoId), tracks: d.tracks as CaptionTrack[] };
        }
    });
    // The catalog may already have been broadcast before this listener existed.
    window.postMessage({ type: 'YT_QUERY_CAPTIONS' }, '*');
}

/**
 * Fetch one track through the page-script bridge. `tlang` asks YouTube to
 * machine-translate the track into that language.
 */
function fetchTrack(track: CaptionTrack, videoId: string, tlang?: string): Promise<ExportedLine[]> {
    return new Promise((resolve) => {
        const key = `export:${track.lang}:${tlang ?? 'orig'}:${Date.now()}`;
        const timer = setTimeout(() => {
            window.removeEventListener('message', onMessage);
            resolve([]); // a track that doesn't answer is skipped, not fatal
        }, 15000);

        function onMessage(event: MessageEvent): void {
            if (event.source !== window) return;
            const d = event.data;
            if (d?.type !== 'YT_VTT_RESULT' || d.url !== key) return;
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            resolve(
                parseJson3(d.text || '').map((s) => ({
                    startTime: round(s.startTime),
                    endTime: round(s.endTime),
                    text: s.text.replace(/\s+/g, ' ').trim(),
                })),
            );
        }

        window.addEventListener('message', onMessage);
        window.postMessage(
            { type: 'YT_FETCH_VTT', url: key, baseUrl: track.baseUrl, videoId, tlang },
            '*',
        );
    });
}

function currentVideoId(): string {
    return new URLSearchParams(location.search).get('v') ?? catalog?.videoId ?? 'unknown';
}

/** Everything the site's demo-subs.json needs, plus the extra tracks. */
function buildPayload(videoId: string, tracks: ExportedTrack[]) {
    const all = tracks.flatMap((t) => t.lines);
    return {
        _comment:
            'Exported from the extension via #vtt-export. startTime/endTime are seconds on the real video clock. Keep the two tracks you want in the demo and drop the rest.',
        youtubeVideoId: videoId,
        windowStart: all.length ? round(Math.min(...all.map((l) => l.startTime))) : 0,
        windowEnd: all.length ? round(Math.max(...all.map((l) => l.endTime))) : 0,
        tracks,
    };
}

function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

async function exportAll(state: AppState, setLabel: (s: string) => void): Promise<void> {
    const videoId = currentVideoId();
    const available = catalog?.tracks ?? [];

    if (!available.length) {
        // No catalog (yet): fall back to whatever the sidebar already parsed, so
        // the button still yields something useful.
        const loaded = state.tracks
            .filter((t) => t.subtitles.length)
            .map<ExportedTrack>((t) => ({
                name: t.name,
                lang: '',
                lines: t.subtitles.map((s) => ({
                    startTime: round(s.startTime),
                    endTime: round(s.endTime),
                    text: s.text.replace(/\s+/g, ' ').trim(),
                })),
            }));
        if (!loaded.length) {
            setLabel('No tracks found yet');
            return;
        }
        download(`demo-subs-${videoId}.json`, JSON.stringify(buildPayload(videoId, loaded), null, 2));
        setLabel(`✓ ${loaded.length} loaded tracks`);
        return;
    }

    const jobs: Array<{ track: CaptionTrack; tlang?: string }> = available.map((track) => ({ track }));
    if (available[0]) {
        const source = available[0];
        for (const tlang of translateTargets(available)) {
            if (available.some((t) => t.lang === tlang || t.lang.startsWith(tlang + '-'))) continue;
            jobs.push({ track: source, tlang });
        }
    }

    const out: ExportedTrack[] = [];
    for (let i = 0; i < jobs.length; i++) {
        const { track, tlang } = jobs[i];
        setLabel(`Fetching ${i + 1}/${jobs.length}…`);
        const lines = await fetchTrack(track, videoId, tlang);
        if (!lines.length) continue;
        out.push({
            name: tlang ? `${track.name} → ${tlang}` : track.name,
            lang: tlang ?? track.lang,
            kind: track.kind,
            translated: tlang ? true : undefined,
            lines,
        });
    }

    if (!out.length) {
        setLabel('No tracks could be fetched');
        return;
    }
    download(`demo-subs-${videoId}.json`, JSON.stringify(buildPayload(videoId, out), null, 2));
    setLabel(`✓ ${out.length} tracks`);
}

/**
 * Install the export button. Safe to call repeatedly (YouTube is an SPA); it
 * reads the live catalog and AppState at click time.
 */
export function installSubsExport(state: AppState): void {
    if (!exportModeOn() || document.getElementById(BUTTON_ID)) return;
    if (!document.body) {
        // content_scripts run at document_start on YouTube.
        document.addEventListener('DOMContentLoaded', () => installSubsExport(state), { once: true });
        return;
    }

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    const idle = '⬇ Export all subs';
    btn.textContent = idle;
    btn.style.cssText = [
        'position:fixed',
        'left:16px',
        'bottom:16px',
        'z-index:2147483647',
        'padding:10px 16px',
        'border:1px solid rgba(255,255,255,0.2)',
        'border-radius:10px',
        'background:#5b3fbf',
        'color:#fff',
        'font:600 13px/1.2 system-ui,sans-serif',
        'cursor:pointer',
        'box-shadow:0 6px 20px rgba(0,0,0,0.35)',
    ].join(';');

    const setLabel = (s: string): void => {
        btn.textContent = s;
        if (s.startsWith('✓') || s.startsWith('No')) {
            setTimeout(() => (btn.textContent = idle), 2500);
        }
    };

    btn.addEventListener('click', () => {
        btn.disabled = true;
        void exportAll(state, setLabel).finally(() => (btn.disabled = false));
    });

    document.body.appendChild(btn);
}

/**
 * Watch for the flag being added to a tab that is already open (hash change or
 * SPA navigation), so the button appears without a reload.
 */
export function watchSubsExport(state: AppState): void {
    if (exportModeOn()) watchCatalog();
    const tryInstall = () => installSubsExport(state);
    tryInstall();
    window.addEventListener('hashchange', () => {
        if (exportModeOn() && !catalog) watchCatalog();
        tryInstall();
    });
    document.addEventListener('yt-navigate-finish', tryInstall);
}
