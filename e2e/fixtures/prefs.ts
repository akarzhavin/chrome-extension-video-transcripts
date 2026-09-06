/**
 * The stored language pair.
 *
 * Absence is meaningful: with no pair stored the product shows a first-run
 * setup gate instead of subtitles, so a suite that ignored it would pass or fail
 * depending on whose profile it ran in. Read and written through an extension
 * page, which is where extension storage is reachable.
 */
import type { Page } from '@playwright/test';
import type { ExtensionHandle } from './extension';

const LANG_KEY = 'lang.v1';

export interface LangPrefs {
    learning: string;
    native: string;
}

async function withExtensionPage<T>(ext: ExtensionHandle, fn: (p: Page) => Promise<T>): Promise<T> {
    const page = await ext.open(`chrome-extension://${ext.id}/popup.html`);
    try {
        await page.waitForFunction(() => typeof (globalThis as any).chrome?.storage?.local !== 'undefined', null, {
            timeout: 15_000,
        });
        return await fn(page);
    } finally {
        await page.close().catch(() => {});
    }
}

export async function readPrefs(ext: ExtensionHandle): Promise<LangPrefs | null> {
    return withExtensionPage(ext, (p) =>
        p.evaluate(
            (key) =>
                new Promise((r) => (globalThis as any).chrome.storage.local.get(key, (v: any) => r(v?.[key] ?? null))),
            LANG_KEY,
        ),
    ) as Promise<LangPrefs | null>;
}

export async function writePrefs(ext: ExtensionHandle, prefs: LangPrefs | null): Promise<void> {
    await withExtensionPage(ext, (p) =>
        p.evaluate(
            ([key, value]) =>
                new Promise<void>((r) =>
                    value === null
                        ? (globalThis as any).chrome.storage.local.remove(key, () => r())
                        : (globalThis as any).chrome.storage.local.set({ [key as string]: value }, () => r()),
                ),
            [LANG_KEY, prefs] as [string, LangPrefs | null],
        ),
    );
}

/**
 * Run a body with a given pair (or none), restoring the human's own pair
 * afterwards whether or not the body threw.
 */
export async function withPrefs<T>(ext: ExtensionHandle, prefs: LangPrefs | null, body: () => Promise<T>): Promise<T> {
    const original = await readPrefs(ext);
    await writePrefs(ext, prefs);
    try {
        return await body();
    } finally {
        await writePrefs(ext, original).catch(() => {});
    }
}
