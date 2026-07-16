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
            // Drop whatever remains on the timecode line — WebVTT cue settings
            // (e.g. "position:50.00%,middle align:middle size:80.00% line:79.33%"),
            // which streaming services like Netflix append after the timestamps.
            if (match.index === undefined) return;
            const afterTime = block.substring(match.index + match[0].length);
            const newlineIdx = afterTime.indexOf('\n');
            const textPart = newlineIdx === -1 ? '' : afterTime.substring(newlineIdx + 1);
            // also clean HTML tags (like <b>, <i>, <v Name>)
            const text = textPart.trim().replace(/<[^>]+>/g, '');

            if (text) {
                subtitles.push({ startTime, endTime, text });
            }
        }
    });
    return subtitles;
}
