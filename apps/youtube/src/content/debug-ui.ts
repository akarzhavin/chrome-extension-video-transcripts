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
import type { TraceRecorder } from './debug-recorder';

/** Filename-safe timestamp: 20260912-174233. */
function stamp(d = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
}

/** The recording as pretty JSON, stamped with the build it came from. */
export function traceReportText(rec: TraceRecorder): string {
    let version = 'unknown';
    try {
        version = chrome.runtime.getManifest().version;
    } catch {
        // Orphaned context — the trace is still worth reading.
    }
    return JSON.stringify(rec.report({ version, ua: navigator.userAgent }), null, 2);
}

/**
 * Save the recording as a JSON file named after the video it covers.
 *
 * Caller flushes first: the ring buffer debounces its writes, and the last
 * events are usually the interesting ones.
 */
export function downloadTrace(rec: TraceRecorder): void {
    const sessions = rec.sessions();
    if (sessions.length === 0) return;
    const current = sessions[sessions.length - 1];
    const text = traceReportText(rec);

    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `lingogram-trace-${current.videoId}-${stamp()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
