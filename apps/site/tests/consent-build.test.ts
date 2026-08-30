/**
 * What build.mjs emits for analytics, with and without a measurement id.
 *
 * build.mjs calls build() at module scope and reads process.env there, so it
 * cannot be imported for its pure functions — these tests SPAWN it with a
 * controlled env and assert on the HTML it writes.
 *
 * NOTE: this rewrites apps/site/build/. That directory is generated and
 * gitignored, but a developer serving it locally will find it replaced. The
 * suite deliberately finishes with the untagged build so the local default (no
 * tag, no /privacy/site/) is what is left behind.
 *
 * The headline assertion is the ORDER of the analytics block. Consent Mode
 * only works if `consent default: denied` is queued before gtag.js loads; a
 * refactor that moves the script tag produces a page that looks identical and
 * quietly sets cookies for visitors who never answered.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SITE = resolve(__dirname, '..');
const OUT = resolve(SITE, 'build');
const ID = 'G-TEST123';

jest.setTimeout(120_000);

/** Runs build.mjs alone — the vite passes add the SPA bundles, not pages. */
function runBuild(measurementId?: string): string {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  if (measurementId === undefined) delete env.SITE_GA4_MEASUREMENT_ID;
  else env.SITE_GA4_MEASUREMENT_ID = measurementId;
  // console.warn writes to stderr, so both streams are merged: the
  // malformed-id warning is one of the things worth asserting on.
  const proc = spawnSync(process.execPath, ['build.mjs'], { cwd: SITE, env, encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`build.mjs exited ${proc.status}: ${proc.stderr}`);
  return `${proc.stdout}${proc.stderr}`;
}

const page = (rel: string) => readFileSync(resolve(OUT, rel), 'utf8');


// One tagged build, snapshotted, then string assertions against it.
let tagged: Record<string, string>;
const PAGES = [
  'index.html', 'ar/index.html', 'login/index.html', 'register/index.html',
  '404.html', 'privacy/index.html', 'privacy/site/index.html', 'uninstall/index.html',
  'sitemap.xml',
];

beforeAll(() => {
  runBuild(ID);
  tagged = Object.fromEntries(PAGES.map((p) => [p, page(p)]));
});

// Leave the tree in the state a developer expects: no credentials, no tag.
afterAll(() => { runBuild(undefined); });

describe('the analytics block, with a measurement id', () => {
  it('queues consent BEFORE gtag.js is fetched', () => {
    // The whole GDPR posture rests on this ordering, and nothing else in the
    // page reveals it. Google reads the dataLayer queue when the tag loads; a
    // `default` arriving afterwards is ignored outright.
    const html = tagged['index.html'];
    const order = [
      'window.dataLayer',
      "gtag('consent','default'",
      'analytics_storage:\'denied\'',
      'wait_for_update:500',
      'lingogram_consent',
      "gtag('js'",
      "gtag('config'",
      'window.LG_GA4',
      'googletagmanager.com/gtag/js',
    ].map((needle) => [needle, html.indexOf(needle)] as const);

    for (const [needle, at] of order) expect([needle, at > -1]).toEqual([needle, true]);
    const positions = order.map(([, at]) => at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('denies all four Consent Mode v2 signals by default', () => {
    for (const signal of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']) {
      expect(tagged['index.html']).toContain(`${signal}:'denied'`);
    }
  });

  it('loads gtag.js async, never deferred', () => {
    // defer would run it after the parser finishes — long after the inline
    // consent block, which is fine — but it also reorders against other defer
    // scripts. async is what the ordering above was reasoned about.
    const tag = /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js[^"]*"><\/script>/;
    expect(tagged['index.html']).toMatch(tag);
    expect(tagged['index.html']).not.toMatch(/<script[^>]*defer[^>]*googletagmanager/);
  });

  it('puts the whole block inside <head>', () => {
    const html = tagged['index.html'];
    expect(html.indexOf('googletagmanager.com/gtag/js')).toBeLessThan(html.indexOf('</head>'));
  });

  it('uses the SAME storage key in the page and in main.js', () => {
    // The key is duplicated by necessity: main.js ships unbundled, so the two
    // files cannot share a module. If they drift, a visitor who accepted is
    // silently re-denied on every later page load, forever, with no error.
    const inPage = /localStorage\.getItem\('([^']+)'\)/.exec(tagged['index.html']);
    const mainJs = readFileSync(resolve(SITE, 'src/js/main.js'), 'utf8');
    const inScript = /CONSENT_KEY\s*=\s*'([^']+)'/.exec(mainJs);
    expect(inPage?.[1]).toBe('lingogram_consent');
    expect(inScript?.[1]).toBe(inPage?.[1]);
    for (const value of ["'granted'", "'denied'"]) {
      expect(tagged['index.html']).toContain(value);
      expect(mainJs).toContain(value);
    }
  });

  it('reaches every page kind, auth pages included', () => {
    // Those pages set cookies like any other, so consent has to be obtainable
    // there too — a tagged page with no banner would be the actual violation.
    for (const p of PAGES.filter((x) => x.endsWith('.html'))) {
      expect([p, tagged[p].includes('window.LG_GA4')]).toEqual([p, true]);
      expect([p, tagged[p].includes('id="consent"')]).toEqual([p, true]);
    }
  });
});

describe('the banner markup', () => {
  it('is server-rendered hidden, so a returning visitor sees no flash', () => {
    expect(tagged['index.html']).toMatch(/<div class="consent" id="consent"[^>]*\shidden>/);
  });

  it('announces itself as a dialog', () => {
    expect(tagged['index.html']).toMatch(/id="consent"[^>]*role="dialog"/);
    expect(tagged['index.html']).toMatch(/id="consent"[^>]*aria-label="/);
  });

  it('offers exactly one Accept and one Decline, both plain buttons', () => {
    // Emphasis is allowed; making refusal cost more is not. Both answers are
    // one click, side by side — no "manage preferences" detour for Decline.
    const html = tagged['index.html'];
    expect(html.match(/data-consent="granted"/g)).toHaveLength(1);
    expect(html.match(/data-consent="denied"/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="button" class="consent-decline" data-consent="denied">/);
    expect(html).toMatch(/<button type="button" class="btn btn-primary" data-consent="granted">/);
  });

  it('ships the close box hidden', () => {
    // Revealed by main.js only on a REopened banner. On a first, undecided view
    // a close box would be a third answer dressed as an escape.
    expect(tagged['index.html']).toMatch(/data-consent-close[^>]*\shidden>/);
  });

  it('links the policy from the banner and offers the footer control', () => {
    expect(tagged['index.html']).toContain('href="/privacy/site/"');
    expect(tagged['index.html']).toContain('data-consent-reopen');
  });

  it('renders right-to-left locales with dir="rtl"', () => {
    expect(tagged['ar/index.html']).toContain('<html lang="ar" dir="rtl">');
    expect(tagged['ar/index.html']).toContain('id="consent"');
  });
});

describe('/privacy/site/', () => {
  it('exists and keeps its promise about cookie deletion in sync with the code', () => {
    // The page states that Decline deletes _ga and _ga_*. That is a published
    // commitment, so it must not outlive the function that performs it.
    const doc = tagged['privacy/site/index.html'];
    expect(doc).toContain('_ga');
    expect(doc).toMatch(/deletes the/);
    expect(readFileSync(resolve(SITE, 'src/js/main.js'), 'utf8')).toContain('clearGaCookies');
  });

  it('is linked from the privacy chooser and listed once in the sitemap', () => {
    expect(tagged['privacy/index.html']).toContain('/privacy/site/');
    expect(tagged['sitemap.xml'].match(/<loc>[^<]*\/privacy\/site\/<\/loc>/g)).toHaveLength(1);
  });
});

describe('store links', () => {
  it('every store anchor carries both attribution attributes', () => {
    // This is the assertion that catches a NEWLY ADDED CTA: a link without
    // data-store reports `unknown` and its conversions are simply lost.
    for (const p of ['index.html', 'uninstall/index.html']) {
      const anchors = tagged[p].match(/<a\b[^>]*chromewebstore\.google\.com[^>]*>/g) ?? [];
      expect([p, anchors.length > 0]).toEqual([p, true]);
      for (const a of anchors) {
        expect([p, a, /data-store="/.test(a)]).toEqual([p, a, true]);
        expect([p, a, /data-place="/.test(a)]).toEqual([p, a, true]);
      }
    }
  });

  it('names placements that identify where the click came from', () => {
    for (const place of ['home-card', 'home-hero', 'home-final']) {
      expect(tagged['index.html']).toContain(`data-place="${place}"`);
    }
    expect(tagged['uninstall/index.html']).toContain('data-place="uninstall-banner"');
  });

  it('reports a real edition slug, never a placeholder', () => {
    // `primary` is the default listing, not an edition anyone sees; reporting
    // it split one listing's conversions across two values in GA4.
    const editions = [...tagged['index.html'].matchAll(/data-store="([^"]+)"/g)].map((m) => m[1]);
    expect(editions.length).toBeGreaterThan(0);
    expect(editions).not.toContain('primary');
  });
});

describe('with no measurement id', () => {
  let bare: Record<string, string>;

  beforeAll(() => {
    runBuild(undefined);
    bare = Object.fromEntries(
      PAGES.filter((p) => p !== 'privacy/site/index.html').map((p) => [p, page(p)]),
    );
  });

  it('emits no tag on any page', () => {
    for (const [name, html] of Object.entries(bare)) {
      expect([name, html.includes('googletagmanager')]).toEqual([name, false]);
      expect([name, html.includes('window.LG_GA4')]).toEqual([name, false]);
    }
  });

  it('emits no banner and no footer control', () => {
    for (const [name, html] of Object.entries(bare)) {
      expect([name, html.includes('id="consent"')]).toEqual([name, false]);
      expect([name, html.includes('data-consent-reopen')]).toEqual([name, false]);
    }
  });

  it('does not write /privacy/site/ at all', () => {
    // Without a tag the site sets no cookies, so the document would describe
    // something that does not happen.
    expect(existsSync(resolve(OUT, 'privacy/site/index.html'))).toBe(false);
    expect(bare['sitemap.xml']).not.toContain('/privacy/site/');
    expect(bare['privacy/index.html']).not.toContain('/privacy/site/');
  });

  it('still produces a complete site', () => {
    expect(bare['index.html'].length).toBeGreaterThan(1000);
  });
});

describe('a measurement id that is not one', () => {
  // Never fails the build: an unrelated local edit must not require credentials.
  // But it must not ship a tag that looks configured and measures nothing.
  it.each([
    ['G-XXXXXXXXXX', 'the .env.example placeholder'],
    ['not-an-id', 'plain nonsense'],
    ['g-lowercase', 'wrong case'],
  ])('treats %s (%s) as unset, with a warning', (value) => {
    const output = runBuild(value);
    expect(output).toContain('is not a G-XXXXXXXXXX id');
    expect(page('index.html')).not.toContain('googletagmanager');
    expect(existsSync(resolve(OUT, 'privacy/site/index.html'))).toBe(false);
  });
});
