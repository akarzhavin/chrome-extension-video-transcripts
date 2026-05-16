import type { Subtitle } from '@video-transcripts/shared';

interface Json3Segment {
    utf8?: string;
}

interface Json3Event {
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Json3Segment[];
}

interface Json3Response {
    events?: Json3Event[];
}

export function parseJson3(jsonText: string): Subtitle[] {
    if (!jsonText) return [];
    let data: Json3Response;
    try {
        data = JSON.parse(jsonText);
    } catch {
        return [];
    }
    if (!data?.events) return [];

    const subs: Subtitle[] = [];
    for (const e of data.events) {
        if (!e.segs || e.tStartMs === undefined) continue;
        const text = e.segs
            .map((s) => s.utf8 || '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) continue;
        const startTime = e.tStartMs / 1000;
        const endTime = startTime + (e.dDurationMs ?? 0) / 1000;
        subs.push({ startTime, endTime, text });
    }

    // YouTube ASR events often overlap (event N's endTime extends past event N+1's startTime).
    // Cap each endTime to the next event's startTime so highlight lookup picks the right one.
    for (let i = 0; i < subs.length - 1; i++) {
        if (subs[i].endTime > subs[i + 1].startTime) {
            subs[i].endTime = Math.max(subs[i].startTime, subs[i + 1].startTime - 0.001);
        }
    }
    return subs;
}
