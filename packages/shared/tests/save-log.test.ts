/**
 * @jest-environment jsdom
 *
 * The save log's own rules (packages/shared/src/debug/save-log.ts): what it
 * keeps, for how long, and what survives. The end-to-end path is in
 * save-diagnostics.test.ts; this pins the retention a rare failure depends on.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { id: 'x', getManifest: () => ({ version: '1' }) },
    storage: {
        local: {
            get: jest.fn((k: string) => Promise.resolve(k in store ? { [k]: store[k] } : {})),
            set: jest.fn((o: Record<string, unknown>) => {
                Object.assign(store, JSON.parse(JSON.stringify(o)));
                return Promise.resolve();
            }),
            remove: jest.fn((k: string) => {
                delete store[k];
                return Promise.resolve();
            }),
        },
        onChanged: { addListener: jest.fn() },
    },
};

import {
    FAILURE_CONTEXT,
    MAX_FAILURES,
    MAX_RECENT,
    SAVE_LOG_KEY,
    appendAttempt,
    clearSaveLog,
    coerceSaveLog,
    emptySaveLog,
    loadSaveLog,
    recordSaveAttempt,
    saveLogActions,
    type SaveAttempt,
    type SaveLogData,
} from '../src/debug/save-log';

let clock = 1_000_000;
function attempt(term: string, outcome: 'ok' | 'failed' = 'ok', gap = 5000): SaveAttempt {
    clock += gap;
    return {
        at: clock,
        iso: new Date(clock).toISOString(),
        op: 'save',
        term,
        mirrorBefore: null,
        site: 'youtube',
        copy: { id: 'x', version: '1', install: 'unpacked' },
        panelOwner: 'x',
        outcome,
        roundTripMs: 10,
    };
}

function run(n: number, data: SaveLogData, prefix = 'w'): SaveLogData {
    for (let i = 0; i < n; i++) data = appendAttempt(data, attempt(`${prefix}${i}`));
    return data;
}

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
});

describe('retention', () => {
    test('a failure outlives three full windows of later presses', () => {
        let data = run(5, emptySaveLog(), 'before');
        data = appendAttempt(data, attempt('the-failure', 'failed'));
        data = run(MAX_RECENT * 3, data, 'after');

        expect(data.recent).toHaveLength(MAX_RECENT);
        expect(data.recent.some((a) => a.term === 'the-failure')).toBe(false);
        expect(data.failures.map((f) => f.attempt.term)).toEqual(['the-failure']);
        expect(data.failures[0].before.map((a) => a.term)).toEqual(
            ['before0', 'before1', 'before2', 'before3', 'before4'],
        );
    });

    test('each failure keeps at most FAILURE_CONTEXT presses before it', () => {
        let data = run(FAILURE_CONTEXT + 7, emptySaveLog());
        data = appendAttempt(data, attempt('f', 'failed'));
        expect(data.failures[0].before).toHaveLength(FAILURE_CONTEXT);
        expect(data.failures[0].before[FAILURE_CONTEXT - 1].term).toBe(`w${FAILURE_CONTEXT + 6}`);
    });

    test('past MAX_FAILURES the oldest failure goes first', () => {
        let data = emptySaveLog();
        for (let i = 0; i < MAX_FAILURES + 3; i++) data = appendAttempt(data, attempt(`f${i}`, 'failed'));
        expect(data.failures).toHaveLength(MAX_FAILURES);
        expect(data.failures[0].attempt.term).toBe('f3');
        expect(data.failures[MAX_FAILURES - 1].attempt.term).toBe(`f${MAX_FAILURES + 2}`);
    });

    test('sincePrevMs is the gap to this copy\'s previous press; the first has none', () => {
        let data = appendAttempt(emptySaveLog(), attempt('a'));
        data = appendAttempt(data, attempt('b', 'ok', 350));
        expect(data.recent[0].sincePrevMs).toBeNull();
        expect(data.recent[1].sincePrevMs).toBe(350);
    });
});

describe('storage', () => {
    test('two presses recorded in the same tick are both kept', async () => {
        // A double handler fires two saves in one millisecond — the very case
        // this log exists to show. An unserialised read-modify-write loses one.
        await Promise.all([recordSaveAttempt(attempt('one')), recordSaveAttempt(attempt('two'))]);
        expect((await loadSaveLog()).recent.map((a) => a.term)).toEqual(['one', 'two']);
    });

    test('a failure survives a reload: it is read back from storage', async () => {
        await recordSaveAttempt(attempt('f', 'failed'));
        expect((store[SAVE_LOG_KEY] as SaveLogData).failures).toHaveLength(1);
        expect((await loadSaveLog()).failures[0].attempt.term).toBe('f');
    });

    test('anything else under the key reads as an empty log', () => {
        for (const junk of [null, 42, 'x', {}, { recent: 1, failures: [] }, { recent: [] }]) {
            expect(coerceSaveLog(junk)).toEqual(emptySaveLog());
        }
    });

    test('a storage failure does not reach the caller', async () => {
        (chrome.storage.local.set as jest.Mock).mockRejectedValueOnce(new Error('QUOTA_BYTES'));
        await expect(recordSaveAttempt(attempt('a'))).resolves.toBeUndefined();
    });

    test('clear removes the key and zeroes the count at once', async () => {
        await recordSaveAttempt(attempt('a'));
        const actions = saveLogActions();
        await new Promise((r) => setTimeout(r, 0));
        expect(actions.saves()).toBe(1);
        await clearSaveLog();
        expect(store[SAVE_LOG_KEY]).toBeUndefined();
        expect(actions.saves()).toBe(0);
    });
});
