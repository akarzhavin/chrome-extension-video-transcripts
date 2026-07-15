import {
    resolveDownloadUrl,
    pickWebvttUrl,
    normalizeTracks,
    planNetflixTracks,
    baseLang,
    decodeEntities,
    buildLanguageCatalog,
    trackForBaseCode,
    WEBVTT_PROFILE,
    NetflixRawTrack,
} from '../src/content/netflix/subtitles';

// Build a raw manifest track with a WebVTT downloadable (`urls` shape by default).
const raw = (
    language: string | null,
    opts: Partial<NetflixRawTrack> & { url?: string; noWebvtt?: boolean } = {},
): NetflixRawTrack => {
    const { url, noWebvtt, ...rest } = opts;
    const ttDownloadables: Record<string, { urls: Array<{ url: string }> }> = noWebvtt
        ? { 'dfxp-ls-sdh': { urls: [{ url: 'https://x.nflxvideo.net/dfxp' }] } }
        : { [WEBVTT_PROFILE]: { urls: [{ url: url ?? `https://x.nflxvideo.net/?o=${language}` }] } };
    return {
        language,
        languageDescription: language ? language.toUpperCase() : undefined,
        ttDownloadables,
        ...rest,
    };
};

const MID = 'movie123';

describe('resolveDownloadUrl', () => {
    test('reads the urls[] array shape', () => {
        expect(resolveDownloadUrl({ urls: [{ url: 'https://a/x' }] })).toBe('https://a/x');
    });
    test('reads the downloadUrls map shape', () => {
        expect(resolveDownloadUrl({ downloadUrls: { '17': 'https://cdn/y' } })).toBe('https://cdn/y');
    });
    test('prefers a non-empty urls[0].url over downloadUrls', () => {
        expect(
            resolveDownloadUrl({ urls: [{ url: 'https://a/x' }], downloadUrls: { '1': 'https://cdn/y' } }),
        ).toBe('https://a/x');
    });
    test('returns null for empty / malformed downloadables', () => {
        expect(resolveDownloadUrl(undefined)).toBeNull();
        expect(resolveDownloadUrl(null)).toBeNull();
        expect(resolveDownloadUrl({})).toBeNull();
        expect(resolveDownloadUrl({ urls: [] })).toBeNull();
        expect(resolveDownloadUrl({ downloadUrls: {} })).toBeNull();
    });
});

describe('pickWebvttUrl', () => {
    test('picks the exact webvtt-lssdh-ios8 profile', () => {
        expect(pickWebvttUrl(raw('en', { url: 'https://a/en.vtt' }))).toBe('https://a/en.vtt');
    });
    test('falls back to any profile key mentioning webvtt', () => {
        const t: NetflixRawTrack = {
            language: 'en',
            ttDownloadables: { 'webvtt-lssdh-other': { urls: [{ url: 'https://a/other' }] } },
        };
        expect(pickWebvttUrl(t)).toBe('https://a/other');
    });
    test('reads the legacy `downloadables` map too', () => {
        const t: NetflixRawTrack = {
            language: 'en',
            downloadables: { [WEBVTT_PROFILE]: { downloadUrls: { '3': 'https://a/legacy' } } },
        };
        expect(pickWebvttUrl(t)).toBe('https://a/legacy');
    });
    test('returns null when only non-webvtt profiles exist', () => {
        expect(pickWebvttUrl(raw('en', { noWebvtt: true }))).toBeNull();
    });
});

describe('normalizeTracks', () => {
    test('drops the none/off track, tracks without webvtt, and blank languages', () => {
        const tracks = normalizeTracks([
            raw('en'),
            { language: null, isNoneTrack: true, ttDownloadables: {} },
            raw('de', { noWebvtt: true }),
            raw(''),
            raw('es'),
        ]);
        expect(tracks.map((t) => t.language)).toEqual(['en', 'es']);
    });

    test('resolves base code, label, forced flag and url', () => {
        const [t] = normalizeTracks([
            raw('pt-BR', { languageDescription: 'Portuguese (Brazil)', isForcedNarrative: true, url: 'https://a/pt' }),
        ]);
        expect(t).toMatchObject({
            language: 'pt-BR',
            base: 'pt',
            label: 'Portuguese (Brazil)',
            isForced: true,
            webvttUrl: 'https://a/pt',
        });
    });
});

describe('baseLang', () => {
    test('strips region/script subtags and lowercases', () => {
        expect(baseLang('pt-BR')).toBe('pt');
        expect(baseLang('zh-Hans')).toBe('zh');
        expect(baseLang('EN')).toBe('en');
        expect(baseLang('pt_PT')).toBe('pt');
        expect(baseLang(null)).toBe('');
    });
});

describe('decodeEntities', () => {
    test('decodes common named entities', () => {
        expect(decodeEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
        expect(decodeEntities('&quot;Hi&quot; &lt;there&gt;')).toBe('"Hi" <there>');
        expect(decodeEntities('it&apos;s')).toBe("it's");
    });
    test('decodes decimal and hex numeric entities', () => {
        expect(decodeEntities('it&#39;s')).toBe("it's");
        expect(decodeEntities('&#x2014;')).toBe('—');
    });
    test('leaves unknown or malformed entities untouched', () => {
        expect(decodeEntities('a &bogus; b')).toBe('a &bogus; b');
        expect(decodeEntities('5 &lt 3')).toBe('5 &lt 3');
        expect(decodeEntities('&#xZZ;')).toBe('&#xZZ;');
    });
    test('is a no-op on plain text', () => {
        expect(decodeEntities('Hola, ¿qué tal?')).toBe('Hola, ¿qué tal?');
    });
});

describe('planNetflixTracks', () => {
    test('returns null when neither language is available (no machine translation)', () => {
        const tracks = normalizeTracks([raw('fr'), raw('de')]);
        expect(planNetflixTracks({ learning: 'en', native: 'ru' }, tracks, MID)).toBeNull();
    });

    test('fetches real tracks for both languages when available', () => {
        const tracks = normalizeTracks([raw('en', { url: 'https://a/en' }), raw('ru', { url: 'https://a/ru' }), raw('de')]);
        const plan = planNetflixTracks({ learning: 'en', native: 'ru' }, tracks, MID)!;
        expect(plan.primaryLabel).toBe('English');
        expect(plan.secondaryLabel).toBe('Russian');
        expect(plan.requests).toEqual([
            { key: `${MID}:English`, name: 'English', url: 'https://a/en' },
            { key: `${MID}:Russian`, name: 'Russian', url: 'https://a/ru' },
        ]);
        expect(plan.availableBaseCodes).toEqual(['en', 'ru', 'de']);
    });

    test('emits only the learning track when native is missing (no MT)', () => {
        const tracks = normalizeTracks([raw('en'), raw('de')]);
        const plan = planNetflixTracks({ learning: 'en', native: 'ru' }, tracks, MID)!;
        expect(plan.requests).toHaveLength(1);
        expect(plan.requests[0]).toMatchObject({ name: 'English' });
    });

    test('emits only the native track when the learning language is missing', () => {
        const tracks = normalizeTracks([raw('ru'), raw('de')]);
        const plan = planNetflixTracks({ learning: 'en', native: 'ru' }, tracks, MID)!;
        expect(plan.requests).toHaveLength(1);
        expect(plan.requests[0]).toMatchObject({ name: 'Russian' });
    });

    test('matches region/script-tagged languages (pt-BR → pt)', () => {
        const tracks = normalizeTracks([raw('pt-BR', { url: 'https://a/pt' }), raw('en', { url: 'https://a/en' })]);
        const plan = planNetflixTracks({ learning: 'pt', native: 'en' }, tracks, MID)!;
        expect(plan.requests[0]).toMatchObject({ name: 'Portuguese', url: 'https://a/pt' });
        expect(plan.requests[1]).toMatchObject({ name: 'English', url: 'https://a/en' });
    });

    test('emits a single track when learning and native are the same language', () => {
        const tracks = normalizeTracks([raw('en'), raw('ru')]);
        const plan = planNetflixTracks({ learning: 'en', native: 'en' }, tracks, MID)!;
        expect(plan.requests).toHaveLength(1);
        expect(plan.requests[0]).toMatchObject({ name: 'English' });
    });

    test('prefers a full track over a forced-narrative track for the same language', () => {
        const tracks = normalizeTracks([
            raw('en', { isForcedNarrative: true, url: 'https://a/en-forced' }),
            raw('en', { url: 'https://a/en-full' }),
        ]);
        const plan = planNetflixTracks({ learning: 'en', native: 'ru' }, tracks, MID)!;
        expect(plan.requests[0].url).toBe('https://a/en-full');
    });

    test('does not reuse the same track object for both slots', () => {
        const tracks = normalizeTracks([raw('en')]);
        const plan = planNetflixTracks({ learning: 'en', native: 'ru' }, tracks, MID)!;
        expect(plan.requests).toHaveLength(1);
        expect(plan.requests[0]).toMatchObject({ name: 'English' });
    });
});

describe('buildLanguageCatalog', () => {
    test('lists the title\'s languages first (available), in track order, with our catalog labels', () => {
        const tracks = normalizeTracks([
            raw('en', { languageDescription: 'English (CC)' }),
            raw('pl', { languageDescription: 'Polish' }),
            raw('ru', { languageDescription: 'Russian' }),
        ]);
        const catalog = buildLanguageCatalog(tracks);
        const available = catalog.filter((l) => l.available);
        // Labels come from our own catalog, not Netflix's languageDescription.
        expect(available).toEqual([
            { code: 'en', label: 'English', available: true },
            { code: 'pl', label: 'Polish', available: true },
            { code: 'ru', label: 'Russian', available: true },
        ]);
    });

    test('drops tracks whose base code is not a recognized language (Netflix "Off"/junk placeholders)', () => {
        // Netflix ships placeholder/none-ish tracks with descriptions like "Off"
        // and non-language codes. Even if they slip past normalizeTracks (real
        // language field + a webvtt url), they must never appear in the picker.
        const tracks = normalizeTracks([
            raw('en'),
            raw('zzForced', { languageDescription: 'Off' }),
            raw('none', { languageDescription: 'Off' }),
            raw('ru'),
        ]);
        const available = buildLanguageCatalog(tracks).filter((l) => l.available);
        expect(available.map((l) => l.code)).toEqual(['en', 'ru']);
    });

    test('collapses duplicate tracks for one language to a single available entry', () => {
        // Multiple profiles/CDNs for the same language arrive as separate tracks.
        const tracks = normalizeTracks([
            raw('en', { url: 'https://a/en1' }),
            raw('en', { url: 'https://a/en2' }),
            raw('en', { isForcedNarrative: true, url: 'https://a/en3' }),
        ]);
        const available = buildLanguageCatalog(tracks).filter((l) => l.available);
        expect(available).toEqual([{ code: 'en', label: 'English', available: true }]);
    });

    test('appends the rest of the supported catalog as unavailable (disabled)', () => {
        const tracks = normalizeTracks([raw('en'), raw('ru')]);
        const catalog = buildLanguageCatalog(tracks);
        // Every supported language shows up exactly once.
        const codes = catalog.map((l) => l.code);
        expect(new Set(codes).size).toBe(codes.length);
        // A language the title doesn't ship is present and disabled.
        const german = catalog.find((l) => l.code === 'de');
        expect(german).toMatchObject({ code: 'de', label: 'German', available: false });
    });

    test('collapses region/script variants to one available entry per base code', () => {
        const tracks = normalizeTracks([
            raw('pt-BR', { languageDescription: 'Portuguese (Brazil)' }),
            raw('en', { languageDescription: 'English' }),
        ]);
        const catalog = buildLanguageCatalog(tracks);
        const pt = catalog.filter((l) => l.code === 'pt');
        expect(pt).toHaveLength(1);
        expect(pt[0]).toMatchObject({ code: 'pt', available: true });
    });
});

describe('trackForBaseCode', () => {
    test('resolves a base code to its WebVTT track', () => {
        const tracks = normalizeTracks([raw('en', { url: 'https://a/en' }), raw('ru', { url: 'https://a/ru' })]);
        expect(trackForBaseCode(tracks, 'ru')?.webvttUrl).toBe('https://a/ru');
    });

    test('matches region-tagged tracks by base code (pt-BR via "pt")', () => {
        const tracks = normalizeTracks([raw('pt-BR', { url: 'https://a/pt' })]);
        expect(trackForBaseCode(tracks, 'pt')?.webvttUrl).toBe('https://a/pt');
    });

    test('prefers a full track over a forced one', () => {
        const tracks = normalizeTracks([
            raw('en', { isForcedNarrative: true, url: 'https://a/en-forced' }),
            raw('en', { url: 'https://a/en-full' }),
        ]);
        expect(trackForBaseCode(tracks, 'en')?.webvttUrl).toBe('https://a/en-full');
    });

    test('returns undefined for a language the title does not ship', () => {
        const tracks = normalizeTracks([raw('en')]);
        expect(trackForBaseCode(tracks, 'ja')).toBeUndefined();
    });
});
