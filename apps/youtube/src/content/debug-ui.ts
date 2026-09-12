// ── Getting the trace out of the browser ────────────────────────────────────
//
// A small control in the corner of the page, visible only while the recorder is
// on. Deliberately the same shape as the #vtt-export button next to it (which
// sits at bottom:16px; this one stacks above at bottom:64px so both can be open
// at once), including the no-permission download: a Blob URL on an <a download>,
// which needs nothing in the manifest.
//
// The session count on the button is the one piece of feedback that says the
// recorder is alive without opening anything.
import type { TraceRecorder } from './debug-recorder';

const PANEL_ID = 'vtt-debug-panel';

/** Filename-safe timestamp: 20260912-174233. */
function stamp(d = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
}

/** The same primitive subs-export.ts uses — no `downloads` permission needed. */
function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

function reportText(rec: TraceRecorder): string {
    let version = 'unknown';
    try {
        version = chrome.runtime.getManifest().version;
    } catch {
        // Orphaned context — the trace is still worth reading.
    }
    return JSON.stringify(rec.report({ version, ua: navigator.userAgent }), null, 2);
}

function button(label: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = [
        'padding:8px 12px',
        'border:1px solid rgba(255,255,255,0.2)',
        'border-radius:8px',
        'background:#3f2d80',
        'color:#fff',
        'font:600 12px/1.2 system-ui,sans-serif',
        'cursor:pointer',
    ].join(';');
    return b;
}

/**
 * Build (or remove) the panel to match the recorder's state.
 *
 * Idempotent, and safe to call on every toggle change and SPA navigation — the
 * same discipline watchSubsExport() follows, because YouTube tears its DOM
 * down underneath both of them.
 */
export function installDebugPanel(rec: TraceRecorder): void {
    if (__EXT_ENV__ !== 'dev') return;

    const existing = document.getElementById(PANEL_ID);
    if (!rec.isEnabled()) {
        existing?.remove();
        return;
    }
    if (existing) return;
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', () => installDebugPanel(rec), { once: true });
        return;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
        'position:fixed',
        'left:16px',
        'bottom:64px',
        'z-index:2147483647',
        'display:flex',
        'gap:6px',
        'align-items:center',
        'padding:6px',
        'border-radius:10px',
        'background:rgba(20,16,40,0.92)',
        'box-shadow:0 6px 20px rgba(0,0,0,0.35)',
    ].join(';');

    const dl = button('', 'Download the recorded subtitle diagnostics as JSON');
    const relabel = (): void => {
        dl.textContent = `⬇ Trace (${rec.sessions().length})`;
    };
    relabel();

    const flash = (text: string): void => {
        dl.textContent = text;
        setTimeout(relabel, 2000);
    };

    dl.addEventListener('click', () => {
        void rec.flush();
        const sessions = rec.sessions();
        if (sessions.length === 0) {
            flash('nothing recorded yet');
            return;
        }
        const current = sessions[sessions.length - 1];
        download(`lingogram-trace-${current.videoId}-${stamp()}.json`, reportText(rec));
    });

    const copy = button('⧉', 'Copy the trace to the clipboard');
    copy.addEventListener('click', () => {
        const text = reportText(rec);
        void navigator.clipboard
            ?.writeText(text)
            .then(() => flash('✓ copied'))
            // writeText rejects on a page without focus, and there is nothing
            // to do about it here — say so rather than appearing to succeed.
            .catch(() => flash('clipboard blocked'));
    });

    const clear = button('✕', 'Discard everything recorded so far');
    clear.style.background = 'rgba(180,60,60,0.85)';
    clear.addEventListener('click', () => {
        void rec.clear().then(relabel);
    });

    panel.append(dl, copy, clear);
    document.body.appendChild(panel);
}
