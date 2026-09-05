/**
 * Behaviour map §14, §15, §25 — saving a word, and what saving changes.
 *
 * Live against the pre-production system with a throwaway account signed in.
 * Every check here writes real rows, so each one skips rather than fails when
 * the stand is absent: LINGOGRAM_STAND_ACCOUNT names a credentials file, and
 * without it there is nothing to write to.
 *
 * Saves are rate limited — one second minimum between them, 500 a day (§14,
 * "Limits") — so anything saving repeatedly spaces itself out. Without that the
 * throttle decides the outcome instead of the claim.
 */
import { test, expect, VIDEO_WITH_CAPTIONS, LOADED_BUILD_ROOT } from './fixtures/extension';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIN_GAP_MS = 1_200;

function readStandAccount(): { email: string; password: string } | null {
    const path = process.env.LINGOGRAM_STAND_ACCOUNT;
    if (!path) return null;
    try {
        const kv = Object.fromEntries(
            readFileSync(path, 'utf8')
                .trim()
                .split('\n')
                .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
        );
        return kv.email && kv.password ? { email: kv.email, password: kv.password } : null;
    } catch {
        return null;
    }
}

function readLocale(): Record<string, string> {
    const raw = JSON.parse(
        readFileSync(resolve(LOADED_BUILD_ROOT, '_locales/en_US/messages.json'), 'utf8'),
    ) as Record<string, { message: string }>;
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message]));
}

/** A term unique to this run, so counting rows cannot pick up an earlier one. */
const uniqueTerm = () => `phase6-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

test.describe('saving a word', () => {
    /**
     * T6.7 · §14.1 — a real save lands.
     *
     * Asserted on the running total the extension keeps, which §14 names as the
     * only place the count is visible ("the extension shows just a running
     * total"). The delta is the claim; the absolute value is not, because
     * earlier runs on this install already moved it.
     */
    test('a save lands and moves the running total', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');

        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });
            const email = await popup.evaluate(
                () =>
                    new Promise<string | null>((r) =>
                        (globalThis as any).chrome.storage.local.get('auth.email', (v: any) =>
                            r(v?.['auth.email'] ?? null),
                        ),
                    ),
            );
            expect(email, 'the stand account must be signed in').toBe(account!.email);

            const readCount = () =>
                popup.evaluate(
                    () =>
                        new Promise<number>((r) =>
                            (globalThis as any).chrome.storage.local.get('inbox.count', (v: any) =>
                                r(Number(v?.['inbox.count'] ?? 0)),
                            ),
                        ),
                );

            const before = await readCount();
            const term = uniqueTerm();
            const res = (await popup.evaluate(
                (t) =>
                    new Promise((r) =>
                        (globalThis as any).chrome.runtime.sendMessage(
                            { action: 'ADD_WORD', term: t, context: 'a line of context', site: 'youtube' },
                            r,
                        ),
                    ),
                term,
            )) as { ok: boolean; wordId?: string; inboxCount?: number; error?: string };

            expect(res.ok, `the save must succeed (${res.error ?? ''})`).toBe(true);
            // A word id comes back from the server, so its presence is evidence
            // the row was written rather than queued locally.
            expect(res.wordId, 'the backend must return an id for the stored word').toBeTruthy();
            expect(await readCount(), 'the running total must move by exactly one').toBe(before + 1);
        } finally {
            await popup.close().catch(() => {});
        }
    });

    /**
     * T6.9 · §14.8 — saving the same word again creates a second entry.
     *
     * "There is no duplicate detection or merging." Two saves of one term must
     * therefore produce two distinct ids, and move the total twice.
     */
    test('the same word saved twice becomes two entries', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');

        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });
            const term = uniqueTerm();
            const save = () =>
                popup.evaluate(
                    (t) =>
                        new Promise((r) =>
                            (globalThis as any).chrome.runtime.sendMessage(
                                { action: 'ADD_WORD', term: t, context: 'context', site: 'youtube' },
                                r,
                            ),
                        ),
                    term,
                ) as Promise<{ ok: boolean; wordId?: string; error?: string }>;

            const first = await save();
            expect(first.ok, `first save must succeed (${first.error ?? ''})`).toBe(true);
            // §14 sets a one-second floor between saves; without the gap the
            // throttle, not the claim, decides what happens.
            await popup.waitForTimeout(MIN_GAP_MS);
            const second = await save();
            expect(second.ok, `second save must succeed (${second.error ?? ''})`).toBe(true);

            expect(second.wordId, 'the second save must create its own entry').not.toBe(first.wordId);
        } finally {
            await popup.close().catch(() => {});
        }
    });

    /**
     * T6.10 · §25.1 — the count agrees across the two surfaces.
     *
     * The panel row and the toolbar popup both show "{n} words saved"; §25 has
     * them as two indicators of one state, so they must not disagree after a
     * save.
     */
    test('the count agrees between the panel row and the popup', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');
        const strings = readLocale();

        const opened: Page[] = [];
        try {
            const watch = await ext.open('https://www.youtube.com/watch?v=' + VIDEO_WITH_CAPTIONS);
            opened.push(watch);
            await watch.bringToFront();
            await watch.locator('#lingogram-auth-badge').waitFor({ state: 'attached', timeout: 60_000 });

            // A content script's page has no chrome.runtime here, so the save
            // is sent from an extension page; the row is still read from the
            // watch page, which is the surface under test.
            const sender = await ext.open(`chrome-extension://${ext.id}/popup.html`);
            opened.push(sender);
            await sender.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });
            const save = (await sender.evaluate(
                (t) =>
                    new Promise((r) =>
                        (globalThis as any).chrome.runtime.sendMessage(
                            { action: 'ADD_WORD', term: t, context: 'context', site: 'youtube' },
                            r,
                        ),
                    ),
                uniqueTerm(),
            )) as { ok: boolean; inboxCount?: number; error?: string };
            expect(save.ok, `the save must succeed (${save.error ?? ''})`).toBe(true);

            const expected = strings.ytWordsSaved.replace('{count}', String(save.inboxCount));

            // The row redraws on the storage change rather than on a reload.
            await expect
                .poll(
                    async () =>
                        watch.evaluate(() => {
                            const b = document.querySelector('#lingogram-auth-badge');
                            const el = b?.querySelector('[aria-label]') ?? b;
                            return el?.getAttribute('aria-label') ?? '';
                        }),
                    { timeout: 30_000 },
                )
                .toContain(expected);

            const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
            opened.push(popup);
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.storage !== 'undefined', null, {
                timeout: 15_000,
            });
            await popup.waitForTimeout(1500);
            const popupText = await popup.evaluate(() => document.body.innerText || '');
            expect(popupText, 'the popup must show the same total as the row').toContain(expected);
        } finally {
            for (const p of opened) await p.close().catch(() => {});
        }
    });
});

test.describe('what a saved word carries', () => {
    /**
     * T6.8 · §14.2, §14.4 — the entry carries context, and only context.
     *
     * The task asks for the stored document's fields. They cannot be read back
     * from here: `allow read` on /inbox/{uid}/words/{id} requires an UNSCOPED
     * token, and the extension holds a scoped one — write-only by design, so
     * that a compromised extension cannot enumerate someone's words. §14 says
     * the same thing from the product side: "the extension has no dictionary
     * browser".
     *
     * So this asserts what the extension actually controls — the write it
     * sends — against the two shapes §14 fixes: a save with context and a save
     * without one. The latter is the case the task's "exactly five fields"
     * wording would have failed on: `context` is only written when non-empty
     * (firestoreRest.ts), so a word saved without it carries four, and
     * `addedAt` is a server-side transform rather than a field the client
     * sends at all.
     *
     * The backend's own schema gate is the other half: the rules accept only
     * term/source/sourceUrl/context/title/addedAt/processed, so a write
     * carrying anything else is rejected. A save that succeeds is therefore
     * evidence the shape was accepted, which is the assertable part of §14.4.
     */
    test('a save succeeds with context and without it', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');

        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });
            const save = (term: string, context: string) =>
                popup.evaluate(
                    ([t, c]) =>
                        new Promise((r) =>
                            (globalThis as any).chrome.runtime.sendMessage(
                                { action: 'ADD_WORD', term: t, context: c, site: 'youtube' },
                                r,
                            ),
                        ),
                    [term, context] as [string, string],
                ) as Promise<{ ok: boolean; wordId?: string; error?: string }>;

            const withContext = await save(uniqueTerm(), 'one line of the language being learned');
            expect(withContext.ok, `a save with context must be accepted (${withContext.error ?? ''})`).toBe(true);
            expect(withContext.wordId).toBeTruthy();

            await popup.waitForTimeout(MIN_GAP_MS);

            // The shape the "exactly five fields" wording would have rejected.
            const withoutContext = await save(uniqueTerm(), '');
            expect(
                withoutContext.ok,
                `a save without context must be accepted too (${withoutContext.error ?? ''})`,
            ).toBe(true);
            expect(withoutContext.wordId).toBeTruthy();
        } finally {
            await popup.close().catch(() => {});
        }
    });
});

test.describe('the review ask', () => {
    /**
     * T6.13 · §15.2, §15.3 — the card fires on the fifth save, once, ever.
     *
     * §15 fixes the threshold at 5 and says the one-shot is spent "the moment
     * the card is shown", so nothing re-arms it. Both halves are asserted: the
     * fifth save signals the card, the sixth does not.
     *
     * The threshold is pinned to the literal 5, not to the constant the code
     * reads — importing RATE_PROMPT_WORD_THRESHOLD would compare the code to
     * itself. 5 is a deliberate product decision (it was 30), so the literal is
     * the claim.
     *
     * A fresh install is load-bearing here. The gate is `>=`, not `==`, and the
     * one-shot burns at decision time, so with a non-zero starting count the
     * fifth save is not the fifth and the check would pass while asserting
     * nothing. The two counters are therefore reset first — the extension's own
     * install-local bookkeeping, not the account's words, which stay on the
     * server.
     */
    test('the review card fires on the fifth save and never again', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');

        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });
            const signedIn = await popup.evaluate(
                () =>
                    new Promise<string | null>((r) =>
                        (globalThis as any).chrome.storage.local.get('auth.email', (v: any) =>
                            r(v?.['auth.email'] ?? null),
                        ),
                    ),
            );
            test.skip(signedIn !== account!.email, 'the stand account must be signed in for real saves');

            // Simulate a fresh install: the install-local counters only.
            await popup.evaluate(
                () =>
                    new Promise((r) =>
                        (globalThis as any).chrome.storage.local.remove(
                            ['rate.savedWordCount', 'rate.promptShown'],
                            r,
                        ),
                    ),
            );

            const save = () =>
                popup.evaluate(
                    (t) =>
                        new Promise((r) =>
                            (globalThis as any).chrome.runtime.sendMessage(
                                { action: 'ADD_WORD', term: t, context: 'context', site: 'youtube' },
                                r,
                            ),
                        ),
                    uniqueTerm(),
                ) as Promise<{ ok: boolean; promptRate?: boolean; error?: string }>;

            const prompted: boolean[] = [];
            for (let i = 0; i < 6; i++) {
                const r = await save();
                expect(r.ok, `save ${i + 1} must succeed (${r.error ?? ''})`).toBe(true);
                prompted.push(!!r.promptRate);
                // §14's one-second floor between saves.
                await popup.waitForTimeout(MIN_GAP_MS);
            }

            expect(prompted.slice(0, 4), 'saves before the fifth must not ask').toEqual([
                false,
                false,
                false,
                false,
            ]);
            expect(prompted[4], 'the fifth save must ask for a review').toBe(true);
            expect(prompted[5], 'the sixth must not ask again').toBe(false);

            // Nothing re-arms it: a further save after the one-shot is spent.
            const again = await save();
            expect(again.ok).toBe(true);
            expect(again.promptRate, 'the one-shot does not come back').toBeFalsy();
        } finally {
            await popup.close().catch(() => {});
        }
    });
});

/**
 * These two run last and in this order: T6.11 signs the account out, and T6.12
 * reads the state that sign-out leaves behind. Anything needing a signed-in
 * account must have run already.
 */
test.describe('signing out', () => {
    /**
     * T6.11 · §14.9 — saving while signed out is refused, in words.
     *
     * "The attempt is made and fails, with the message 'Sign in via the
     * Lingogram row above the subtitle list to save words.'" The wording is
     * pinned to the shipped locale; the branch that selects it keys off the
     * backend's refusal, so this asserts the refusal actually arrives.
     *
     * Only possible with a disposable session — this is the case the earlier
     * phases excluded rather than sign a real account out.
     */
    test('a save while signed out is refused with the sign-in message', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');
        const strings = readLocale();

        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            await popup.evaluate(
                () => new Promise((r) => (globalThis as any).chrome.runtime.sendMessage({ action: 'AUTH_SIGN_OUT' }, r)),
            );

            const res = (await popup.evaluate(
                (t) =>
                    new Promise((r) =>
                        (globalThis as any).chrome.runtime.sendMessage(
                            { action: 'ADD_WORD', term: t, context: 'context', site: 'youtube' },
                            r,
                        ),
                    ),
                uniqueTerm(),
            )) as { ok: boolean; error?: string };

            expect(res.ok, 'a signed-out save must not succeed').toBe(false);
            // The content script turns exactly this into the user-facing line;
            // assert the trigger, and that the shipped wording exists for it.
            expect(String(res.error ?? ''), 'the refusal must say the session is missing').toMatch(
                /not signed in|sign in via/i,
            );
            expect(strings.ytQuickAddNeedsSignIn).toBe(
                'Sign in via the Lingogram row above the subtitle list to save words.',
            );
        } finally {
            await popup.close().catch(() => {});
        }
    });

    /**
     * T6.12 · §2.8 — signing out keeps the count and the one-shot.
     *
     * "Signing out ... deliberately keeps the running count of words saved on
     * this installation and the record that the review prompt has already been
     * shown — on the reasoning that it is still the same person." The live twin
     * of the unit check T2.11.
     */
    test('signing out keeps the saved count and the review one-shot', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');

        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });
            const read = () =>
                popup.evaluate(
                    () =>
                        new Promise<Record<string, unknown>>((r) =>
                            (globalThis as any).chrome.storage.local.get(
                                ['rate.savedWordCount', 'rate.promptShown', 'inbox.count'],
                                (v: any) => r(v ?? {}),
                            ),
                        ),
                );

            const before = await read();
            // The claim is about what sign-out preserves, so there must be
            // something to preserve.
            expect(Number(before['rate.savedWordCount'] ?? 0), 'need a non-zero count to assert it survives')
                .toBeGreaterThan(0);

            await popup.evaluate(
                () => new Promise((r) => (globalThis as any).chrome.runtime.sendMessage({ action: 'AUTH_SIGN_OUT' }, r)),
            );
            await popup.waitForTimeout(1500);

            const after = await read();
            expect(after['rate.savedWordCount'], 'the running count survives sign-out').toBe(
                before['rate.savedWordCount'],
            );
            expect(after['rate.promptShown'], 'the review one-shot survives sign-out').toBe(before['rate.promptShown']);
            expect(after['inbox.count'], 'the inbox total survives sign-out').toBe(before['inbox.count']);
        } finally {
            await popup.close().catch(() => {});
        }
    });
});
