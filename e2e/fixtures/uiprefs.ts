/**
 * The reading preferences: which mode, whether the panel is collapsed, and
 * every caption style setting. All of it lives under one key in extension
 * storage — measured, not assumed; nothing style-shaped appears in ordinary
 * page storage.
 *
 * These belong to the person whose browser this is. The first batch of checks
 * touched only the language pair; this one changes how their panel looks and
 * behaves, so restoring is the main risk here rather than housekeeping.
 */
import type { Page } from '@playwright/test';
import type { ExtensionHandle } from './extension';

const PREFS_KEY = 'prefs.v1';

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

export async function readUiPrefs(ext: ExtensionHandle): Promise<unknown> {
    return withExtensionPage(ext, (p) =>
        p.evaluate(
            (key) =>
                new Promise((r) => (globalThis as any).chrome.storage.local.get(key, (v: any) => r(v?.[key] ?? null))),
            PREFS_KEY,
        ),
    );
}

export async function writeUiPrefs(ext: ExtensionHandle, prefs: unknown): Promise<void> {
    await withExtensionPage(ext, (p) =>
        p.evaluate(
            ([key, value]) =>
                new Promise<void>((r) =>
                    value === null
                        ? (globalThis as any).chrome.storage.local.remove(key as string, () => r())
                        : (globalThis as any).chrome.storage.local.set({ [key as string]: value }, () => r()),
                ),
            [PREFS_KEY, prefs] as [string, unknown],
        ),
    );
}

/**
 * Run a body and put the person's own preferences back afterwards, whether or
 * not it threw. Captures BEFORE the body runs, so a check that changes the mode
 * or collapses the panel cannot leave it that way.
 */
export async function preservingUiPrefs<T>(ext: ExtensionHandle, body: () => Promise<T>): Promise<T> {
    const original = await readUiPrefs(ext);
    try {
        return await body();
    } finally {
        await writeUiPrefs(ext, original).catch(() => {});
    }
}
