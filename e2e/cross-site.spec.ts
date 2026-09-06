/**
 * One check, every platform.
 *
 * This is the trial run for platform-independent checks, deliberately kept to a
 * single claim: the panel appears and fills with subtitles. It is the product's
 * whole purpose, and it is stated identically for every site.
 *
 * The experiment's finding, worth more than the check itself: the assertions
 * needed no abstraction at all. `#vtt-sidebar` and `#vtt-list .vtt-item` are
 * this extension's own markup, so they read the same on YouTube and Netflix.
 * The ONLY thing that differed was how to reach a playing page — which is why
 * e2e/fixtures/sites.ts describes arrival and nothing else.
 *
 * What deliberately stays per-platform: claims that are about the host rather
 * than about us. YouTube's throttling behaviour, Netflix's on-demand language
 * catalogue, the player-menu layout — those are different products, not one
 * product on different sites, and merging them would assert a similarity that
 * does not exist.
 */
import { test, expect } from './fixtures/extension';
import { SITES } from './fixtures/sites';

for (const site of SITES) {
    test.describe(`${site.name}: the panel and the transcript`, () => {
        // Longer than the default: a first load on a cold site includes the
        // extension injecting, the manifest or caption track arriving, and the
        // transcript rendering.
        test.setTimeout(240_000);

        test('the panel opens and fills with subtitles', async ({ pageFor }) => {
            const reason = site.skipReason();
            test.skip(reason !== null, reason ?? '');

            // The shared page for THIS platform, cleaned and verified. It is
            // not closed afterwards: it belongs to the run, and closing it
            // would cost the next check on this platform a fresh load.
            const page = await pageFor(site);
            {
                await expect
                    .poll(() => page.evaluate(() => !!document.getElementById('vtt-sidebar')), {
                        timeout: 90_000,
                        message: `${site.name}: the panel never appeared`,
                    })
                    .toBe(true);

                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                () => document.querySelectorAll('#vtt-list .vtt-item').length,
                            ),
                        {
                            timeout: 120_000,
                            message: `${site.name}: the panel stayed empty`,
                        },
                    )
                    .toBeGreaterThan(0);

                // Lines with words in them. A parser that produced the right
                // NUMBER of blank rows would otherwise pass on both platforms.
                const withText = await page.evaluate(
                    () =>
                        [...document.querySelectorAll('#vtt-list .vtt-item')]
                            .slice(0, 5)
                            .map((n) => (n.textContent ?? '').trim())
                            .filter((t) => t.length > 0).length,
                );
                expect(withText, `${site.name}: every line was empty`).toBeGreaterThan(0);
            }
        });
    });
}
