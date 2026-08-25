// Remote notifications: addressing rules, cache behaviour, and — the point of
// the whole file — that a broken notification channel never costs the caller
// anything. getNotification() sits in the sidebar's startup path, so "resolves
// to null instead of throwing" is a contract, not a nicety.

function makeStorageArea(): any {
    const store: Record<string, unknown> = {};
    return {
        get: jest.fn((keys: any) => {
            if (keys === null || keys === undefined) return Promise.resolve({ ...store });
            const keyArr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            const out: Record<string, unknown> = {};
            for (const k of keyArr) if (k in store) out[k] = store[k];
            return Promise.resolve(out);
        }),
        set: jest.fn((items: Record<string, unknown>) => {
            Object.assign(store, items);
            return Promise.resolve();
        }),
        remove: jest.fn((keys: string | string[]) => {
            const arr = typeof keys === 'string' ? [keys] : keys;
            for (const k of arr) delete store[k];
            return Promise.resolve();
        }),
        _store: store,
    };
}

const chromeStorage = { local: makeStorageArea(), session: makeStorageArea() };

(global as any).chrome = {
    runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
        lastError: undefined,
        // track() stamps every hit with the extension version and drops the
        // event if it cannot mint a client id, so the analytics assertions
        // below need both of these present.
        getManifest: () => ({ version: '1.0.16' }),
    },
    storage: chromeStorage,
};

// Relative import, not the barrel: notifications.ts pulls in analytics-bg (GA4
// api_secret) and is deliberately excluded from the package exports.
import {
    compareVersions,
    decodeNotificationDoc,
    dismissNotification,
    getNotification,
    pickLocalized,
    selectNotification,
    type NotificationDoc,
} from '../src/notifications';
import { PREFS_KEY } from '../src/prefs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function doc(over: Partial<NotificationDoc> = {}): NotificationDoc {
    return {
        id: 'n1',
        active: true,
        severity: 'warning',
        platforms: [],
        sources: [],
        locales: [],
        minVersion: '',
        maxVersion: '',
        expiresAt: '2030-01-01T00:00:00Z',
        dismissible: false,
        priority: 0,
        title: { en: 'Title' },
        body: { en: 'Body' },
        ...over,
    };
}

const QUERY = {
    version: '1.0.16',
    platform: 'youtube',
    source: 'youtube-extension',
    locale: 'en',
};

const NOW = Date.parse('2026-08-24T12:00:00Z');

function firestoreDoc(id: string, fields: Record<string, unknown>): unknown {
    return { name: `projects/p/databases/(default)/documents/notifications/${id}`, fields };
}

function jsonResponse(body: unknown, status = 200): any {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        json: async () => body,
    };
}

function clearStorage(): void {
    for (const k of Object.keys(chromeStorage.local._store)) delete chromeStorage.local._store[k];
}

beforeEach(() => {
    clearStorage();
    jest.restoreAllMocks();
    // Analytics is on by default; opting out would silence the failure events
    // some tests assert on.
    chromeStorage.local._store[PREFS_KEY] = { analyticsEnabled: true };
});

// ---------------------------------------------------------------------------
// compareVersions
// ---------------------------------------------------------------------------

describe('compareVersions', () => {
    // The case that makes string comparison wrong: '1.0.9' > '1.0.16'
    // lexicographically, which would exclude the exact build we target.
    it('orders 1.0.9 before 1.0.16', () => {
        expect(compareVersions('1.0.9', '1.0.16')).toBeLessThan(0);
        expect(compareVersions('1.0.16', '1.0.9')).toBeGreaterThan(0);
    });

    it('treats missing segments as zero', () => {
        expect(compareVersions('1.1', '1.1.0')).toBe(0);
        expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0);
    });

    it('reports equality', () => {
        expect(compareVersions('1.0.16', '1.0.16')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// pickLocalized
// ---------------------------------------------------------------------------

describe('pickLocalized', () => {
    it('prefers an exact match', () => {
        expect(pickLocalized({ en: 'E', ru: 'R' }, 'ru')).toBe('R');
    });

    it('falls back from a regional tag to its base language', () => {
        expect(pickLocalized({ en: 'E', pt: 'P' }, 'pt-BR')).toBe('P');
    });

    it('accepts underscore-form locales', () => {
        expect(pickLocalized({ en: 'E', pt: 'P' }, 'pt_BR')).toBe('P');
    });

    it('falls back to English for an untranslated locale', () => {
        expect(pickLocalized({ en: 'E' }, 'ja')).toBe('E');
    });

    it('returns empty when even English is missing', () => {
        expect(pickLocalized({ ru: 'R' }, 'ja')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// selectNotification
// ---------------------------------------------------------------------------

describe('selectNotification', () => {
    it('returns a matching notification resolved for the locale', () => {
        const got = selectNotification(
            [doc({ title: { en: 'T', ru: 'Т' }, body: { en: 'B', ru: 'Б' }, dismissible: true })],
            { ...QUERY, locale: 'ru' },
            NOW,
        );
        expect(got).toEqual({ id: 'n1', severity: 'warning', title: 'Т', body: 'Б', dismissible: true });
    });

    it('skips inactive documents', () => {
        expect(selectNotification([doc({ active: false })], QUERY, NOW)).toBeNull();
    });

    it('skips expired documents', () => {
        const past = new Date(NOW - 1000).toISOString();
        expect(selectNotification([doc({ expiresAt: past })], QUERY, NOW)).toBeNull();
    });

    it('keeps documents whose expiry is still ahead', () => {
        const future = new Date(NOW + 1000).toISOString();
        expect(selectNotification([doc({ expiresAt: future })], QUERY, NOW)).not.toBeNull();
    });

    it('skips a document with no expiresAt at all', () => {
        // Required field: a document that can never be taken down by date is
        // treated as broken, not as one that runs forever.
        expect(selectNotification([doc({ expiresAt: '' })], QUERY, NOW)).toBeNull();
    });

    it('a document missing expiresAt is skipped even when everything else fits', () => {
        // The whole point of making the field required: nothing reaches users
        // without a date on which it stops reaching them.
        const d = doc({ expiresAt: '', active: true, platforms: ['youtube'], priority: 99 });
        expect(selectNotification([d], QUERY, NOW)).toBeNull();
    });

    it('skips a document whose expiresAt cannot be parsed', () => {
        // Unparseable must not silently mean "never expires".
        expect(selectNotification([doc({ expiresAt: 'whenever' })], QUERY, NOW)).toBeNull();
    });

    it('matches platform, and rejects a different one', () => {
        expect(selectNotification([doc({ platforms: ['youtube'] })], QUERY, NOW)).not.toBeNull();
        expect(selectNotification([doc({ platforms: ['rezka'] })], QUERY, NOW)).toBeNull();
    });

    it('matches edition via sources', () => {
        expect(selectNotification([doc({ sources: ['youtube-extension'] })], QUERY, NOW)).not.toBeNull();
        expect(selectNotification([doc({ sources: ['rezka-extension'] })], QUERY, NOW)).toBeNull();
    });

    it('treats an empty list as "no restriction"', () => {
        const d = doc({ platforms: [], sources: [], locales: [] });
        expect(selectNotification([d], { ...QUERY, platform: 'netflix' }, NOW)).not.toBeNull();
    });

    it('matches a locale filter through the base language', () => {
        const d = doc({ locales: ['ru'] });
        expect(selectNotification([d], { ...QUERY, locale: 'ru-RU' }, NOW)).not.toBeNull();
        expect(selectNotification([d], { ...QUERY, locale: 'de' }, NOW)).toBeNull();
    });

    it('applies version bounds inclusively', () => {
        const d = doc({ minVersion: '1.0.16', maxVersion: '1.0.16' });
        expect(selectNotification([d], QUERY, NOW)).not.toBeNull();
        expect(selectNotification([d], { ...QUERY, version: '1.0.15' }, NOW)).toBeNull();
        expect(selectNotification([d], { ...QUERY, version: '1.0.17' }, NOW)).toBeNull();
    });

    it('spans the 9-to-16 range that string compare would break', () => {
        const d = doc({ minVersion: '1.0.9', maxVersion: '1.0.20' });
        expect(selectNotification([d], { ...QUERY, version: '1.0.16' }, NOW)).not.toBeNull();
    });

    it('skips a document with no English text', () => {
        // A title with no body reads as a rendering bug, not a message.
        const d = doc({ title: { ru: 'Т' }, body: { ru: 'Б' } });
        expect(selectNotification([d], { ...QUERY, locale: 'ja' }, NOW)).toBeNull();
    });

    it('skips a document missing a body even when the title resolves', () => {
        expect(selectNotification([doc({ body: {} })], QUERY, NOW)).toBeNull();
    });

    it('picks the highest priority', () => {
        const got = selectNotification(
            [doc({ id: 'low', priority: 0 }), doc({ id: 'high', priority: 5 })],
            QUERY,
            NOW,
        );
        expect(got?.id).toBe('high');
    });

    it('breaks priority ties on id so the choice is stable', () => {
        const a = selectNotification([doc({ id: 'b' }), doc({ id: 'a' })], QUERY, NOW);
        const b = selectNotification([doc({ id: 'a' }), doc({ id: 'b' })], QUERY, NOW);
        expect(a?.id).toBe('a');
        expect(b?.id).toBe('a');
    });

    it('never returns a dismissed notification', () => {
        expect(selectNotification([doc({ id: 'n1' })], QUERY, NOW, ['n1'])).toBeNull();
    });

    it('falls back to info for an unknown severity', () => {
        expect(selectNotification([doc({ severity: 'bogus' })], QUERY, NOW)?.severity).toBe('info');
    });
});

// ---------------------------------------------------------------------------
// decoding
// ---------------------------------------------------------------------------

describe('decodeNotificationDoc', () => {
    it('decodes every field type', () => {
        const got = decodeNotificationDoc(
            firestoreDoc('yt-outage', {
                active: { booleanValue: true },
                severity: { stringValue: 'critical' },
                platforms: { arrayValue: { values: [{ stringValue: 'youtube' }] } },
                priority: { integerValue: '7' },
                title: { mapValue: { fields: { en: { stringValue: 'T' } } } },
                body: { mapValue: { fields: { en: { stringValue: 'B' } } } },
            }) as any,
        );
        expect(got).toMatchObject({
            id: 'yt-outage',
            active: true,
            severity: 'critical',
            platforms: ['youtube'],
            priority: 7,
            title: { en: 'T' },
            body: { en: 'B' },
        });
    });

    it('degrades field-by-field on a malformed document', () => {
        // Documents are hand-written in the Firebase Console; one typo must not
        // take out the channel.
        const got = decodeNotificationDoc(
            firestoreDoc('broken', { active: { stringValue: 'yes' }, platforms: { stringValue: 'x' } }) as any,
        );
        expect(got).toMatchObject({ id: 'broken', active: false, platforms: [], priority: 0 });
    });

    it('rejects a document with no name', () => {
        expect(decodeNotificationDoc({ fields: {} } as any)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getNotification: cache + resilience
// ---------------------------------------------------------------------------

describe('getNotification', () => {
    const oneDoc = {
        documents: [
            firestoreDoc('n1', {
                active: { booleanValue: true },
                severity: { stringValue: 'warning' },
                // Required field — a document without it is never shown.
                expiresAt: { stringValue: '2030-01-01T00:00:00Z' },
                title: { mapValue: { fields: { en: { stringValue: 'T' } } } },
                body: { mapValue: { fields: { en: { stringValue: 'B' } } } },
            }),
        ],
    };

    it('fetches and returns a notification', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse(oneDoc));
        (global as any).fetch = fetchMock;
        await expect(getNotification(QUERY)).resolves.toMatchObject({ id: 'n1', title: 'T' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sends the api key and no Authorization header', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse(oneDoc));
        (global as any).fetch = fetchMock;
        await getNotification(QUERY);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/documents/notifications?key=');
        expect((init ?? {}).headers).toBeUndefined();
    });

    it('serves a fresh cache without touching the network', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse(oneDoc));
        (global as any).fetch = fetchMock;
        await getNotification(QUERY);
        await getNotification(QUERY);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refetches once the cache has aged past its TTL', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse(oneDoc));
        (global as any).fetch = fetchMock;
        await getNotification(QUERY);
        // 15 min + a second.
        chromeStorage.local._store['notif.cachedAt'] = Date.now() - (15 * 60 * 1000 + 1000);
        await getNotification(QUERY);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('resolves to null when the network is down', async () => {
        (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
        await expect(getNotification(QUERY)).resolves.toBeNull();
    });

    it('resolves to null on a 500', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse({}, 500));
        await expect(getNotification(QUERY)).resolves.toBeNull();
    });

    it('resolves to null on an unparseable body', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new Error('not json');
            },
        });
        await expect(getNotification(QUERY)).resolves.toBeNull();
    });

    it('treats an empty collection as "nothing to show", not a failure', async () => {
        // Firestore returns {} with no `documents` key for an empty collection.
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse({}));
        (global as any).fetch = fetchMock;
        await expect(getNotification(QUERY)).resolves.toBeNull();
        await getNotification(QUERY);
        // Cached as a success — no refetch, no backoff.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('serves stale cache while the backend is down', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse(oneDoc));
        await getNotification(QUERY);
        chromeStorage.local._store['notif.cachedAt'] = Date.now() - (16 * 60 * 1000);
        (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
        // An outage is exactly when the last-known message is most likely right.
        await expect(getNotification(QUERY)).resolves.toMatchObject({ id: 'n1' });
    });

    it('backs off instead of retrying on every call', async () => {
        // Count only the Firestore reads: a failure also fires a GA4 hit
        // through this same global fetch.
        const fetchMock = jest.fn((url: string) =>
            String(url).includes('ga4.test')
                ? Promise.resolve(jsonResponse({}, 204))
                : Promise.reject(new Error('offline')),
        ) as jest.Mock;
        (global as any).fetch = fetchMock;
        await getNotification(QUERY);
        await getNotification(QUERY);
        await getNotification(QUERY);
        const reads = fetchMock.mock.calls.filter(([u]) => !String(u).includes('ga4.test'));
        expect(reads).toHaveLength(1);
    });

    it('survives storage being unavailable', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse(oneDoc));
        const local = chromeStorage.local;
        (chromeStorage as any).local = {
            get: jest.fn().mockRejectedValue(new Error('no storage')),
            set: jest.fn().mockRejectedValue(new Error('no storage')),
        };
        try {
            await expect(getNotification(QUERY)).resolves.toMatchObject({ id: 'n1' });
        } finally {
            (chromeStorage as any).local = local;
        }
    });

    it('never returns a notification the user dismissed', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse(oneDoc));
        await expect(getNotification(QUERY)).resolves.toMatchObject({ id: 'n1' });
        await dismissNotification('n1');
        await expect(getNotification(QUERY)).resolves.toBeNull();
    });

    it('records a dismissal only once', async () => {
        await dismissNotification('n1');
        await dismissNotification('n1');
        expect(chromeStorage.local._store['notif.dismissed']).toEqual(['n1']);
    });

    it('ignores an empty dismissal id', async () => {
        await dismissNotification('');
        expect(chromeStorage.local._store['notif.dismissed']).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Failure analytics
// ---------------------------------------------------------------------------
//
// The GA4 hit is the only signal that this channel is broken in the field —
// everything else about a failure is deliberately silent. These assert on the
// outgoing request body rather than on a mocked track(), so a name that GA4
// would reject still shows up here.

describe('notification_fetch_failed', () => {
    function ga4Hits(fetchMock: jest.Mock): any[] {
        return fetchMock.mock.calls
            .filter(([url]) => String(url).includes('ga4.test'))
            .map(([, init]) => JSON.parse(String((init as any).body)));
    }

    async function failWith(impl: () => any): Promise<any[]> {
        const fetchMock = jest.fn((url: string) => {
            // The GA4 transport shares the global fetch with the Firestore read.
            if (String(url).includes('ga4.test')) return Promise.resolve(jsonResponse({}, 204));
            return impl();
        }) as jest.Mock;
        (global as any).fetch = fetchMock;
        await getNotification(QUERY);
        // track() is fire-and-forget; let its promise chain drain.
        await new Promise((r) => setTimeout(r, 0));
        return ga4Hits(fetchMock);
    }

    it('reports a network failure', async () => {
        const hits = await failWith(() => Promise.reject(new Error('offline')));
        expect(hits).toHaveLength(1);
        expect(hits[0].events[0].name).toBe('notification_fetch_failed');
        expect(hits[0].events[0].params.reason).toBe('network');
    });

    it('reports a timeout distinctly from a network error', async () => {
        const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
        const hits = await failWith(() => Promise.reject(abort));
        expect(hits[0].events[0].params.reason).toBe('timeout');
    });

    it('reports an http failure with its status', async () => {
        const hits = await failWith(() => Promise.resolve(jsonResponse({}, 503)));
        expect(hits[0].events[0].params).toMatchObject({ reason: 'http', status: 503 });
    });

    it('reports a parse failure', async () => {
        const hits = await failWith(() =>
            Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
        );
        expect(hits[0].events[0].params.reason).toBe('parse');
    });

    it('sends nothing on success', async () => {
        const fetchMock = jest.fn((url: string) =>
            Promise.resolve(jsonResponse(String(url).includes('ga4.test') ? {} : { documents: [] })),
        ) as jest.Mock;
        (global as any).fetch = fetchMock;
        await getNotification(QUERY);
        await new Promise((r) => setTimeout(r, 0));
        expect(ga4Hits(fetchMock)).toHaveLength(0);
    });

    it('carries no identifying detail', async () => {
        const hits = await failWith(() => Promise.resolve(jsonResponse({}, 500)));
        const params = hits[0].events[0].params;
        // No url, no document id, no uid — reason and status are the whole payload.
        expect(Object.keys(params).sort()).toEqual(
            expect.arrayContaining(['reason', 'status']),
        );
        expect(JSON.stringify(params)).not.toContain('notifications?key=');
    });

    it('respects the analytics opt-out', async () => {
        chromeStorage.local._store[PREFS_KEY] = { analyticsEnabled: false };
        const hits = await failWith(() => Promise.reject(new Error('offline')));
        expect(hits).toHaveLength(0);
    });
});
