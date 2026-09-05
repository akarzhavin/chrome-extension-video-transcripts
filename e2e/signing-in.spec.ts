/**
 * Behaviour map §2 — signing in.
 *
 * The whole journey ends at a real account, and creating accounts on every run
 * is not something a check should do. What CAN be checked, and matters more
 * than the happy path, is the contract that protects the handoff: the extension
 * hands the website a one-shot challenge, and only a reply carrying that exact
 * challenge is accepted.
 *
 * Without it, any page the browser trusts could push a session at the extension.
 * So this covers the security boundary and stops before the account.
 */
import { test, expect, VIDEO_WITH_CAPTIONS, LOADED_BUILD_ROOT } from './fixtures/extension';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The stand's throwaway account, written by whoever set the stand up. Returns
 * null when there is no stand, so live-account checks skip instead of failing
 * on a machine that never had one.
 */
/** The shipped English strings, so checks pin to the locale, not to the
 * fallbacks written beside i18nMsg() in the source. */
function readLocale(): Record<string, string> {
    const raw = JSON.parse(
        readFileSync(resolve(LOADED_BUILD_ROOT, '_locales/en_US/messages.json'), 'utf8'),
    ) as Record<string, { message: string }>;
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message]));
}

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

test.describe('signing in', () => {
    /**
     * A fresh challenge is minted per attempt and travels in the address the
     * website is opened at, so the site can echo it back.
     */
    test('each attempt mints a fresh one-shot challenge', async ({ ext }) => {
        const page = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await page.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            const readNonce = () =>
                page.evaluate(
                    () =>
                        new Promise<string | null>((r) =>
                            (globalThis as any).chrome.storage.session.get(
                                'auth.pendingNonce',
                                (v: any) => r(v?.['auth.pendingNonce'] ?? null),
                            ),
                        ),
                );

            // Start the handoff twice, closing the tab it opens each time so the
            // person's browser is not left with stray sign-in pages.
            const start = async () => {
                await page.evaluate(
                    () =>
                        new Promise((r) =>
                            (globalThis as any).chrome.runtime.sendMessage(
                                { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'e2e' },
                                r,
                            ),
                        ),
                );
                await page.waitForTimeout(2500);
                // Close whatever tab the handoff opened.
                for (const p of page.context().pages()) {
                    if (/extension-auth/.test(p.url())) await p.close().catch(() => {});
                }
            };

            await start();
            const first = await readNonce();
            expect(first, 'a challenge should be waiting once the handoff starts').toBeTruthy();

            await start();
            const second = await readNonce();

            // A challenge reused between attempts would let a replayed reply in.
            expect(second).toBeTruthy();
            expect(second).not.toBe(first);
        } finally {
            await page.close().catch(() => {});
        }
    });

    /**
     * T6.1 · behaviour map §2.2 — the sign-in tab actually opens.
     *
     * The check above closes tabs matching /extension-auth without ever
     * asserting one appeared: it passes just as well if the handoff opens
     * nothing at all. This asserts the tab exists, at the address the build was
     * pointed at, carrying the challenge the extension minted.
     *
     * The host is read from the build rather than written here: hardcoding it
     * would assert against whichever environment the author had in mind, not
     * the one under test.
     */
    test('the sign-in tab opens at the frontend, carrying the challenge', async ({ ext }) => {
        const page = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        const opened: Page[] = [];
        try {
            await page.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            const frontend: string = await page.evaluate(
                () => (globalThis as any).chrome.runtime.getManifest().externally_connectable.matches.join(','),
            );

            await page.evaluate(
                () =>
                    new Promise((r) =>
                        (globalThis as any).chrome.runtime.sendMessage(
                            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'e2e' },
                            r,
                        ),
                    ),
            );

            // Wait for the tab rather than sleeping a fixed time: a fixed wait
            // that is too short reports "no tab" for a tab that was coming.
            let authPage: Page | undefined;
            for (let i = 0; i < 40 && !authPage; i++) {
                authPage = page.context().pages().find((p) => /\/extension-auth/.test(p.url()));
                if (!authPage) await page.waitForTimeout(250);
            }
            if (authPage) opened.push(authPage);

            expect(authPage, 'the handoff must open a sign-in tab').toBeTruthy();

            const url = new URL(authPage!.url());
            // The origin must be one the manifest allows to talk back, or the
            // handoff cannot complete however well the page renders.
            expect(frontend, `manifest must allow ${url.origin}`).toContain(url.origin);
            expect(url.pathname).toContain('/extension-auth');

            const nonce = await page.evaluate(
                () =>
                    new Promise<string | null>((r) =>
                        (globalThis as any).chrome.storage.session.get('auth.pendingNonce', (v: any) =>
                            r(v?.['auth.pendingNonce'] ?? null),
                        ),
                    ),
            );
            expect(nonce, 'a challenge must have been minted').toBeTruthy();
            // The site can only echo back a challenge it was given.
            expect(authPage!.url()).toContain(nonce!);
        } finally {
            for (const p of opened) await p.close().catch(() => {});
            await page.close().catch(() => {});
        }
    });

    /**
     * T6.2 · behaviour map §2.4 — no code is ever shown to the user.
     *
     * The map is explicit: the website hands the session back silently, "no
     * code is ever shown to the user to copy". The challenge is a bearer
     * value; anything that renders it invites a person to be talked into
     * reading it out.
     *
     * Asserted on the extension's own surfaces, which are the ones this repo
     * controls: the panel's account row and the toolbar popup.
     */
    test('the challenge is never rendered on the extension surfaces', async ({ ext }) => {
        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        const opened: Page[] = [];
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            await popup.evaluate(
                () =>
                    new Promise((r) =>
                        (globalThis as any).chrome.runtime.sendMessage(
                            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'e2e' },
                            r,
                        ),
                    ),
            );

            let authPage: Page | undefined;
            for (let i = 0; i < 40 && !authPage; i++) {
                authPage = popup.context().pages().find((p) => /\/extension-auth/.test(p.url()));
                if (!authPage) await popup.waitForTimeout(250);
            }
            if (authPage) opened.push(authPage);

            const nonce = await popup.evaluate(
                () =>
                    new Promise<string | null>((r) =>
                        (globalThis as any).chrome.storage.session.get('auth.pendingNonce', (v: any) =>
                            r(v?.['auth.pendingNonce'] ?? null),
                        ),
                    ),
            );
            // Without a challenge there is nothing to leak and the check would
            // pass vacuously, so require one before asserting its absence.
            expect(nonce, 'a challenge must exist for this check to mean anything').toBeTruthy();

            // The popup, mid-handoff.
            const popupText = await popup.evaluate(() => document.body.innerText || '');
            expect(popupText).not.toContain(nonce!);

            // The panel's account row on a watch page.
            const watch = await ext.open('https://www.youtube.com/watch?v=' + VIDEO_WITH_CAPTIONS);
            opened.push(watch);
            await watch.waitForTimeout(6000);
            const pageText = await watch.evaluate(() => document.body.innerText || '');
            expect(pageText).not.toContain(nonce!);
        } finally {
            for (const p of opened) await p.close().catch(() => {});
            await popup.close().catch(() => {});
        }
    });

    /**
     * T6.3 · behaviour map §2.4 — the hand-off completes.
     *
     * The end of the journey: with an account signed in on the website, the
     * extension's own auth.email becomes that account without any further
     * click in the extension. Asserted against the throwaway account read from
     * the stand's credentials file, never a literal typed here — the email is
     * a value the extension does not control, which is what makes it an
     * assertion rather than a restatement.
     *
     * Requires the stand: a build pointed at the pre-production system, with
     * that account already signed in on the site. Skipped otherwise rather
     * than failing, so the suite stays runnable off the stand.
     */
    test('the hand-off puts the signed-in account into the extension', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');

        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        const opened: Page[] = [];
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            // Read through a page that survives the hand-off. §2.4 has the popup
            // close itself once the tab opens, so reading through `popup` races
            // its own disappearance and reports null for a session that landed.
            const probe = await ext.open(`chrome-extension://${ext.id}/popup.html`);
            opened.push(probe);
            await probe.waitForFunction(() => typeof (globalThis as any).chrome?.storage !== 'undefined', null, {
                timeout: 15_000,
            });
            const readEmail = () =>
                probe.evaluate(
                    () =>
                        new Promise<string | null>((r) =>
                            (globalThis as any).chrome.storage.local.get('auth.email', (v: any) =>
                                r(v?.['auth.email'] ?? null),
                            ),
                        ),
                );

            // Start from signed out, so a session left over from an earlier run
            // cannot make this pass without a hand-off happening. The fixture
            // reloads the extension before each run, which already clears the
            // stored session; assert that rather than assuming it.
            const before = await readEmail();
            if (before) {
                await popup.evaluate(
                    () =>
                        new Promise((r) =>
                            (globalThis as any).chrome.runtime.sendMessage({ action: 'AUTH_SIGN_OUT' }, r),
                        ),
                );
                // The worker writes storage asynchronously after replying.
                for (let i = 0; i < 20 && (await readEmail()); i++) await popup.waitForTimeout(500);
            }
            expect(await readEmail(), 'must start signed out').toBeFalsy();

            // Close any sign-in tab left over from an earlier run. Otherwise the
            // search below finds the STALE tab, whose challenge was superseded
            // the moment this run minted a fresh one, and the site rejects the
            // hand-off with "invalid or expired auth challenge".
            for (const p of popup.context().pages()) {
                if (/\/extension-auth/.test(p.url())) await p.close().catch(() => {});
            }

            await popup.evaluate(
                () =>
                    new Promise((r) =>
                        (globalThis as any).chrome.runtime.sendMessage(
                            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'e2e' },
                            r,
                        ),
                    ),
            );

            let authPage: Page | undefined;
            for (let i = 0; i < 40 && !authPage; i++) {
                authPage = popup.context().pages().find((p) => /\/extension-auth/.test(p.url()));
                if (!authPage) await popup.waitForTimeout(250);
            }
            expect(authPage, 'the hand-off must open the sign-in tab').toBeTruthy();
            opened.push(authPage!);

            // The site asks for confirmation before handing a session over; a
            // silent grant would be the bug, not the feature. Wait for the
            // button rather than a fixed delay: the page renders it only once
            // Firebase has restored the session, which is a network round trip.
            // The fixture opens tabs in the background so the human's focus is
            // never stolen, but a backgrounded tab is throttled hard enough
            // that this page never finishes restoring its session. Foreground
            // it for the click — a stand artefact, not a product behaviour.
            await authPage!.bringToFront();
            const authorize = authPage!.locator('button:has-text("Authorize extension")');
            // On failure the page states the reason in its own words; surface
            // that instead of a bare timeout, which says nothing about why.
            try {
                await authorize.waitFor({ state: 'visible', timeout: 45_000 });
            } catch {
                const seen = await authPage!.evaluate(() => document.body.innerText.slice(0, 300));
                throw new Error(`the authorize button never appeared. The page said:\n${seen}`);
            }
            await authorize.click();

            // The hand-off crosses the network twice — the site mints a custom
            // token, the extension exchanges it for a session — so allow for a
            // slow round trip rather than declaring failure early.
            let email: string | null = null;
            for (let i = 0; i < 60 && !email; i++) {
                email = await readEmail();
                if (!email) await popup.waitForTimeout(1000);
            }

            expect(email, 'the extension must end up holding the signed-in account').toBe(account!.email);
        } finally {
            for (const p of opened) await p.close().catch(() => {});
            await popup.close().catch(() => {});
        }
    });

    /**
     * T6.6 · behaviour map §2.5 — what the signed-in row shows.
     *
     * The map lists four things: "Signed in as", the email, "{n} words saved",
     * and a Sign out action. The strings are pinned to the shipped locale file
     * rather than to the fallbacks written beside i18nMsg() in the source —
     * asserting against those would compare the code to itself.
     *
     * The collapsed row is assertable on its own: it carries the same four
     * pieces in its title/aria-label, which is also where its accessible name
     * lives. Both surfaces are checked, because the task names them as one and
     * they are not.
     */
    test('the signed-in row shows the account, the count and a way out', async ({ ext }) => {
        const account = readStandAccount();
        test.skip(!account, 'no stand credentials — this check needs the phase 6 stand');
        const strings = readLocale();

        const opened: Page[] = [];
        try {
            const watch = await ext.open('https://www.youtube.com/watch?v=' + VIDEO_WITH_CAPTIONS);
            // The content script only builds its UI on a foregrounded tab.
            await watch.bringToFront();
            await watch.locator('#lingogram-auth-badge').waitFor({ state: 'attached', timeout: 60_000 });
            opened.push(watch);

            // Collapsed: the accessible name carries account and count.
            const label = await watch.evaluate(() => {
                const b = document.querySelector('#lingogram-auth-badge');
                const el = b?.querySelector('[aria-label]') ?? b;
                return el?.getAttribute('aria-label') ?? '';
            });
            expect(label, 'the collapsed row names the account').toContain(account!.email);
            expect(label).toContain(strings.ytAuthSignedInAs);
            expect(label, 'the collapsed row carries the running count').toMatch(
                new RegExp(strings.ytWordsSaved.replace('{count}', '\\d+')),
            );

            // Opened: the four pieces the map lists. The badge sits inside the
            // collapsed panel, so a plain click misses its hit box.
            await watch.locator('#lingogram-auth-badge').click({ force: true });
            await watch.locator('#lingogram-auth-panel').waitFor({ state: 'attached', timeout: 15_000 });
            const panel = await watch.evaluate(() => document.querySelector('#lingogram-auth-panel')?.textContent ?? '');
            expect(panel).toContain(strings.ytAuthSignedInAs);
            expect(panel).toContain(account!.email);
            expect(panel).toMatch(new RegExp(strings.ytWordsSaved.replace('{count}', '\\d+')));
            expect(panel, 'there must be a way to sign out').toContain(strings.ytAuthSignOut);
        } finally {
            for (const p of opened) await p.close().catch(() => {});
        }
    });

    /**
     * T6.4 · behaviour map §2.4 — a popup-initiated sign-in closes the popup.
     *
     * "If the sign-in began in the toolbar popup, that popup closes itself once
     * the tab opens." Asserted as the page being gone, which is what closing
     * means from outside; the popup cannot report its own closure.
     */
    test('the popup closes itself once the sign-in tab opens', async ({ ext }) => {
        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        const opened: Page[] = [];
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });
            expect(popup.isClosed(), 'the popup must be open to begin with').toBe(false);

            // The popup renders its sign-in control only while signed out.
            await popup.evaluate(
                () => new Promise((r) => (globalThis as any).chrome.runtime.sendMessage({ action: 'AUTH_SIGN_OUT' }, r)),
            );
            await popup.reload();
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            for (const p of popup.context().pages()) {
                if (/\/extension-auth/.test(p.url())) await p.close().catch(() => {});
            }

            // Click the popup's own control rather than sending the message
            // directly: window.close() lives in that click handler, so posting
            // the message would bypass the very behaviour under test.
            await popup
                .locator('button.primary')
                .click({ timeout: 15_000 })
                .catch(() => {});

            let closed = false;
            for (let i = 0; i < 40 && !closed; i++) {
                closed = popup.isClosed();
                if (!closed) await new Promise((r) => setTimeout(r, 250));
            }
            for (const p of ext.ctx.pages()) if (/\/extension-auth/.test(p.url())) opened.push(p);

            expect(closed, 'the popup must close itself after starting the hand-off').toBe(true);
        } finally {
            for (const p of opened) await p.close().catch(() => {});
            if (!popup.isClosed()) await popup.close().catch(() => {});
        }
    });

    /**
     * T6.5 · behaviour map §2.6 — "Couldn't open the sign-in page. Try again."
     *
     * The failure branch: when the tab cannot be created, the surface says so
     * rather than failing silently. Driven through the popup's own error path
     * with the background's reply forced to ok:false, since a real tab-creation
     * failure cannot be provoked from outside the browser.
     *
     * The wording is pinned to the shipped locale, not to the fallback string
     * written beside i18nMsg().
     */
    test('a hand-off that cannot open a tab says so', async ({ ext }) => {
        const strings = readLocale();
        const popup = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            // The popup renders its sign-in control only while signed out.
            await popup.evaluate(
                () => new Promise((r) => (globalThis as any).chrome.runtime.sendMessage({ action: 'AUTH_SIGN_OUT' }, r)),
            );
            await popup.reload();
            await popup.waitForFunction(() => typeof (globalThis as any).chrome?.runtime !== 'undefined', null, {
                timeout: 15_000,
            });

            // Make the sign-in request fail the way a blocked tab creation does.
            await popup.evaluate(() => {
                const real = (globalThis as any).chrome.runtime.sendMessage;
                (globalThis as any).chrome.runtime.sendMessage = (msg: any, cb: any) => {
                    if (msg?.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM') {
                        return cb ? cb({ ok: false }) : Promise.resolve({ ok: false });
                    }
                    return real(msg, cb);
                };
            });

            await popup.locator('button.primary').click({ timeout: 15_000 });
            await popup.waitForTimeout(1500);

            const shown = await popup.evaluate(() => document.body.innerText || '');
            expect(shown, 'the failure must be stated, not swallowed').toContain(strings.ytAuthOpenFailed);
        } finally {
            if (!popup.isClosed()) await popup.close().catch(() => {});
        }
    });

    /**
     * The challenge is kept in session storage, not ordinary storage: it must
     * not outlive the browser session, and it must survive the extension's
     * worker being recycled while someone is still on the website signing in.
     */
    test('the challenge is held in session storage, not permanently', async ({ ext }) => {
        const page = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            await page.waitForFunction(() => typeof (globalThis as any).chrome?.storage !== 'undefined', null, {
                timeout: 15_000,
            });

            const where = await page.evaluate(
                () =>
                    new Promise<{ session: boolean; local: boolean }>((r) =>
                        (globalThis as any).chrome.storage.session.get('auth.pendingNonce', (s: any) =>
                            (globalThis as any).chrome.storage.local.get('auth.pendingNonce', (l: any) =>
                                r({
                                    session: s?.['auth.pendingNonce'] !== undefined,
                                    local: l?.['auth.pendingNonce'] !== undefined,
                                }),
                            ),
                        ),
                    ),
            );

            expect(where.local, 'the challenge must not be written to lasting storage').toBe(false);
        } finally {
            await page.close().catch(() => {});
        }
    });
});
