// Everything behind "Download subtitles": turning a loaded track into an SRT
// file and handing it to the browser.
//
// One module rather than logic spread across the UI classes that offer the
// action. There are two entry points — the sidebar header button and the
// YouTube player menu row — and both want the same three answers: is there
// anything to download, what does the file contain, and what is it called. A
// caller needs `downloadTrack` and `isDownloadable`; nothing else about the
// format leaks out.
//
// SRT, not the WebVTT the tracks often arrived as: every desktop player, every
// Anki/subs2srs-style workflow and every online translator reads SRT, while VTT
// support is spottier outside the browser. The internal Subtitle[] shape is
// already format-neutral (seconds + text), so there is nothing to preserve from
// the wire format — cue positioning (`line`) is deliberately dropped, since it
// only ever existed to reconstruct Netflix's two-cue captions for our own
// overlay.
import { trackVia } from './analytics';
import { Subtitle, Track } from './types';

/** Span given to a cue whose end is missing or not after its start. */
const MIN_CUE_SECONDS = 1;

/** `HH:MM:SS,mmm` — SRT's timestamp, comma before the milliseconds. */
function srtTime(seconds: number): string {
    // Negative and non-finite times shouldn't reach here, but one bad cue
    // otherwise writes `NaN:NaN:NaN,NaN` and players reject the whole file
    // rather than the block. `Math.max` alone does NOT cover this: max(0, NaN)
    // is NaN, so the non-finite case needs its own test.
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const ms = Math.round(safe * 1000);
    const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
    return (
        `${pad(Math.floor(ms / 3600000))}:` +
        `${pad(Math.floor(ms / 60000) % 60)}:` +
        `${pad(Math.floor(ms / 1000) % 60)},` +
        `${pad(ms % 1000, 3)}`
    );
}

/**
 * One SRT document for the given cues.
 *
 * Cues are emitted in time order and renumbered from 1: a player that meets
 * descending timestamps stops rendering the rest of the file, so the order is
 * enforced here rather than assumed of every caller upstream.
 *
 * Blank cues are dropped rather than written as empty blocks — an empty cue is
 * legal SRT but shows as a caption-shaped gap in players that honour it.
 */
export function toSrt(subtitles: Subtitle[]): string {
    const cues = subtitles
        .filter((s) => s.text.trim())
        .sort((a, b) => a.startTime - b.startTime);

    return cues
        .map((sub, i) => {
            // An end at or before the start makes the cue vanish; give it a
            // minimum on-screen span instead of emitting an unplayable block —
            // but never past the next cue's start, or the two render stacked on
            // top of each other.
            const next = cues[i + 1];
            const filled =
                next === undefined
                    ? sub.startTime + MIN_CUE_SECONDS
                    : Math.min(
                          sub.startTime + MIN_CUE_SECONDS,
                          Math.max(sub.startTime, next.startTime),
                      );
            const end = sub.endTime > sub.startTime ? sub.endTime : filled;
            // CRLF inside the block, per the format as players actually expect
            // it; the text's own newlines are normalized to match.
            const text = sub.text.replace(/\r\n|\r|\n/g, '\r\n').trim();
            return `${i + 1}\r\n${srtTime(sub.startTime)} --> ${srtTime(end)}\r\n${text}\r\n`;
        })
        .join('\r\n');
}

/**
 * Filename for a track's download: `<page title>.<track name>.srt`, with
 * everything a filesystem objects to replaced.
 *
 * The page title is what the user recognizes — "the file I just downloaded" is
 * found by the video's name, not by a video id.
 */
export function srtFileName(pageTitle: string, trackName: string): string {
    const clean = (s: string): string =>
        s
            // Path separators, the Windows-reserved set, and control characters.
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/[\x00-\x1f\x7f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            // A name of nothing but dots, or one starting with a dot, is a
            // hidden file on macOS and Linux; Windows silently strips trailing
            // ones. Stripping both ends leaves the fallback below to catch a
            // title that was only dots.
            .replace(/^\.+/, '')
            .replace(/\.+$/, '')
            .trim();

    const title = clean(pageTitle).slice(0, 80) || 'subtitles';
    const track = clean(trackName).slice(0, 40);
    return track ? `${title}.${track}.srt` : `${title}.srt`;
}

/**
 * True when the track carries at least one cue worth writing to a file.
 *
 * A type predicate, so the callers that check before reading `track.name` or
 * `track.subtitles` get the narrowing for free instead of asserting it.
 */
export function isDownloadable(track: Track | undefined): track is Track {
    return !!track?.subtitles.some((s) => s.text.trim());
}

/**
 * Write a track to the user's downloads as `.srt`, and record the event.
 *
 * A no-op for a track with nothing in it, so a caller can wire this straight to
 * a click without repeating the check its disabled state already made — the two
 * can disagree for a frame while tracks are still arriving.
 *
 * `pageTitle` and `site` are arguments rather than reads of `document.title`
 * and the hostname: both callers already hold them, and taking them in keeps
 * this callable without standing up the globals they come from.
 */
export function downloadTrack(track: Track | undefined, pageTitle: string, site: string): void {
    if (!isDownloadable(track)) return;

    const url = URL.createObjectURL(
        new Blob([toSrt(track.subtitles)], { type: 'text/plain;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = srtFileName(pageTitle, track.name);
    // Firefox-style engines only honour a click on a connected node; Chrome
    // does not care, and the node is gone before paint either way.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next frame: revoking synchronously races the download the
    // click just started.
    setTimeout(() => URL.revokeObjectURL(url), 0);

    trackVia('subs_downloaded', { site });
}
