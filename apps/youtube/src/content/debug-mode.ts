// ── The isolated world's entry point for the diagnostics recorder ───────────
//
// Everything dev-only about the feature is reachable only from here, and this
// module's two exported functions both fold to nothing in a production build:
// `installDebugMode` returns immediately, and `traceRecorder()` returns null
// forever because the only thing that sets the module-level `recorder` is
// inside the guard.
//
// That shape is deliberate — the guard sits at the top of a function whose
// result lands in a module-level binding, which is what the minifier can
// actually prove constant. A guard inside a method that production still calls
// would leave the machinery in the bundle. See packages/shared/docs/dev-flags.md.
import { loadPrefs, onPrefsChanged } from '@video-transcripts/shared';
import type { BaseVttApp } from './app-base';
import { chromeStorage, TraceRecorder } from './debug-recorder';
import { DEBUG_HELLO, DEBUG_STATE, isDebugBatch } from './debug-bridge';
import { saveLogCount } from '../../../../packages/shared/src/debug/save-log';

/**
 * The live recorder, or null when this is not a dev build.
 *
 * A module-level binding rather than a parameter threaded through app-base and
 * index: the call sites are a dozen one-liners spread across a 1600-line base
 * class shared with Rezka and Netflix, and threading a diagnostics sink through
 * all of them would put a YouTube-only concern into every one of their
 * signatures. This is the case where a module global is the smaller cost —
 * and it stays provably null in production.
 */
let recorder: TraceRecorder | null = null;

export function traceRecorder(): TraceRecorder | null {
    return recorder;
}

/**
 * Stand the recorder up, if this is a dev build.
 *
 * Returns without touching anything in production — and because `recorder` is
 * then never assigned, every `traceRecorder()?.record(...)` call site in the
 * hot path is a null check the minifier can fold away.
 */
export function installDebugMode(app: BaseVttApp): void {
    if (__EXT_ENV__ !== 'dev') return;

    const storage = chromeStorage();
    if (!storage) return; // not an extension context (tests, embed)

    // The word-save count the settings readout shows: loaded now so the first
    // open of the panel does not read it before storage has answered.
    saveLogCount();

    // Tell the MAIN world whether to record, and which epoch to stamp against.
    // It cannot read storage itself — it has no chrome.* at all.
    //
    // A hoisted declaration, not a const: the recorder is handed this as its
    // session-start hook below, and the hook has to exist before the recorder
    // that calls it is constructed.
    function announce(): void {
        window.postMessage(
            { type: DEBUG_STATE, on: rec.isEnabled(), startedAt: rec.sessionStartedAt() },
            '*',
        );
    }

    // `onSessionStart` is what keeps the MAIN world's epoch current across an
    // SPA navigation: index.ts opens sessions on a video change and has no
    // reference to this world's announcement. See RecorderDeps.
    const rec = new TraceRecorder({ storage, onSessionStart: () => announce() });
    recorder = rec;

    // The MAIN world says hello at document_start and again after an extension
    // reload, which is the case that matters: a reload orphans this world and
    // leaves that one running with a stale answer.
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if ((event.data as { type?: string })?.type === DEBUG_HELLO) {
            announce();
            return;
        }
        if (isDebugBatch(event.data)) rec.ingestFromMain(event.data.events);
    });

    void (async () => {
        await rec.hydrate();
        const prefs = await loadPrefs();
        rec.setEnabled(prefs.debugMode);
        // A session for whatever is already playing: installDebugMode runs at
        // document_idle, by which time checkCurrentVideo may already have
        // claimed this video and will not open one.
        const videoId = app.getVideoId();
        if (prefs.debugMode && videoId) rec.startSession(videoId, location.href);
        announce();
    })();

    onPrefsChanged((p) => {
        const was = rec.isEnabled();
        rec.setEnabled(p.debugMode);
        if (was !== p.debugMode) {
            const videoId = app.getVideoId();
            if (p.debugMode && videoId) rec.startSession(videoId, location.href);
            announce();
        }
    });

    // The two moments after which this page may not exist. A trace that is
    // still sitting in the debounce window when the tab closes is a trace of
    // exactly the failure the user was about to go and read.
    window.addEventListener('pagehide', () => void rec.flush());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void rec.flush();
    });
}
