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
 * Picks the track to show for a language, preferring a human one over
 * auto-generated speech recognition.
 *
 * A video routinely lists TWO tracks for the same language: `kind: 'asr'`
 * (auto-generated) and one with no kind (uploaded/reviewed). They carry the
 * same words but group them completely differently, and that grouping is what
 * the user reads:
 *
 *   asr      "set anything down and before we go out"   ← sliding window,
 *            "we walk through these disinfecting tubs"     no punctuation,
 *                                                          cuts mid-sentence
 *   default  "and before we go out we walk"             ← clause boundaries,
 *            "through these disinfecting tubs"             capitals, periods
 *
 * Taking the first language match handed back `asr`, because YouTube lists it
 * first — while YouTube's own player renders the other one. The player is not
 * guessing either: every entry in `audioTracks` carries
 * `defaultCaptionTrackIndex` pointing at the non-asr track. Matching that
 * choice is the whole point, so captions group the way viewers expect.
 *
 * Falls back to the ASR track when it is the only one — auto-generated
 * captions still beat none at all.
 */
const findTrack = (tracks: CaptionTrack[], code: string): CaptionTrack | undefined =>
    tracks.find((t) => matchesLang(t, code) && t.kind !== 'asr')
    ?? tracks.find((t) => matchesLang(t, code));

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

    const learningTrack = findTrack(tracks, prefs.learning);
    const nativeTrack = findTrack(tracks, prefs.native);
    // Base for machine translation when a real track is missing. Prefer a
    // human track over ASR for the same reason as above: the translation
    // inherits the source's grouping, so translating the auto-generated
    // stream reproduces its mid-sentence cuts in the target language.
    const source = tracks.find((t) => t.kind !== 'asr') ?? tracks[0];

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
