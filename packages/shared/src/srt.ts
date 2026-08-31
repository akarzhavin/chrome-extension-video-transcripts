// Serialize loaded subtitle tracks to SRT — the format the download button hands
// the user.
//
// SRT, not the WebVTT the tracks often arrived as: every desktop player, every
// Anki/subs2srs-style workflow and every online translator reads SRT, while VTT
// support is spottier outside the browser. The internal Subtitle[] shape is
// already format-neutral (seconds + text), so there is nothing to preserve from
// the wire format — cue positioning (`line`) is deliberately dropped, since it
// only ever existed to reconstruct Netflix's two-cue captions for our own
// overlay.
import { Subtitle, Track } from './types';

/** `HH:MM:SS,mmm` — SRT's timestamp, comma before the milliseconds. */
function srtTime(seconds: number): string {
    // Negative times shouldn't reach here, but a clamp costs nothing and keeps
    // a bad cue from producing a file players refuse wholesale.
    const ms = Math.round(Math.max(0, seconds) * 1000);
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
 * Cues are emitted in time order and renumbered from 1: a track assembled from
 * Netflix's out-of-order cue pairs is stored in file order, and a player that
 * meets descending timestamps stops rendering the rest of the file.
 *
 * Blank cues are dropped rather than written as empty blocks — an empty cue is
 * legal SRT but shows as a caption-shaped gap in players that honour it.
 */
export function toSrt(subtitles: Subtitle[]): string {
    const cues = subtitles
        .filter((s) => s.text.trim())
        .slice()
        .sort((a, b) => a.startTime - b.startTime);

    return cues
        .map((sub, i) => {
            // An end at or before the start makes the cue vanish; give it a
            // minimum on-screen span instead of emitting an unplayable block.
            const end = sub.endTime > sub.startTime ? sub.endTime : sub.startTime + 1;
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
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

    const title = clean(pageTitle).slice(0, 80) || 'subtitles';
    const track = clean(trackName).slice(0, 40);
    return track ? `${title}.${track}.srt` : `${title}.srt`;
}

/** True when the track carries at least one cue worth writing to a file. */
export function isDownloadable(track: Track | undefined): boolean {
    return !!track?.subtitles.some((s) => s.text.trim());
}
