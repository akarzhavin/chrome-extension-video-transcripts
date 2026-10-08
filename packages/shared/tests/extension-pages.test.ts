/**
 * The extension's own pages (Settings, My words) are wired into both editions:
 * the manifest names the settings page as its options page, the pages exist,
 * and each edition's build produces their bundles and copies their html and css.
 *
 * Read from the files rather than from a build: a build overwrites build/ and
 * needs secrets, and what goes wrong here is a forgotten line in one of two
 * near-identical configs, which a read of the config catches.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

const APPS = ['youtube', 'rezka'] as const;

describe.each(APPS)('the %s edition', (app) => {
    const manifest = JSON.parse(read(`apps/${app}/manifest.json`));
    const vite = read(`apps/${app}/vite.config.ts`);
    const pkg = JSON.parse(read(`apps/${app}/package.json`));

    test('declares settings.html as its options page, and keeps the popup', () => {
        expect(manifest.options_page).toBe('settings.html');
        expect(manifest.action.default_popup).toBe('popup.html');
    });

    test('has an entry for each page that starts it', () => {
        expect(read(`apps/${app}/src/settings/settings.ts`)).toContain(`initSettings({ edition: '${app}'`);
        expect(read(`apps/${app}/src/words/words.ts`)).toContain('initWords();');
    });

    test('builds both bundles, in the full and in the dev build', () => {
        for (const script of ['build:vite:raw', 'build:dev:raw']) {
            expect(pkg.scripts[script]).toContain('--mode settings');
            expect(pkg.scripts[script]).toContain('--mode words');
        }
        expect(vite).toContain("return 'src/settings/settings.js'");
        expect(vite).toContain("return 'src/words/words.js'");
        expect(vite).toContain("resolve(__dirname, 'src/settings/settings.ts')");
        expect(vite).toContain("resolve(__dirname, 'src/words/words.ts')");
    });

    test('copies the two pages and their shared stylesheet next to the popup', () => {
        expect(vite).toContain("src: '../../packages/shared/src/settings/settings.html'");
        expect(vite).toContain("src: '../../packages/shared/src/words/words.html'");
        expect(vite).toContain("src: '../../packages/shared/src/pages/page.css'");
        expect(vite).toContain("dest: 'src/pages'");
    });
});

describe('the pages themselves', () => {
    test.each([
        ['settings', 'src/settings/settings.js'],
        ['words', 'src/words/words.js'],
    ])('%s.html exists and loads the bundle the build emits', (page, bundle) => {
        const rel = `packages/shared/src/${page}/${page}.html`;
        expect(existsSync(join(REPO, rel))).toBe(true);
        expect(read(rel)).toContain(`<script src="${bundle}"></script>`);
    });

    test('both pages load the stylesheets that are copied', () => {
        for (const page of ['settings', 'words']) {
            const html = read(`packages/shared/src/${page}/${page}.html`);
            expect(html).toContain('href="src/popup/popup.css"');
            expect(html).toContain('href="src/pages/page.css"');
        }
        expect(existsSync(join(REPO, 'packages/shared/src/pages/page.css'))).toBe(true);
    });
});

describe('the release checks know the new bundles', () => {
    test('the build script looks for the GA4 secret in them', () => {
        const script = read('scripts/build-with-analytics.sh');
        expect(script).toContain('"apps/$app/build/src/settings/settings.js"');
        expect(script).toContain('"apps/$app/build/src/words/words.js"');
    });

    test('the archive check reads them as page-readable', () => {
        const verify = read('packages/shared/verify-zip.mjs');
        expect(verify).toContain("'src/settings/settings.js'");
        expect(verify).toContain("'src/words/words.js'");
    });
});

describe('the pages never reach the analytics secret', () => {
    // analytics-bg reads __GA4_API_SECRET__; a page bundle that imports it, even
    // transitively, ships the secret to everything that can read the page.
    const FILES = [
        'packages/shared/src/settings/settings.ts',
        'packages/shared/src/words/words.ts',
        'packages/shared/src/popup/popup.ts',
        'packages/shared/src/popup/shared.ts',
    ];
    test.each(FILES)('%s does not import analytics-bg, the settings bridge or the worker', (file) => {
        const src = read(file);
        expect(src).not.toMatch(/from '[^']*analytics-bg'/);
        expect(src).not.toMatch(/from '[^']*settings-bridge'/);
        expect(src).not.toMatch(/from '[^']*auth\/background'/);
    });
});

describe('the texts of the pages', () => {
    // Each i18nMsg('key', 'fallback') in the pages must have the same English in
    // both editions' en files: the fallback is what shows when chrome.i18n is
    // absent, and a different text there is a second wording nobody reviewed.
    const SOURCES = [
        'packages/shared/src/popup/popup.ts',
        'packages/shared/src/words/words.ts',
    ];
    const CALL = /i18nMsg\(\s*'([A-Za-z0-9_]+)',\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
    const found: Array<{ file: string; key: string; fallback: string }> = [];
    for (const file of SOURCES) {
        for (const m of read(file).matchAll(CALL)) {
            found.push({ file, key: m[1], fallback: (m[2] ?? m[3]).replace(/\\'/g, "'") });
        }
    }

    test('the sweep finds the calls it is meant to check', () => {
        // settings.ts left the list: it is a redirect to the site's page and has no texts.
        expect(found.length).toBeGreaterThan(25);
        expect(found.map((f) => f.key)).toContain('wordsRemoveFailed');
        expect(found.map((f) => f.key)).toContain('popupSettingsLink');
        expect(found.map((f) => f.key)).toContain('popupEmptyText');
    });

    test.each(APPS)('every key exists in the %s English file with the same text', (app) => {
        const en = JSON.parse(read(`apps/${app}/_locales/en/messages.json`));
        const wrong = found
            .filter((f) => en[f.key]?.message !== f.fallback)
            .map((f) => `${f.key}: file says "${f.fallback}", en says "${en[f.key]?.message}"`);
        expect(wrong).toEqual([]);
    });

    test.each(APPS)('the %s English file has no Chrome $NAME$ placeholders in the new keys', (app) => {
        const en = JSON.parse(read(`apps/${app}/_locales/en/messages.json`));
        for (const { key } of found) {
            expect(en[key].message).not.toMatch(/\$[A-Za-z_]+\$/);
            expect(en[key]).not.toHaveProperty('placeholders');
        }
    });

    test('the two English files agree on every key the pages use', () => {
        const yt = JSON.parse(read('apps/youtube/_locales/en/messages.json'));
        const rz = JSON.parse(read('apps/rezka/_locales/en/messages.json'));
        for (const { key } of found) expect(rz[key].message).toBe(yt[key].message);
    });

    test('the old keys are gone from both English files', () => {
        for (const app of APPS) {
            const en = JSON.parse(read(`apps/${app}/_locales/en/messages.json`));
            for (const key of ['ytSignInToSave', 'popupPageHighlightHint', 'popupGroupWebsites', 'popupSitesHint', 'popupVideoSites']) {
                expect(en).not.toHaveProperty(key);
            }
            expect(en.ytSignInToKeepWords.message).toBe('Sign in to keep your words');
        }
    });
});
