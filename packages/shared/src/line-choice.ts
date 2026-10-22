// What a viewer picked for the lines of one video: the first line's language,
// the second line's, or neither. Every video starts from the viewer's
// languages (set on the site's extension page); a pick in the sidebar holds
// for that video only, across reloads, and never changes those languages.
//
// Kept in chrome.storage.local and mirrored in memory, so the pair for a
// video is known at once, before its tracks are planned.

import type { LanguagePrefs } from './languages';

const KEY = 'lineChoice.v1';
/** The videos remembered, the oldest picks dropped first. */
const KEEP = 300;

export interface LineChoice {
    /** The first line's language code, in place of the learning one. */
    first?: string;
    /** The second line's language code, in place of the native one. */
    second?: string;
}

interface Entry extends LineChoice {
    at: number;
}

let cache: Record<string, Entry> = {};
let watching = false;

function parse(raw: unknown): Record<string, Entry> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, Entry> = {};
    for (const [video, e] of Object.entries(raw as Record<string, unknown>)) {
        if (!e || typeof e !== 'object') continue;
        const { first, second, at } = e as Record<string, unknown>;
        const entry: Entry = { at: typeof at === 'number' ? at : 0 };
        if (typeof first === 'string' && first) entry.first = first;
        if (typeof second === 'string' && second) entry.second = second;
        if (entry.first || entry.second) out[video] = entry;
    }
    return out;
}

/** Reads the picks into memory and follows changes from other tabs. */
export async function loadLineChoices(): Promise<void> {
    try {
        cache = parse((await chrome.storage.local.get(KEY))[KEY]);
    } catch {
        cache = {};
    }
    if (watching) return;
    watching = true;
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && KEY in changes) cache = parse(changes[KEY].newValue);
        });
    } catch {
        /* orphaned context */
    }
}

/** The pick for a video ("youtube:dQw4…", "netflix:7004…"); null when none. */
export function lineChoiceFor(video: string | null): LineChoice | null {
    if (!video) return null;
    const e = cache[video];
    return e ? { first: e.first, second: e.second } : null;
}

/** Sets one line's language for a video; null puts the viewer's own back. */
export function chooseLineFor(video: string, line: 'first' | 'second', code: string | null): void {
    const e: Entry = { ...(cache[video] ?? {}), at: Date.now() };
    if (code) e[line] = code;
    else delete e[line];
    const next = { ...cache };
    if (e.first || e.second) next[video] = e;
    else delete next[video];
    const kept = Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP);
    cache = Object.fromEntries(kept);
    void chrome.storage.local.set({ [KEY]: cache }).catch(() => undefined);
}

/** The pair a video shows: the viewer's languages, with that video's picks over them. */
export function pairFor(prefs: LanguagePrefs | null, choice: LineChoice | null): LanguagePrefs | null {
    if (!prefs) return null;
    let learning = choice?.first ?? prefs.learning;
    let native = choice?.second ?? prefs.native;
    // One language on both lines is no pair: the line not picked takes the
    // viewer's other language (English → Русский, first picked Русский:
    // Русский → English).
    if (native === learning) {
        const other = (code: string) => (prefs.learning === code ? prefs.native : prefs.learning);
        if (choice?.second) learning = other(native);
        else native = other(learning);
    }
    return { learning, native };
}

/** For tests: forget what is in memory. */
export function resetLineChoices(): void {
    cache = {};
}
