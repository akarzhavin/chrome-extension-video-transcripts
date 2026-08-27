import { Subtitle } from './types';

export function parseVTT(vttString: string): Subtitle[] {
    const subtitles: Subtitle[] = [];
    // Split text into blocks (empty lines)
    // Support \r\n or \n
    const blocks = vttString.split(/(?:\r?\n){2,}/); 
    
    // Regex to capture timecodes
    const timeRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/;

    blocks.forEach(block => {
        const match = block.match(timeRegex);
        if (match) {
            // Parse start time
            const startH = match[1] ? parseInt(match[1]) : 0;
            const startM = parseInt(match[2]);
            const startS = parseInt(match[3]);
            const startMs = parseInt(match[4]);
            const startTime = (startH * 3600) + (startM * 60) + startS + (startMs / 1000);

            // Parse end time
            const endH = match[5] ? parseInt(match[5]) : 0;
            const endM = parseInt(match[6]);
            const endS = parseInt(match[7]);
            const endMs = parseInt(match[8]);
            const endTime = (endH * 3600) + (endM * 60) + endS + (endMs / 1000);

            // Extract text: the cue text starts on the line AFTER the timecode.
            // The rest of the timecode line holds WebVTT cue settings
            // (e.g. "position:50.00%,middle align:middle size:80.00% line:79.33%"),
            // which streaming services like Netflix append after the timestamps.
            // They are not part of the caption text, so they stay out of it —
            // but `line` is read off first, because it is the only record of
            // where a cue sat vertically.
            if (match.index === undefined) return;
            const afterTime = block.substring(match.index + match[0].length);
            const newlineIdx = afterTime.indexOf('\n');
            const settings = newlineIdx === -1 ? afterTime : afterTime.substring(0, newlineIdx);
            const textPart = newlineIdx === -1 ? '' : afterTime.substring(newlineIdx + 1);
            // also clean HTML tags (like <b>, <i>, <v Name>)
            const text = textPart.trim().replace(/<[^>]+>/g, '');

            // Percentage form only ("line:84.62%"). WebVTT also allows a line
            // NUMBER ("line:-1"), which counts rows from the bottom and would
            // sort the opposite way; no source we read emits it, and guessing
            // which form a bare number is would be worse than ignoring it.
            const lineMatch = settings.match(/\bline:(-?[\d.]+)%/);
            const line = lineMatch ? parseFloat(lineMatch[1]) : undefined;

            if (text) {
                subtitles.push(
                    line === undefined
                        ? { startTime, endTime, text }
                        : { startTime, endTime, text, line },
                );
            }
        }
    });
    return subtitles;
}
