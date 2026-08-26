import { planTrackRequests, CaptionTrack } from '../src/content/trackPlan';

const track = (lang: string, name = lang): CaptionTrack => ({
    baseUrl: `https://yt/${lang}`,
    lang,
    name,
});

// Auto-generated (speech recognition) counterpart of the same language. YouTube
// lists these FIRST, which is what made the naive first-match pick them.
const asr = (lang: string): CaptionTrack => ({
    baseUrl: `https://yt/${lang}-asr`,
    lang,
    name: `${lang} (auto-generated)`,
    kind: 'asr',
});

const VID = 'vid123';

describe('planTrackRequests', () => {
    test('returns null when there are no tracks', () => {
        expect(planTrackRequests({ learning: 'en', native: 'ru' }, [], VID)).toBeNull();
    });

    test('uses real tracks for both languages when available', () => {
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [track('en'), track('ru'), track('de')],
            VID,
        );
        expect(plan).not.toBeNull();
        expect(plan!.primaryLabel).toBe('English');
        expect(plan!.secondaryLabel).toBe('Russian');
        expect(plan!.requests).toEqual([
            { key: `${VID}:English`, name: 'English', baseUrl: 'https://yt/en' },
            { key: `${VID}:Russian`, name: 'Russian', baseUrl: 'https://yt/ru' },
        ]);
        // No machine translation when real tracks exist.
        expect(plan!.requests.every((r) => r.tlang === undefined)).toBe(true);
    });

    test('primary is ALWAYS the learning language — machine-translated when absent', () => {
        // Video has Spanish + Russian, user learns English (no English track).
        // The main track must NOT silently become Spanish; it must be English MT.
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [track('es'), track('ru')],
            VID,
        )!;
        const primary = plan.requests[0];
        expect(primary.name).toBe('English');
        expect(primary.tlang).toBe('en'); // machine translation requested
        expect(primary.baseUrl).toBe('https://yt/es'); // from the first/original track
        // Native is a real Russian track.
        expect(plan.requests[1]).toEqual({ key: `${VID}:Russian`, name: 'Russian', baseUrl: 'https://yt/ru' });
    });

    test('machine-translates the native track when absent', () => {
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [track('en'), track('de')],
            VID,
        )!;
        expect(plan.requests[0]).toEqual({ key: `${VID}:English`, name: 'English', baseUrl: 'https://yt/en' });
        expect(plan.requests[1]).toMatchObject({ name: 'Russian', tlang: 'ru', baseUrl: 'https://yt/en' });
    });

    test('machine-translates both when neither language has a track', () => {
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [track('fr')],
            VID,
        )!;
        expect(plan.requests).toHaveLength(2);
        expect(plan.requests[0]).toMatchObject({ name: 'English', tlang: 'en', baseUrl: 'https://yt/fr' });
        expect(plan.requests[1]).toMatchObject({ name: 'Russian', tlang: 'ru', baseUrl: 'https://yt/fr' });
    });

    test('matches region-tagged track languages (en-US → en)', () => {
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [track('en-US'), track('ru-RU')],
            VID,
        )!;
        expect(plan.requests[0]).toMatchObject({ name: 'English', baseUrl: 'https://yt/en-US' });
        expect(plan.requests[0].tlang).toBeUndefined();
        expect(plan.requests[1]).toMatchObject({ name: 'Russian', baseUrl: 'https://yt/ru-RU' });
    });

    test('emits a single track when learning and native languages are equal', () => {
        const plan = planTrackRequests(
            { learning: 'en', native: 'en' },
            [track('en'), track('ru')],
            VID,
        )!;
        expect(plan.requests).toHaveLength(1);
        expect(plan.requests[0]).toMatchObject({ name: 'English', baseUrl: 'https://yt/en' });
    });

    // Measured on a live video (EDap9qxb96k): the catalog listed `asr` at index
    // 0 and the human track at index 1, while every audioTracks entry set
    // defaultCaptionTrackIndex: 1. The player rendered the human track; taking
    // the first language match rendered the ASR one, so our captions were cut
    // mid-sentence where YouTube's broke on clauses.
    test('prefers the human track over auto-generated for the same language', () => {
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [asr('en'), track('en'), track('ru')],
            VID,
        )!;
        expect(plan.requests[0]).toEqual({
            key: `${VID}:English`, name: 'English', baseUrl: 'https://yt/en',
        });
    });

    test('prefers the human track for the native language too', () => {
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [track('en'), asr('ru'), track('ru')],
            VID,
        )!;
        expect(plan.requests[1]).toEqual({
            key: `${VID}:Russian`, name: 'Russian', baseUrl: 'https://yt/ru',
        });
    });

    test('falls back to the ASR track when it is the only one', () => {
        // Auto-generated captions still beat showing none.
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [asr('en')],
            VID,
        )!;
        expect(plan.requests[0]).toMatchObject({ name: 'English', baseUrl: 'https://yt/en-asr' });
        expect(plan.requests[0].tlang).toBeUndefined();
    });

    test('machine-translates from the human track, not the ASR one', () => {
        // The translation inherits the source's grouping, so translating the
        // auto-generated stream would reproduce its mid-sentence cuts.
        const plan = planTrackRequests(
            { learning: 'de', native: 'ru' },
            [asr('en'), track('en')],
            VID,
        )!;
        expect(plan.requests[0]).toMatchObject({ name: 'German', tlang: 'de', baseUrl: 'https://yt/en' });
        expect(plan.requests[1]).toMatchObject({ name: 'Russian', tlang: 'ru', baseUrl: 'https://yt/en' });
    });

    test('does not reuse the same track for both slots', () => {
        // Only an English track exists; native (Russian) must be a translation,
        // never the same English track duplicated.
        const plan = planTrackRequests(
            { learning: 'en', native: 'ru' },
            [track('en')],
            VID,
        )!;
        expect(plan.requests[0].tlang).toBeUndefined();
        expect(plan.requests[1].tlang).toBe('ru');
    });
});
