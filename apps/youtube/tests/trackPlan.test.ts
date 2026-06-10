import { planTrackRequests, CaptionTrack } from '../src/content/trackPlan';

const track = (lang: string, name = lang): CaptionTrack => ({
    baseUrl: `https://yt/${lang}`,
    lang,
    name,
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
