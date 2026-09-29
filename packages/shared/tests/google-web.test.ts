/**
 * Phrase translation through Google's mobile web page (lookup/google-web.ts).
 *
 * The fixtures are the two shapes the /m page has carried — div.t0 and
 * div.result-container — the same pair dictionary-service's Go scraper reads.
 * The contract worth latching is the one the Go wrapper does NOT keep: a
 * failure must never come back as the phrase itself, or the card would show
 * the phrase as its own translation.
 */
import {
    fetchGoogleGtx,
    fetchGooglePhrase,
    fetchGoogleWeb,
    parseGoogleGtx,
    parseGoogleWebHtml,
} from '../src/lookup/google-web';

function htmlResponse(body: string, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
    } as unknown as Response;
}

const T0_PAGE =
    '<html><body><div class="header">Google Translate</div>' +
    '<div class="t0">попробовать</div><div class="t1">other</div></body></html>';
const RESULT_CONTAINER_PAGE =
    '<html><body><div class="result-container">дай этому шанс</div></body></html>';

beforeEach(() => {
    (global as any).fetch = jest.fn();
});

describe('parseGoogleWebHtml', () => {
    it('reads div.t0', () => {
        expect(parseGoogleWebHtml(T0_PAGE)).toBe('попробовать');
    });

    it('falls back to div.result-container', () => {
        expect(parseGoogleWebHtml(RESULT_CONTAINER_PAGE)).toBe('дай этому шанс');
    });

    it('decodes entities and drops inner markup', () => {
        const page = '<div class="t0">rock &amp; roll &#39;n&#x27; <b>stuff</b>&nbsp;now</div>';
        expect(parseGoogleWebHtml(page)).toBe("rock & roll 'n' stuff now");
    });

    it('is empty when the page carries no result node', () => {
        expect(parseGoogleWebHtml('<html><body>captcha</body></html>')).toBe('');
    });
});

describe('fetchGoogleWeb', () => {
    it('asks the /m page with auto source, the target language and the phrase', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(htmlResponse(T0_PAGE));
        const r = await fetchGoogleWeb(' give it a shot ', 'ru');

        const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
        expect(url.origin + url.pathname).toBe('https://translate.google.com/m');
        expect(url.searchParams.get('sl')).toBe('auto');
        expect(url.searchParams.get('tl')).toBe('ru');
        expect(url.searchParams.get('q')).toBe('give it a shot');
        // The user's Google session must not ride along — the policy says so.
        expect((global.fetch as jest.Mock).mock.calls[0][1].credentials).toBe('omit');
        expect(r).toEqual({
            term: 'give it a shot',
            lemma: 'give it a shot',
            translations: ['попробовать'],
            parts_of_speech: [],
            source: 'google',
        });
    });

    it('a page with no translation is null, not an error', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(htmlResponse('<html></html>'));
        await expect(fetchGoogleWeb('give it a shot', 'ru')).resolves.toBeNull();
    });

    it('the phrase echoed back is null — never shown as its own translation', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            htmlResponse('<div class="t0">Give It A Shot</div>'));
        await expect(fetchGoogleWeb('give it a shot', 'ru')).resolves.toBeNull();
    });

    it('throws on 429', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(htmlResponse('Too Many Requests', 429));
        await expect(fetchGoogleWeb('give it a shot', 'ru')).rejects.toThrow('google HTTP 429');
    });

    it('aborts past its 3 s budget and reports a timeout', async () => {
        jest.useFakeTimers();
        try {
            (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    (init.signal as AbortSignal).addEventListener('abort', () => {
                        const err = new Error('aborted');
                        (err as any).name = 'AbortError';
                        reject(err);
                    });
                }));
            const p = fetchGoogleWeb('give it a shot', 'ru');
            const guarded = expect(p).rejects.toThrow('google timeout');
            await jest.advanceTimersByTimeAsync(3001);
            await guarded;
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('parseGoogleGtx', () => {
    it('joins the sentence segments as they come', () => {
        // Real reply shape, captured 2026-09-28: each segment keeps its own
        // trailing space.
        const body = JSON.stringify([[['Привет. ', 'Hello. '], ['Как дела?', 'How are you?']], null, 'en']);
        expect(parseGoogleGtx(body)).toBe('Привет. Как дела?');
    });

    it('is empty on a reply that is not the expected JSON', () => {
        expect(parseGoogleGtx('<html>captcha</html>')).toBe('');
        expect(parseGoogleGtx('{}')).toBe('');
    });
});

describe('fetchGoogleGtx', () => {
    it('asks the JSON endpoint for the whole phrase, without cookies', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            htmlResponse(JSON.stringify([[['средства защиты для перехвата.', 'defenses to intercept.']], null, 'en'])));
        const r = await fetchGoogleGtx('defenses to intercept.', 'ru');

        const [raw, init] = (global.fetch as jest.Mock).mock.calls[0];
        const url = new URL(raw);
        expect(url.origin + url.pathname).toBe('https://translate.googleapis.com/translate_a/single');
        expect(url.searchParams.get('client')).toBe('gtx');
        expect(url.searchParams.get('sl')).toBe('auto');
        expect(url.searchParams.get('tl')).toBe('ru');
        expect(url.searchParams.get('dt')).toBe('t');
        expect(url.searchParams.get('q')).toBe('defenses to intercept.');
        expect(init.credentials).toBe('omit');
        expect(r?.translations).toEqual(['средства защиты для перехвата.']);
        expect(r?.source).toBe('google');
    });
});

describe('fetchGooglePhrase', () => {
    const gtxOk = (t: string) => htmlResponse(JSON.stringify([[[t, 'x']], null, 'en']));

    it('does not ask the /m page when the JSON endpoint answered', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(gtxOk('попробовать'));
        const r = await fetchGooglePhrase('give it a shot', 'ru');
        expect(r?.translations).toEqual(['попробовать']);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls through to the /m page when the JSON endpoint is refused', async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(htmlResponse('', 429))
            .mockResolvedValueOnce(htmlResponse(T0_PAGE));
        const r = await fetchGooglePhrase('give it a shot', 'ru');
        expect(r?.translations).toEqual(['попробовать']);
        expect(new URL((global.fetch as jest.Mock).mock.calls[1][0]).pathname).toBe('/m');
    });

    it('throws when neither endpoint answered at all', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(htmlResponse('', 429));
        await expect(fetchGooglePhrase('give it a shot', 'ru')).rejects.toThrow('google HTTP 429');
    });

    it('gives both endpoints one 3 s budget, not 3 s each', async () => {
        jest.useFakeTimers();
        try {
            (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    (init.signal as AbortSignal).addEventListener('abort', () => {
                        const err = new Error('aborted');
                        (err as any).name = 'AbortError';
                        reject(err);
                    });
                }));
            const p = fetchGooglePhrase('give it a shot', 'ru');
            const guarded = expect(p).rejects.toThrow('google timeout');
            await jest.advanceTimersByTimeAsync(3001);
            await guarded;
        } finally {
            jest.useRealTimers();
        }
    });

    it('is null when an endpoint answered with nothing and the other failed', async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(gtxOk('give it a shot'))
            .mockResolvedValueOnce(htmlResponse('', 429));
        await expect(fetchGooglePhrase('give it a shot', 'ru')).resolves.toBeNull();
    });
});
