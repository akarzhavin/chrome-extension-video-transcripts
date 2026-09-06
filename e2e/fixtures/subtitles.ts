/**
 * Waiting helpers. Every one of these WAITS for its condition — sampling the
 * page after a fixed delay produced three separate false failures against
 * working code, so it is banned here rather than discouraged.
 */
import type { Page } from '@playwright/test';
import { DEFAULT_SITE, type Site } from './sites';

/** Lines are present in the transcript. */
export async function waitForLines(page: Page, timeout = 90_000): Promise<number> {
    await page.waitForFunction(() => document.querySelectorAll('#vtt-list .vtt-item').length > 0, null, {
        timeout,
        polling: 250,
    });
    return page.evaluate(() => document.querySelectorAll('#vtt-list .vtt-item').length);
}

/**
 * Drive playback to a position and wait for the highlight to settle there.
 *
 * A background tab does not autoplay, so a check that merely waits for a
 * highlight reads zero against a perfectly working product. Measured: with
 * playback driven explicitly, exactly one line is highlighted.
 *
 * HOW to seek belongs to the host, not here. Writing `video.currentTime` works
 * on YouTube and destroys the player on Netflix — measured, the element is
 * removed and never comes back — so the gesture is delegated to `Site`. The
 * default keeps the YouTube behaviour for the checks that are not
 * parameterised over platforms.
 */
export async function playFrom(page: Page, seconds: number, site: Site = DEFAULT_SITE): Promise<void> {
    await site.playFrom(page, seconds);
}

/** The banner's terminal state — never its mere existence. */
export interface Banner {
    title: string;
    text: string;
    actions: { label: string; emergency: boolean; disabled: boolean }[];
}

const readBanner = () => {
    const n = document.getElementById('vtt-status');
    if (!n) return null;
    return {
        title: n.querySelector('.vtt-empty-state-title')?.textContent ?? '',
        text: n.querySelector('.vtt-empty-state-text')?.textContent ?? '',
        actions: [...n.querySelectorAll('.vtt-empty-state-action')].map((b) => ({
            label: b.textContent ?? '',
            emergency: b.classList.contains('vtt-empty-state-action--emergency'),
            disabled: (b as HTMLButtonElement).disabled,
        })),
    };
};

/**
 * Wait for a SETTLED notice.
 *
 * The same element renders "Searching for subtitles…" while a search is running
 * and the outcome afterwards, so waiting for the element to appear succeeds
 * almost immediately and asserts nothing. Measured directly — the first attempt
 * at this captured the loading state and would have compared it against the
 * expected wording forever.
 */
export async function waitForSettledBanner(page: Page, timeout = 120_000): Promise<Banner> {
    await page.waitForFunction(
        () => {
            const n = document.getElementById('vtt-status');
            if (!n) return false;
            const t = n.querySelector('.vtt-empty-state-title')?.textContent ?? '';
            return t.length > 0 && !/Searching/i.test(t);
        },
        null,
        { timeout, polling: 250 },
    );
    return (await page.evaluate(readBanner)) as Banner;
}

export async function currentBanner(page: Page): Promise<Banner | null> {
    return (await page.evaluate(readBanner)) as Banner | null;
}

/** Press a labelled action in the notice. */
export async function pressBannerAction(page: Page, match: RegExp): Promise<void> {
    const pressed = await page.evaluate((src) => {
        const re = new RegExp(src, 'i');
        const btn = [...document.querySelectorAll('.vtt-empty-state-action')].find((b) =>
            re.test(b.textContent ?? ''),
        ) as HTMLButtonElement | undefined;
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
    }, match.source);
    if (!pressed) throw new Error(`no enabled notice action matching ${match}`);
}
