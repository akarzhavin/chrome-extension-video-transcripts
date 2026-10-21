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

    // Some tracks send every event twice and no field tells the copies apart: drop an exact
    // repeat of the last kept cue (so longer runs collapse too).
    const deduped: Subtitle[] = [];
    for (const sub of subs) {
        const prev = deduped[deduped.length - 1];
        const isRepeat = prev
            && prev.startTime === sub.startTime
            && prev.endTime === sub.endTime
            && prev.text === sub.text;
        if (!isRepeat) deduped.push(sub);
    }

    // YouTube ASR events often overlap (event N's endTime extends past event N+1's startTime).
    // Cap each endTime to the next event's startTime so highlight lookup picks the right one.
    // After dedup: capping first would end a duplicate where its twin starts, so they'd differ.
    for (let i = 0; i < deduped.length - 1; i++) {
        if (deduped[i].endTime > deduped[i + 1].startTime) {
            deduped[i].endTime = Math.max(deduped[i].startTime, deduped[i + 1].startTime - 0.001);
        }
    }
    return deduped;
}
