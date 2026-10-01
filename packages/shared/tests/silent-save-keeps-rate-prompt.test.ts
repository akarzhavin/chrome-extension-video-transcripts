/**
 * The rating ask is a one-shot: the worker burns it the moment the saved-word
 * threshold is crossed and the content script renders the banner from the reply.
 * A save made from the right-click menu has no page UI of ours to render it on,
 * so it must not spend the ask — it would be gone without anyone seeing it.
 */

const store: Record<string, unknown> = {};

const area = () => ({
    get: (keys: string | string[] | null) => {
        if (keys === null) return Promise.resolve({ ...store });
        const list = Array.isArray(keys) ? keys : [keys];
        return Promise.resolve(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]])));
    },
    set: (o: Record<string, unknown>) => {
        Object.assign(store, o);
        return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        return Promise.resolve();
    },
});

(global as any).chrome = {
    runtime: { id: 'test-extension-id', lastError: undefined, getManifest: () => ({ version: '1.0.0' }) },
    storage: { local: area(), session: area() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    tabs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
};

jest.mock('@video-transcripts/shared/src/auth/firestoreRest', () => ({
    addInboxWord: jest.fn().mockResolvedValue({ wordId: 'w' }),
    addFeedback: jest.fn(),
    addNoSubsReport: jest.fn(),
}));
jest.mock('@video-transcripts/shared/src/analytics-bg', () => ({
    track: jest.fn().mockResolvedValue(undefined),
    handleTrackMessage: jest.fn().mockResolvedValue({ ok: true }),
}));

import { RATE_PROMPT_WORD_THRESHOLD, setAuthState } from '@video-transcripts/shared/src/auth/storage';
import { handleAuthMessage } from '@video-transcripts/shared/src/auth/background';

const save = (i: number, extra: Record<string, unknown> = {}) =>
    handleAuthMessage({ action: 'ADD_WORD', term: `word${i}`, context: '', site: 'web', ...extra }) as Promise<{
        promptRate: boolean;
    }>;

beforeEach(async () => {
    for (const k of Object.keys(store)) delete store[k];
    await setAuthState({
        idToken: 'id',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
        email: 'reader@example.com',
        uid: 'u1',
    });
});

it('a silent save crossing the threshold does not burn the one-shot', async () => {
    for (let i = 1; i < RATE_PROMPT_WORD_THRESHOLD; i++) await save(i);
    const crossing = await save(RATE_PROMPT_WORD_THRESHOLD, { silent: true });
    expect(crossing.promptRate).toBe(false);
    // The ask is still there for the next save that can show it.
    const next = await save(RATE_PROMPT_WORD_THRESHOLD + 1);
    expect(next.promptRate).toBe(true);
});

it('a normal save crossing the threshold still asks, exactly once', async () => {
    for (let i = 1; i < RATE_PROMPT_WORD_THRESHOLD; i++) await save(i);
    expect((await save(RATE_PROMPT_WORD_THRESHOLD)).promptRate).toBe(true);
    expect((await save(RATE_PROMPT_WORD_THRESHOLD + 1)).promptRate).toBe(false);
});
