import { labelForLanguage, LanguagePrefs } from '@video-transcripts/shared';

export interface CaptionTrack {
    baseUrl: string;
    lang: string;
    name: string;
    kind?: string;
}

export interface TrackRequest {
    key: string; // unique id for matching response
    name: string;
    baseUrl: string;
    tlang?: string;
}

export interface TrackPlan {
    requests: TrackRequest[];
    /** Display name assigned to the primary track (always the learning language). */
    primaryLabel: string;
    /** Display name assigned to the secondary track (the native language). */
    secondaryLabel: string;
}

const matchesLang = (track: CaptionTrack, code: string): boolean =>
    track.lang === code || track.lang.startsWith(code + '-');

/**
 * Decides which caption tracks to fetch for a video given the user's language
 * pair. Pure (no DOM / state) so it can be unit-tested.
 *
 * Rules:
 *  - Primary is ALWAYS the language being learned: a real caption track if the
 *    video has one, otherwise a machine translation of the original. Never
 *    silently shows some other language as the "main" track.
 *  - Secondary is the native language (skipped when it equals the learning
 *    language): a real track if present, otherwise a machine translation.
 *  - Track names are deterministic (the language labels) so async-arriving VTTs
 *    can be matched back to primary/secondary reliably.
 *
 * Returns null when there are no tracks to work with.
 */
export function planTrackRequests(
    prefs: LanguagePrefs,
    tracks: CaptionTrack[],
    videoId: string,
): TrackPlan | null {
    if (!tracks.length) return null;

    const mkKey = (name: string) => `${videoId}:${name}`;
    const learningLabel = labelForLanguage(prefs.learning);
    const nativeLabel = labelForLanguage(prefs.native);

    const learningTrack = tracks.find((t) => matchesLang(t, prefs.learning));
    const nativeTrack = tracks.find((t) => matchesLang(t, prefs.native));
    // Base for machine translation when a real track is missing — the first
    // listed track is YouTube's original/default for the video.
    const source = tracks[0];

    const requests: TrackRequest[] = [];

    if (learningTrack) {
        requests.push({ key: mkKey(learningLabel), name: learningLabel, baseUrl: learningTrack.baseUrl });
    } else {
        requests.push({
            key: mkKey(learningLabel),
            name: learningLabel,
            baseUrl: source.baseUrl,
            tlang: prefs.learning,
        });
    }

    if (prefs.native !== prefs.learning) {
        if (nativeTrack && nativeTrack !== learningTrack) {
            requests.push({ key: mkKey(nativeLabel), name: nativeLabel, baseUrl: nativeTrack.baseUrl });
        } else {
            requests.push({
                key: mkKey(nativeLabel),
                name: nativeLabel,
                baseUrl: source.baseUrl,
                tlang: prefs.native,
            });
        }
    }

    return { requests, primaryLabel: learningLabel, secondaryLabel: nativeLabel };
}
