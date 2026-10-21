/**
 * The pages the ChatGPT and Claude plugin listings link to: terms, support and
 * each plugin's privacy policy, all English-only like the other policies.
 *
 * Builds into its own temporary directory, like welcome-page.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const SITE = resolve(__dirname, '..');
const OUT = mkdtempSync(resolve(tmpdir(), 'site-plugin-'));

jest.setTimeout(120_000);

const page = (rel: string) => readFileSync(resolve(OUT, rel), 'utf8');

beforeAll(() => {
  const proc = spawnSync(process.execPath, ['build.mjs'], { cwd: SITE, env: { ...process.env, SITE_BUILD_DIR: OUT }, encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`build.mjs exited ${proc.status}: ${proc.stderr}`);
});

test.each([
  ['terms/index.html', 'Terms of Service'],
  ['support/index.html', 'Support'],
  ['privacy/chatgpt/index.html', 'Privacy Policy — Lingogram in ChatGPT'],
  ['privacy/claude/index.html', 'Privacy Policy — Lingogram in Claude'],
])('%s is written, with its heading', (rel, heading) => {
  const html = page(rel);
  expect(html).toContain(`<h1>${heading}</h1>`);
  expect(html).toContain('<link rel="canonical"');
});

test('the pages are English-only', () => {
  for (const rel of ['ru/terms/index.html', 'ru/support/index.html', 'ru/privacy/chatgpt/index.html', 'ru/privacy/claude/index.html']) {
    expect(existsSync(resolve(OUT, rel))).toBe(false);
  }
});

test('the sitemap lists each page once', () => {
  const sitemap = page('sitemap.xml');
  for (const p of ['/terms/', '/support/', '/privacy/chatgpt/', '/privacy/claude/']) {
    expect(sitemap.split(`<loc>https://lingogram.ai${p}</loc>`).length - 1).toBe(1);
  }
});

test('the privacy chooser links the ChatGPT and Claude policies', () => {
  expect(page('privacy/index.html')).toContain('href="/privacy/chatgpt/"');
  expect(page('privacy/index.html')).toContain('href="/privacy/claude/"');
});

test('support names the support mailbox and links the policies and terms', () => {
  const html = page('support/index.html');
  expect(html).toContain('href="mailto:support@lingogram.ai"');
  expect(html).toContain('href="/privacy/"');
  expect(html).toContain('href="/terms/"');
});

test('the site-wide contact is the support mailbox', () => {
  expect(page('index.html')).toContain('href="mailto:support@lingogram.ai"');
});
