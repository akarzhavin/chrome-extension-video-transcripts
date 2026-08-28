/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://hdrezka.today/films/action/1483-troya-2004.html"}
 */
/**
 * The interceptor is what pairs a subtitle track with the player's own name for
 * it. That pairing exists at exactly one point — the CDN listing — and nothing
 * downstream can rebuild it, so these tests run the REAL built bundle rather
 * than a reimplementation of its regexes.
 *
 * Regression (Troy, 2026-08-28): the film ships two tracks under translator 238,
 * "Оригинал (+субтитры)" and "Оригинал (+субтитры) (реж.)". Picking the
 * director's cut showed the theatrical subtitles.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../build/src/content/network-interceptor.js');

interface Detected {
    url: string;
    label?: string;
}

/**
 * Loads the built interceptor over a stubbed fetch, feeds it one CDN response,
 * and returns everything it announced via VTT_URL_DETECTED.
 */
async function runInterceptor(responseBody: string): Promise<Detected[]> {
    const detected: Detected[] = [];
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.data && e.data.type === 'VTT_URL_DETECTED') {
            detected.push({ url: e.data.url, label: e.data.label });
        }
    });

    (window as any).fetch = jest.fn().mockResolvedValue({
        clone: () => ({ text: () => Promise.resolve(responseBody) }),
    });

    // The bundle is an IIFE that patches window.fetch on load.
    new Function(readFileSync(BUNDLE, 'utf-8'))();

    await (window as any).fetch('/ajax/get_cdn_series/?t=1');
    // Let the body-reading promise chain and postMessage delivery settle.
    await new Promise((r) => setTimeout(r, 0));
    return detected;
}

describe('rezka network interceptor: track labels', () => {
    test('pairs each .vtt URL with the label from the CDN listing', async () => {
        const body = JSON.stringify({
            success: true,
            subtitle: '[Русский]https://static.voidboost.com/a/ru.vtt,'
                + '[Українська]https://static.voidboost.com/a/uk.vtt,'
                + '[English]https://static.voidboost.com/a/en.vtt',
        });

        const detected = await runInterceptor(body);

        expect(detected).toEqual([
            { url: 'https://static.voidboost.com/a/ru.vtt', label: 'Русский' },
            { url: 'https://static.voidboost.com/a/uk.vtt', label: 'Українська' },
            { url: 'https://static.voidboost.com/a/en.vtt', label: 'English' },
        ]);
    });

    // Live capture showed the body arriving with \uXXXX escapes intact: we scan
    // the RAW text, so the JSON parse that would decode them never runs on our
    // side. Undecoded, "Ру..." reached the sidebar verbatim.
    test('decodes \\uXXXX escapes in labels', async () => {
        const body = '{"success":true,"subtitle":"'
            + '[\\u0420\\u0443\\u0441\\u0441\\u043a\\u0438\\u0439]https:\\/\\/static.voidboost.com\\/a\\/ru.vtt'
            + '"}';

        const detected = await runInterceptor(body);

        expect(detected).toHaveLength(1);
        expect(detected[0].label).toBe('Русский');
        expect(detected[0].url).toBe('https://static.voidboost.com/a/ru.vtt');
    });

    // Two same-language tracks differing only by the "(реж.)" suffix — the exact
    // pair that made the director's cut unreachable.
    test('keeps two same-language tracks distinguishable', async () => {
        const body = JSON.stringify({
            success: true,
            subtitle: '[Оригинал (+субтитры)]https://static.voidboost.com/a/theatrical.vtt,'
                + '[Оригинал (+субтитры) (реж.)]https://static.voidboost.com/a/director.vtt',
        });

        const detected = await runInterceptor(body);

        expect(detected.map((d) => d.label)).toEqual([
            'Оригинал (+субтитры)',
            'Оригинал (+субтитры) (реж.)',
        ]);
        expect(new Set(detected.map((d) => d.url)).size).toBe(2);
    });
});
