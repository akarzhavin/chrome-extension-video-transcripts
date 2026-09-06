/**
 * Behaviour map §25, the second indicator: a red "!" on the toolbar icon when
 * the stored session has broken, cleared on the next successful sign-in.
 *
 * It is the ONLY signal a person gets when their session dies — and unlike the
 * panel's account row, it is visible with no video page open at all. Nothing
 * asserted it: `setBadgeText` appeared in the tree only as a jest.fn() stub in
 * rate-prompt.test.ts, which never reads what was written to it.
 *
 * Four call sites decide it (auth/background.ts:171, :226, :487, :521) and this
 * file drives the three that a unit can reach. The fourth (:487, the sign-in
 * hand-off) needs the network exchange and is covered live.
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

const setBadgeText = jest.fn();
const setBadgeBackgroundColor = jest.fn();

(global as any).chrome = {
    runtime: { id: 'test-extension-id', lastError: undefined, getManifest: () => ({ version: '1.0.0' }) },
    storage: { local: area(), session: area() },
    action: { setBadgeText, setBadgeBackgroundColor },
    tabs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
};

// The save itself is not the subject; whether it FAILED with an auth error is.
const addInboxWord = jest.fn();
jest.mock('@video-transcripts/shared/src/auth/firestoreRest', () => ({
    addInboxWord: (...a: unknown[]) => addInboxWord(...a),
    addFeedback: jest.fn(),
    addNoSubsReport: jest.fn(),
}));
jest.mock('@video-transcripts/shared/src/analytics-bg', () => ({
    track: jest.fn().mockResolvedValue(undefined),
    handleTrackMessage: jest.fn().mockResolvedValue({ ok: true }),
}));

import { getAuthState, setAuthState } from '@video-transcripts/shared/src/auth/storage';
import { handleAuthMessage, migrateLegacyAuthState } from '@video-transcripts/shared/src/auth/background';

const CONFIG = {
    projectId: 'demo',
    apiKey: 'k',
    apiBaseUrl: 'https://example.invalid',
    frontendBaseUrl: 'https://example.invalid',
    source: 'test',
} as any;

/** What the badge shows right now, as the toolbar would render it. */
const badge = () => {
    const calls = setBadgeText.mock.calls;
    return calls.length ? String(calls[calls.length - 1][0].text) : null;
};

const signedIn = () =>
    setAuthState({
        idToken: 'id',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
        email: 'reader@example.com',
        uid: 'u1',
    });

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    setBadgeText.mockClear();
    setBadgeBackgroundColor.mockClear();
    addInboxWord.mockReset();
});

describe('the toolbar badge when a session breaks', () => {
    it('a save refused by an expired session raises the badge', async () => {
        await signedIn();
        addInboxWord.mockRejectedValue(new Error('Firebase REST 401: TOKEN_EXPIRED'));

        await expect(
            handleAuthMessage({ action: 'ADD_WORD', term: 'word', context: '' }, CONFIG),
        ).rejects.toThrow();

        expect(badge()).toBe('!');
    });

    it('the badge is red, not a neutral count', async () => {
        await signedIn();
        addInboxWord.mockRejectedValue(new Error('Firebase REST 401: TOKEN_EXPIRED'));
        await handleAuthMessage({ action: 'ADD_WORD', term: 'word', context: '' }, CONFIG).catch(() => {});

        const [{ color }] = setBadgeBackgroundColor.mock.calls[0];
        expect(String(color).toLowerCase()).toBe('#dc2626');
    });

    /**
     * The half that stops "always raise it" passing. A save that fails for an
     * ordinary reason — the network, a 500 — is not a broken session, and
     * telling the person to sign in again would be wrong.
     */
    it('a save that fails for any other reason leaves the icon alone', async () => {
        await signedIn();
        addInboxWord.mockRejectedValue(new Error('Firestore commit 500: backend unavailable'));

        await handleAuthMessage({ action: 'ADD_WORD', term: 'word', context: '' }, CONFIG).catch(() => {});

        expect(setBadgeText).not.toHaveBeenCalled();
    });

    it('a save that succeeds leaves the icon alone', async () => {
        await signedIn();
        addInboxWord.mockResolvedValue({ wordId: 'w1' });

        await handleAuthMessage({ action: 'ADD_WORD', term: 'word', context: '' }, CONFIG);

        expect(setBadgeText).not.toHaveBeenCalled();
    });
});

describe('the badge is cleared again', () => {
    it('signing out clears it', async () => {
        await signedIn();
        addInboxWord.mockRejectedValue(new Error('Firebase REST 401: TOKEN_EXPIRED'));
        await handleAuthMessage({ action: 'ADD_WORD', term: 'word', context: '' }, CONFIG).catch(() => {});
        expect(badge()).toBe('!');

        await handleAuthMessage({ action: 'AUTH_SIGN_OUT' }, CONFIG);

        // Empty text IS the cleared badge — chrome renders no bubble for it.
        expect(badge()).toBe('');
    });
});

describe('a session left behind by an older version', () => {
    /**
     * Builds before the silent-refresh path was removed stored no refresh
     * token. Those sessions cannot recover on their own, so startup wipes them
     * and asks the person to sign in again — which is what the badge says.
     */
    it('a stored session with no refresh token raises the badge at startup', async () => {
        await setAuthState({
            idToken: 'id',
            refreshToken: '',
            expiresAt: Date.now() + 3_600_000,
            email: 'reader@example.com',
            uid: 'u1',
        });

        await migrateLegacyAuthState();

        expect(badge()).toBe('!');
    });

    it('a healthy session is left alone at startup', async () => {
        await signedIn();

        await migrateLegacyAuthState();

        expect(setBadgeText).not.toHaveBeenCalled();
    });

    it('no session at all is left alone at startup', async () => {
        await migrateLegacyAuthState();

        expect(setBadgeText).not.toHaveBeenCalled();
    });
});

/**
 * WHICH failures count as a dead session (auth/background.ts:102).
 *
 * Nine message substrings decide it, and getting the set wrong is costly in
 * both directions: too narrow and a revoked session keeps failing silently
 * forever; too wide and a flaky network signs the person out and demands they
 * re-authorize for nothing.
 *
 * isAuthFailure is private, so this drives its two observable consequences —
 * the session is wiped and the badge goes up — which is what a person actually
 * experiences.
 */
describe('which failures are treated as a dead session', () => {
    const REVOKED = [
        'Not signed in',
        'Firebase REST 400: bad request',
        'Firebase REST 401: unauthorized',
        'Firebase REST 403: forbidden',
        'Firestore commit 401: expired',
        'Firestore commit 403: denied',
        'Firestore sentinel 401: expired',
        'INVALID_REFRESH_TOKEN',
        'TOKEN_EXPIRED',
    ];

    it.each(REVOKED)('%s wipes the session and raises the badge', async (message) => {
        await signedIn();
        addInboxWord.mockRejectedValue(new Error(message));

        await handleAuthMessage({ action: 'ADD_WORD', term: 'w', context: '' }, CONFIG).catch(
            () => {},
        );

        expect(await getAuthState()).toBeNull();
        expect(badge()).toBe('!');
    });

    /**
     * The other direction, and the more expensive mistake: an outage, a
     * timeout, a 500 or a rejected value that is not an Error at all must leave
     * the person signed in. Being signed out by a flaky connection means losing
     * every save until they notice the icon.
     */
    const TRANSIENT: Array<[string, unknown]> = [
        ['a server error', new Error('Firestore commit 500: backend unavailable')],
        ['an offline network', new Error('Failed to fetch')],
        ['a timeout', new Error('The operation timed out')],
        ['a rate limit', new Error('Firestore commit 429: too many requests')],
        ['something that is not an Error', 'plain string rejection'],
    ];

    it.each(TRANSIENT)('%s leaves the session alone', async (_name, thrown) => {
        await signedIn();
        addInboxWord.mockRejectedValue(thrown);

        await handleAuthMessage({ action: 'ADD_WORD', term: 'w', context: '' }, CONFIG).catch(
            () => {},
        );

        expect(await getAuthState()).not.toBeNull();
        expect(setBadgeText).not.toHaveBeenCalled();
    });
});
