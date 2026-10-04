/**
 * What build.mjs emits for /welcome/: the setup-steps host, the short closing
 * page behind it, and nothing of the page it replaced.
 *
 * Spawns build.mjs (it builds at module scope) and reads the HTML it writes,
 * like consent-build.test.ts, but into a temporary directory so the two can run
 * side by side.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const SITE = resolve(__dirname, '..');
// Its own output directory: other suites build into build/ at the same time.
const OUT = mkdtempSync(resolve(tmpdir(), 'site-welcome-'));
const LOCALES = readdirSync(resolve(SITE, 'src/data/i18n'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

jest.setTimeout(120_000);

const page = (rel: string) => readFileSync(resolve(OUT, rel), 'utf8');
let en: string;
let ru: string;

beforeAll(() => {
  const proc = spawnSync(process.execPath, ['build.mjs'], { cwd: SITE, env: { ...process.env, SITE_BUILD_DIR: OUT }, encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`build.mjs exited ${proc.status}: ${proc.stderr}`);
  en = page('welcome/index.html');
  ru = page('ru/welcome/index.html');
});

test('the steps have their host and their data on every locale page', () => {
  for (const code of LOCALES) {
    const html = page(code === 'en' ? 'welcome/index.html' : `${code}/welcome/index.html`);
    expect(html).toContain('<div class="ws" id="ws" hidden>');
    const payload = html.match(/window\.__WELCOME_STEPS = (\{.*?\});<\/script>/s);
    expect(payload).not.toBeNull();
    const data = JSON.parse(payload![1].replaceAll('\\u003c', '<'));
    expect(data.lang).toBe(code);
    // The language list that lets a native-language choice move to its page.
    expect([...data.locales].sort()).toEqual([...LOCALES].sort());
    expect(data.videos.en.id).toMatch(/^[\w-]{11}$/);
    expect(data.i18n.startTitle).toBeTruthy();
  }
});

test('the header is the logo alone and the footer the legal links', () => {
  expect(en).not.toContain('<nav class="top">');
  expect(en).not.toContain('btn-login');
  expect(en).toContain('footer class="site wrap slim"');
  expect(en).toContain('href="/privacy/"');
  // Not the product / help columns of the full footer.
  expect(en).not.toContain('class="f-col"');
});

test('the closing page keeps only what the steps do not say', () => {
  expect(en).toContain('id="wl-refresh"'); // reload the open tab
  expect(en).toContain('class="wl-keys"'); // the keys
  expect(en).toContain('id="wl-cover-tpl"'); // HDrezka address note, stamped out for ?ext=rezka only
  expect(en).toContain('class="wl-signoff"');
});

test('nothing is left of the page it replaced: no tour video, no site buttons, no privacy block', () => {
  for (const html of [en, ru]) {
    for (const gone of ['wl-facade', 'wl-opens', 'wl-priv', 'wl-hello', 'data-open-rezka', 'youtube-nocookie', 'i.ytimg.com', '__WELCOME =']) {
      expect(html).not.toContain(gone);
    }
  }
});

test('the page speaks its own language', () => {
  expect(ru).toContain('<html lang="ru"');
  expect(ru).toContain('window.__WELCOME_STEPS');
});
