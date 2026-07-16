import {
    labelForLanguage,
    LanguageChoice,
    LanguagePrefs,
    SUPPORTED_LANGUAGES,
} from '@video-transcripts/shared';

// Netflix serves subtitle tracks in several profiles. We force this WebVTT
// profile into the manifest request (see manifest-hook.ts) so every track
// exposes a WebVTT downloadable — the format the shared `parseVTT` understands.
export const WEBVTT_PROFILE = 'webvtt-lssdh-ios8';

// Is this manifest the one for what the user is watching right now?
//
// Netflix keeps the manifest's movieId and /watch/<id> in sync, so anything else
// is a manifest for another title. `urlId` is null off a /watch page: that is a
// mismatch, not a free pass — the hook answers an unnamed query with its newest
// capture, so accepting a null urlId let a reply arriving just after the user
// left a title strand currentMovieId on it and fetch its WebVTTs.
export function isManifestForCurrentTitle(
    movieId: string | null | undefined,
    urlId: string | null | undefined,
): boolean {
    return !!movieId && movieId === urlId;
}

// A single downloadable inside a track's `ttDownloadables` map. Netflix has used
// two shapes over time: a `downloadUrls` map keyed by CDN id, and a `urls` array.
interface Downloadable {
    downloadUrls?: Record<string, string>;
    urls?: Array<{ url?: string; cdnId?: string | number }>;
}

// A raw `timedtexttrack` entry from the parsed manifest. Only the fields we read
// are typed; Netflix ships many more.
export interface NetflixRawTrack {
    language?: string | null;
    bcp47?: string | null;
    languageDescription?: string | null;
    trackType?: string;
    new_track_id?: string;
    id?: string;
    isNoneTrack?: boolean;
    isForcedNarrative?: boolean;
    ttDownloadables?: Record<string, Downloadable>;
    // Older manifests nest the same map under `downloadables`.
    downloadables?: Record<string, Downloadable>;
}

// A normalized track: language resolved to a base code, a human label, and the
// resolved WebVTT download URL (null when the track has no WebVTT downloadable,
// e.g. the "Off" / none track).
export interface NetflixTrack {
    /** BCP-47 code as Netflix reports it, e.g. 'en', 'pt-BR', 'zh-Hans'. */
    language: string;
    /** Base language code, lowercased: 'en', 'pt', 'zh'. */
    base: string;
    label: string;
    isForced: boolean;
    webvttUrl: string | null;
}

export interface NetflixTrackRequest {
    key: string; // unique id for matching the async fetch response
    name: string; // display label (learning / native language)
    url: string;
}

export interface NetflixTrackPlan {
    requests: NetflixTrackRequest[];
    /** Display name assigned to the primary track (the learning language). */
    primaryLabel: string;
    /** Display name assigned to the secondary track (the native language). */
    secondaryLabel: string;
    /** Base codes of every subtitle language the title actually offers. For
     *  messaging when the learning/native language isn't available. */
    availableBaseCodes: string[];
}

/** Base language code: strip region/script subtags and lowercase ('pt-BR' → 'pt'). */
export function baseLang(code: string | null | undefined): string {
    return (code ?? '').split(/[-_]/)[0].toLowerCase();
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    lrm: '‎',
    rlm: '‏',
};

/**
 * Decode HTML entities that Netflix WebVTT cues carry (e.g. `&amp;`, `&#39;`,
 * `&lrm;`). The shared `parseVTT` strips markup tags but leaves entities as
 * literals, which would otherwise render verbatim in the sidebar.
 */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
        if (body[0] === '#') {
            const isHex = body[1] === 'x' || body[1] === 'X';
            const cp = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return match;
            try {
                return String.fromCodePoint(cp);
            } catch {
                return match;
            }
        }
        const named = NAMED_ENTITIES[body.toLowerCase()];
        return named ?? match;
    });
}

/** Resolve the actual download URL from a Netflix downloadable (either shape). */
export function resolveDownloadUrl(dl: Downloadable | undefined | null): string | null {
    if (!dl || typeof dl !== 'object') return null;
    if (Array.isArray(dl.urls) && dl.urls.length > 0 && dl.urls[0]?.url) {
        return dl.urls[0].url;
    }
    if (dl.downloadUrls && typeof dl.downloadUrls === 'object') {
        const first = Object.values(dl.downloadUrls).find((u) => typeof u === 'string' && u.length > 0);
        if (first) return first;
    }
    return null;
}

/** Pick the WebVTT downloadable from a track: the exact profile if present,
 *  otherwise any profile key that mentions "webvtt". */
export function pickWebvttUrl(track: NetflixRawTrack): string | null {
    const map = track.ttDownloadables ?? track.downloadables;
    if (!map || typeof map !== 'object') return null;
    if (map[WEBVTT_PROFILE]) {
        const url = resolveDownloadUrl(map[WEBVTT_PROFILE]);
        if (url) return url;
    }
    const key = Object.keys(map).find((k) => k.toLowerCase().includes('webvtt'));
    return key ? resolveDownloadUrl(map[key]) : null;
}

/**
 * Normalize the raw manifest `timedtexttracks` into usable subtitle tracks.
 * Drops the "none"/off track and any track without a WebVTT downloadable.
 */
export function normalizeTracks(raw: NetflixRawTrack[]): NetflixTrack[] {
    const out: NetflixTrack[] = [];
    for (const t of raw) {
        if (!t || t.isNoneTrack) continue;
        const language = t.language ?? t.bcp47 ?? '';
        if (!language) continue;
        const webvttUrl = pickWebvttUrl(t);
        if (!webvttUrl) continue; // no WebVTT for this track — unusable
        const base = baseLang(language);
        out.push({
            language,
            base,
            label: t.languageDescription || language,
            isForced: !!t.isForcedNarrative,
            webvttUrl,
        });
    }
    return out;
}

// Prefer a full (non-forced) track over a forced-narrative one for the same
// language. Forced tracks only caption foreign-language dialogue, so they make a
// poor primary/secondary track when a full track exists.
function findForLang(tracks: NetflixTrack[], code: string, exclude?: NetflixTrack): NetflixTrack | undefined {
    const base = baseLang(code);
    const candidates = tracks.filter((t) => t.base === base && t !== exclude);
    return candidates.find((t) => !t.isForced) ?? candidates[0];
}

/**
 * Decide which subtitle tracks to fetch for the user's language pair.
 *
 * Unlike YouTube, Netflix serves NO machine translation — only the languages the
 * title actually ships. So a language is shown only when a real track exists for
 * it; a missing learning/native language simply isn't rendered (mirrors Rezka's
 * no-MT positioning). Returns null when neither language is available.
 */
export function planNetflixTracks(
    prefs: LanguagePrefs,
    tracks: NetflixTrack[],
    movieId: string,
): NetflixTrackPlan | null {
    const availableBaseCodes = [...new Set(tracks.map((t) => t.base))];
    const learningLabel = labelForLanguage(prefs.learning);
    const nativeLabel = labelForLanguage(prefs.native);

    const learningTrack = findForLang(tracks, prefs.learning);
    const sameLang = baseLang(prefs.native) === baseLang(prefs.learning);
    const nativeTrack = sameLang ? undefined : findForLang(tracks, prefs.native, learningTrack);

    if (!learningTrack && !nativeTrack) return null;

    const mkKey = (name: string) => `${movieId}:${name}`;
    const requests: NetflixTrackRequest[] = [];
    if (learningTrack) {
        requests.push({ key: mkKey(learningLabel), name: learningLabel, url: learningTrack.webvttUrl! });
    }
    if (nativeTrack) {
        requests.push({ key: mkKey(nativeLabel), name: nativeLabel, url: nativeTrack.webvttUrl! });
    }

    return { requests, primaryLabel: learningLabel, secondaryLabel: nativeLabel, availableBaseCodes };
}

const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

/**
 * Build the settings-panel language catalog for the current title: every
 * language the title actually offers (available=true) followed by the rest of
 * the supported catalog (available=false, shown disabled). This drives the two
 * grouped dropdowns so the user sees the full list split into "this video" vs
 * "other", mirroring Netflix's native subtitle menu.
 *
 * Labels come from OUR catalog (labelForLanguage), NOT Netflix's raw
 * `languageDescription` — that field carries placeholder/"Off" values and
 * profile noise, so trusting it fills the picker with junk. A track whose base
 * code isn't a recognized supported language is dropped entirely.
 */
export function buildLanguageCatalog(tracks: NetflixTrack[]): LanguageChoice[] {
    const catalog: LanguageChoice[] = [];
    // Available group: one entry per recognized base language the title ships,
    // in track order. A title may carry several tracks for one base (forced +
    // full, or CC); dedupe by base.
    const seen = new Set<string>();
    for (const t of tracks) {
        if (!SUPPORTED_CODES.has(t.base) || seen.has(t.base)) continue;
        seen.add(t.base);
        catalog.push({ code: t.base, label: labelForLanguage(t.base), available: true });
    }
    // Other group: the rest of the supported catalog the title doesn't ship.
    for (const lang of SUPPORTED_LANGUAGES) {
        if (seen.has(lang.code)) continue;
        catalog.push({ code: lang.code, label: lang.label, available: false });
    }
    return catalog;
}

/** Resolve the best WebVTT track for a base language code (full over forced). */
export function trackForBaseCode(tracks: NetflixTrack[], code: string): NetflixTrack | undefined {
    return findForLang(tracks, code);
}
