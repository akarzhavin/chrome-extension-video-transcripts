/**
 * The subtitle numbers the extension shares with the backend come from
 * infrastructure/lingogram-limits.json, injected at build time as
 * __LIMIT_SUBTITLE__, never hardcoded in track.ts or worker.ts.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const base = () => (global as any).__LIMIT_SUBTITLE__;

function withLimits<T>(over: object, load: () => T): T {
    const saved = base();
    (global as any).__LIMIT_SUBTITLE__ = { ...saved, ...over };
    try {
        let mod!: T;
        jest.isolateModules(() => {
            mod = load();
        });
        return mod;
    } finally {
        (global as any).__LIMIT_SUBTITLE__ = saved;
    }
}

const sub = (startTime: number, endTime: number, text: string) => ({ startTime, endTime, text });

test('the build injects every subtitle key from lingogram-limits.json', () => {
    const limits = {
        SUBTITLE_LANGS: ['en'], SUBTITLE_SITES: ['rezka'], SUBTITLE_TTL_DAYS: 9, SUBTITLE_MAX_CUES: 7,
        SUBTITLE_MAX_DURATION_MS: 8, SUBTITLE_MAX_CUE_TEXT: 6, SUBTITLE_MIN_CUE_MS: 5, SUBTITLE_MAX_CHARS_PER_SEC: 4,
        SUBTITLE_MAX_CUE_CHARS_PER_SEC: 3, SUBTITLE_WRITES_PER_DAY: 2, SUBTITLE_MIN_INTERVAL_S: 1,
    };
    // A subprocess: the module is ESM and jest runs these as CJS.
    const out = execFileSync(process.execPath, [
        '--input-type=module',
        '-e',
        `import { limitDefines } from ${JSON.stringify(resolve(__dirname, '../vite-limits.mjs'))};` +
            `console.log(limitDefines(${JSON.stringify(limits)}).__LIMIT_SUBTITLE__);`,
    ], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(limits);
});

test('track.ts takes its cue rules and lists from the injected limits', () => {
    const track = withLimits(
        { SUBTITLE_MAX_CUES: 2, SUBTITLE_MAX_CUE_TEXT: 5, SUBTITLE_SITES: ['rezka', 'other'], SUBTITLE_TTL_DAYS: 3 },
        () => require('../src/subtitle-ai/track') as typeof import('../src/subtitle-ai/track'),
    );
    expect(track.SUBTITLE_TTL_DAYS).toBe(3);
    const r = track.prepareTrack([sub(0, 2, 'One.'), sub(2, 4, 'Too long.'), sub(4, 6, 'Two.'), sub(6, 8, 'Three')], 'en', 'other');
    if ('error' in r) throw new Error(r.error);
    expect(r.cues.map((c) => c.text)).toEqual(['One.', 'Two.']);
});

test('worker.ts takes the daily write count from the injected limits', async () => {
    const worker = withLimits({ SUBTITLE_WRITES_PER_DAY: 2 }, () => require('../src/subtitle-ai/worker') as typeof import('../src/subtitle-ai/worker'));
    const calls: string[] = [];
    const deps = {
        fetch: async (url: string) => {
            calls.push(url);
            return { ok: true, status: 200, json: async () => ({ fields: { dayBucket: { integerValue: '20261009' }, dailyCount: { integerValue: '2' } } }) } as unknown as Response;
        },
        token: async () => ({ idToken: 't', uid: 'u1' }),
        now: () => Date.UTC(2026, 9, 9, 12),
    };
    const track = { fingerprint: 'a'.repeat(64), sourceLang: 'en', site: 'rezka', durationMs: 1000, cues: [{ start_ms: 0, end_ms: 900, text: 'Hi.' }] };
    expect(await worker.storeTrack({ firestoreUrl: 'https://fs.test', projectId: 'p' } as never, track, deps)).toEqual({ ok: false, reason: 'refused' });
    expect(calls).toHaveLength(1);
});
