// ── Getting the trace out of the browser ────────────────────────────────────
//
// The two primitives behind the diagnostics rows in the settings panel:
// serialising the recording, and handing it to the browser as a download.
//
// These were the guts of a small control fixed in the corner of the page. It
// worked, and its cost was structural rather than aesthetic: a floating panel
// over a video player covers the player, and the player is the thing a
// subtitle trace is being taken of. The actions now live under the switch that
// turns the recorder on (SidebarUI.buildTraceActionRows, reached through
// AppInterface.traceActions), where they cover nothing and sit next to the
// text that explains what they act on.
//
// The download is deliberately permission-free: a Blob URL on an <a download>,
// which needs nothing in the manifest — the same primitive subs-export.ts uses.
import {
    downloadText,
    fileStamp as stamp,
    loadSaveLog,
    saveLogReport,
} from '../../../../packages/shared/src/debug/save-log';
import type { TraceRecorder } from './debug-recorder';

/**
 * The recording as pretty JSON, stamped with the build it came from.
 *
 * Carries the word-save log as `saves` (debug/save-log.ts): one switch, one
 * file. Async because that log lives in storage, not in the recorder.
 */
export async function traceReportText(rec: TraceRecorder): Promise<string> {
    let version = 'unknown';
    try {
        version = chrome.runtime.getManifest().version;
    } catch {
        // Orphaned context — the trace is still worth reading.
    }
    const saves = saveLogReport(await loadSaveLog());
    return JSON.stringify(rec.report({ version, ua: navigator.userAgent, saves }), null, 2);
}

/**
 * Save the recording as a JSON file named after the video it covers.
 *
 * Caller flushes first: the ring buffer debounces its writes, and the last
 * events are usually the interesting ones.
 */
export async function downloadTrace(rec: TraceRecorder): Promise<void> {
    const sessions = rec.sessions();
    // No video recorded is no longer an empty file: word saves may be in it.
    const current = sessions[sessions.length - 1];
    const text = await traceReportText(rec);
    const name = current ? `lingogram-trace-${current.videoId}` : 'lingogram-trace';
    downloadText(text, `${name}-${stamp()}.json`);
}
