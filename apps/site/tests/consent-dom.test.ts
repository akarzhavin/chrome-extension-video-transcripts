/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.lingogram.ai/"}
 *
 * The cookie consent banner, run against the REAL src/js/main.js.
 *
 * That file ships to build/ verbatim with no bundler, so it exports nothing to
 * import: these tests eval it into the page the way a <script defer> tag would
 * (same approach as uninstall-dom.test.ts). Testing a refactored copy would
 * leave the shipped file uncovered.
 *
 * The contracts pinned here are the ones whose failure is SILENT. A wrong
 * consent state does not throw and does not look different — it just quietly
 * sets a cookie for someone who said no, or drops every event for someone who
 * said yes. GA4 accepts a malformed payload with a 204 and never mentions it
 * again. So each assertion below stands in for something a person would only
 * notice weeks later, in a report, if at all.
 *
 * The jsdom URL is a real two-label host on purpose: clearGaCookies() walks up
 * to the registrable domain, and on `localhost` that branch never runs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAIN_JS = readFileSync(resolve(__dirname, '../src/js/main.js'), 'utf8');

type GtagCall = unknown[];

interface Harness {
  gtagCalls: GtagCall[];
  /** Every string assigned to document.cookie, in order. */
  cookieWrites: string[];
}

interface BootOpts {
  /** Value in localStorage before boot; undefined = key absent. */
  stored?: string;
  /** Emit the tag flag build.mjs sets. false = a build with no measurement id. */
  ga4?: boolean;
  /**
   * 'throws'  — getItem/setItem raise, as Safari's "block all cookies" does.
   * 'silent'  — setItem accepts and discards, so the read-back finds nothing.
   * Distinct cases: only the second reaches the read-back logic.
   */
  storage?: 'throws' | 'silent';
  /** Seeded before boot, as `name=value` pairs. */
  cookies?: string[];
  /** Extra markup appended to the body (e.g. the /languages/ search field). */
  extraHTML?: string;
}

/** Mirrors consentBanner() + the footer control in build.mjs. */
function bannerHTML(): string {
  return `
<button type="button" data-consent-reopen>Cookies</button>
<div class="consent" id="consent" role="dialog" aria-label="Cookies" hidden>
  <p class="consent-text">We use cookies. <a href="/privacy/site/">How we use them</a></p>
  <div class="consent-actions">
    <button type="button" class="consent-decline" data-consent="denied">Decline</button>
    <button type="button" class="btn btn-primary" data-consent="granted">Accept</button>
  </div>
  <button type="button" class="consent-close" data-consent-close aria-label="Close" title="Close" hidden>&times;</button>
</div>`;
}

/**
 * main.js binds its store-click and Escape handlers to `document`, and those
 * survive a body.innerHTML swap. Without removing them, every boot() in the
 * file stacks another listener on the same document and a single click fires
 * once per test that ran before it. Track and detach them instead.
 */
const bound: Array<[string, EventListener]> = [];
const realAdd = document.addEventListener.bind(document);

function boot(opts: BootOpts = {}): Harness {
  const { stored, ga4 = true, storage, cookies = [], extraHTML = '' } = opts;

  for (const [type, fn] of bound.splice(0)) document.removeEventListener(type, fn);
  jest.spyOn(document, 'addEventListener').mockImplementation(
    (type: string, fn: EventListenerOrEventListenerObject, opt?: boolean | AddEventListenerOptions) => {
      bound.push([type, fn as EventListener]);
      return realAdd(type, fn, opt);
    },
  );

  document.body.innerHTML = bannerHTML() + extraHTML;
  document.documentElement.lang = 'en';

  // Reset storage through the real API before any stubbing goes in.
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem('lingogram_consent', stored);

  if (storage === 'throws') {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  } else if (storage === 'silent') {
    // Accepts the write, keeps nothing. The nastier case: no exception to catch,
    // so only reading the value back reveals it.
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
  }

  // Seed cookies, then watch every subsequent write. jsdom honours expiry, so
  // deletion is observable — but the WRITES are the real contract, since a
  // cross-domain expire that jsdom ignores would still be correct in a browser.
  for (const c of cookies) document.cookie = `${c}; path=/`;
  const cookieWrites: string[] = [];
  const proto = Object.getPrototypeOf(document) as Document;
  const real = Object.getOwnPropertyDescriptor(proto, 'cookie')
    ?? Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => real!.get!.call(document),
    set: (v: string) => { cookieWrites.push(v); real!.set!.call(document, v); },
  });

  const gtagCalls: GtagCall[] = [];
  (window as unknown as { gtag: unknown }).gtag = (...args: unknown[]) => { gtagCalls.push(args); };
  if (ga4) (window as unknown as { LG_GA4: string }).LG_GA4 = 'G-TEST123';

  // eslint-disable-next-line no-new-func
  new Function(MAIN_JS)();
  return { gtagCalls, cookieWrites };
}

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const consentEl = () => $<HTMLElement>('#consent');
const track = (name: string, params?: Record<string, unknown>) =>
  (window as unknown as { lgTrack: (n: string, p?: Record<string, unknown>) => void }).lgTrack(name, params);

afterEach(() => {
  for (const [type, fn] of bound.splice(0)) document.removeEventListener(type, fn);
  jest.restoreAllMocks();
  // Drop every cookie the test left, so the next boot starts clean.
  for (const c of document.cookie.split(';')) {
    const n = c.split('=')[0].trim();
    if (n) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
  localStorage.clear();
  delete (window as unknown as { LG_GA4?: string }).LG_GA4;
});

// ---------------------------------------------------------------- visibility

describe('who sees the banner', () => {
  it('shows it to a visitor who has not answered', () => {
    boot({});
    expect(consentEl().hidden).toBe(false);
  });

  it('stays hidden for a visitor who accepted — no flash on every page', () => {
    boot({ stored: 'granted' });
    expect(consentEl().hidden).toBe(true);
  });

  it('stays hidden for a visitor who declined', () => {
    boot({ stored: 'denied' });
    expect(consentEl().hidden).toBe(true);
  });

  it('treats an unrecognised stored value as "not answered"', () => {
    // Only the two exact values count as a decision. Anything else — a
    // half-written value, a key from an older scheme — must re-ask rather than
    // assume, because assuming means assuming consent.
    boot({ stored: 'maybe' });
    expect(consentEl().hidden).toBe(false);
  });

  it('is completely inert on a build with no measurement id', () => {
    // A local build without SITE_GA4_MEASUREMENT_ID ships this same file. It
    // must do nothing at all: no banner, no events, no storage writes.
    const h = boot({ ga4: false });
    expect(consentEl().hidden).toBe(true);
    $<HTMLButtonElement>('[data-consent="granted"]').click();
    expect(h.gtagCalls).toEqual([]);
    expect(localStorage.getItem('lingogram_consent')).toBeNull();
  });
});

// -------------------------------------------------------------------- choice

describe('answering the banner', () => {
  it('records Accept and tells GA exactly once', () => {
    const h = boot({});
    $<HTMLButtonElement>('[data-consent="granted"]').click();
    expect(localStorage.getItem('lingogram_consent')).toBe('granted');
    expect(consentEl().hidden).toBe(true);
    expect(h.gtagCalls).toEqual([['consent', 'update', { analytics_storage: 'granted' }]]);
  });

  it('does NOT re-send page_view on Accept', () => {
    // Measured on preprod against the real tag: gtag.js sends the page_view
    // cookielessly under the denied default (gcs=G100), so re-sending it on
    // Accept reported the same page load twice — once at G100, once at G101.
    // An earlier revision did exactly that. This assertion is the fence.
    const h = boot({});
    $<HTMLButtonElement>('[data-consent="granted"]').click();
    expect(h.gtagCalls.filter((c) => c[0] === 'event')).toEqual([]);
  });

  it('records Decline and tells GA', () => {
    const h = boot({});
    $<HTMLButtonElement>('[data-consent="denied"]').click();
    expect(localStorage.getItem('lingogram_consent')).toBe('denied');
    expect(h.gtagCalls).toEqual([['consent', 'update', { analytics_storage: 'denied' }]]);
  });

  it('ignores a click that is not on a choice', () => {
    const h = boot({});
    $<HTMLElement>('.consent-text').click();
    expect(h.gtagCalls).toEqual([]);
    expect(localStorage.getItem('lingogram_consent')).toBeNull();
    expect(consentEl().hidden).toBe(false);
  });

  it('ignores a button carrying a value that is neither choice', () => {
    const h = boot({});
    const rogue = document.createElement('button');
    rogue.setAttribute('data-consent', 'maybe');
    consentEl().appendChild(rogue);
    rogue.click();
    expect(h.gtagCalls).toEqual([]);
    expect(localStorage.getItem('lingogram_consent')).toBeNull();
  });
});

// --------------------------------------------------- storage that cannot hold

describe('when localStorage will not persist the choice', () => {
  it('downgrades an unpersisted Accept to denied', () => {
    // The worst outcome would be telling GA "granted" while track() — which
    // re-reads storage on every call — keeps dropping every event. GA would
    // believe it has consent; the page would send nothing. Claiming a consent
    // the page cannot honour is worse than admitting it did not stick.
    const h = boot({ storage: 'silent' });
    $<HTMLButtonElement>('[data-consent="granted"]').click();
    expect(h.gtagCalls).toEqual([['consent', 'update', { analytics_storage: 'denied' }]]);
  });

  it('downgrades when storage throws outright', () => {
    const h = boot({ storage: 'throws' });
    expect(() => $<HTMLButtonElement>('[data-consent="granted"]').click()).not.toThrow();
    expect(h.gtagCalls).toEqual([['consent', 'update', { analytics_storage: 'denied' }]]);
  });

  it('still shows the banner when the read itself throws', () => {
    // Safari's "block all cookies" throws on READ, not just write, so a bare
    // read has to be guarded like a write or the whole script dies here.
    expect(() => boot({ storage: 'throws' })).not.toThrow();
    expect(consentEl().hidden).toBe(false);
  });

  it('passes Decline through unchanged — refusal never needs to persist to count', () => {
    const h = boot({ storage: 'silent' });
    $<HTMLButtonElement>('[data-consent="denied"]').click();
    expect(h.gtagCalls).toEqual([['consent', 'update', { analytics_storage: 'denied' }]]);
  });
});

// ------------------------------------------------------------ cookie removal

describe('Decline deletes the identifier', () => {
  it('expires _ga and _ga_* across host and registrable domain', () => {
    // /privacy/site/ promises in writing that Decline "deletes the _ga and
    // _ga_* cookies already in your browser, so the identifier they held is
    // gone rather than merely unused". A cookie can only be expired by a
    // matching domain/path pair, so a miss in this matrix makes that promise
    // false — which is a published legal statement, not a nicety.
    const h = boot({ stored: 'granted', cookies: ['_ga=GA1.1.123', '_ga_ABC=xyz'] });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    $<HTMLButtonElement>('[data-consent="denied"]').click();

    const expiries = h.cookieWrites.filter((w) => w.includes('01 Jan 1970'));
    // 2 names x 3 domains ('', exact host, registrable)
    expect(expiries).toHaveLength(6);
    for (const name of ['_ga=', '_ga_ABC=']) {
      expect(expiries.filter((w) => w.startsWith(name))).toHaveLength(3);
    }
    expect(expiries.some((w) => w.includes('domain=www.lingogram.ai'))).toBe(true);
    expect(expiries.some((w) => w.includes('domain=.lingogram.ai'))).toBe(true);
    for (const w of expiries) expect(w).toContain('path=/');
    expect(document.cookie).not.toContain('_ga');
  });

  it('leaves unrelated cookies alone', () => {
    boot({ stored: 'granted', cookies: ['_ga=GA1.1.123', 'session=keepme'] });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    $<HTMLButtonElement>('[data-consent="denied"]').click();
    expect(document.cookie).toContain('session=keepme');
  });

  it('does not touch cookies that merely start with _ga', () => {
    // `_gasomething` is somebody else's. The filter is exact for `_ga` and
    // prefix-only for `_ga_`, and that distinction is easy to lose in a refactor.
    const h = boot({ stored: 'granted', cookies: ['_gasomething=keep'] });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    $<HTMLButtonElement>('[data-consent="denied"]').click();
    expect(h.cookieWrites.filter((w) => w.includes('01 Jan 1970'))).toEqual([]);
    expect(document.cookie).toContain('_gasomething=keep');
  });

  it('writes nothing when there is nothing to clear', () => {
    const h = boot({ stored: 'granted' });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    $<HTMLButtonElement>('[data-consent="denied"]').click();
    expect(h.cookieWrites.filter((w) => w.includes('01 Jan 1970'))).toEqual([]);
  });

  it('does not clear on Accept', () => {
    const h = boot({ cookies: ['_ga=GA1.1.123'] });
    $<HTMLButtonElement>('[data-consent="granted"]').click();
    expect(h.cookieWrites.filter((w) => w.includes('01 Jan 1970'))).toEqual([]);
    expect(document.cookie).toContain('_ga=');
  });

  it('tells GA to stop BEFORE dropping the cookies', () => {
    // Order matters: clearing first would leave a window in which GA still
    // believes it has consent and could mint a replacement id on the way out.
    let cookieAtGtagTime = '';
    const h = boot({ stored: 'granted', cookies: ['_ga=GA1.1.123'] });
    (window as unknown as { gtag: unknown }).gtag = (...args: unknown[]) => {
      cookieAtGtagTime = document.cookie;
      h.gtagCalls.push(args);
    };
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    $<HTMLButtonElement>('[data-consent="denied"]').click();
    expect(cookieAtGtagTime).toContain('_ga=');
  });
});

// ---------------------------------------------------------------- the gate

describe('track() / window.lgTrack', () => {
  it('sends once consent is granted', () => {
    const h = boot({ stored: 'granted' });
    track('demo_word_saved', { a: 1 });
    expect(h.gtagCalls).toEqual([['event', 'demo_word_saved', { a: 1 }]]);
  });

  it('sends an empty params object rather than undefined', () => {
    const h = boot({ stored: 'granted' });
    track('demo_word_saved');
    expect(h.gtagCalls).toEqual([['event', 'demo_word_saved', {}]]);
  });

  it('drops everything while consent is denied', () => {
    const h = boot({ stored: 'denied' });
    track('store_click');
    expect(h.gtagCalls).toEqual([]);
  });

  it('drops everything before a choice is made', () => {
    const h = boot({});
    track('store_click');
    expect(h.gtagCalls).toEqual([]);
  });

  it('re-reads storage on every call, so a withdrawal takes effect at once', () => {
    // The gate is not a cached boolean. Declining in another tab must stop this
    // one without a reload — and it also means an unpersisted grant (above)
    // cannot leak events.
    const h = boot({ stored: 'granted' });
    track('store_click');
    localStorage.setItem('lingogram_consent', 'denied');
    track('store_click');
    expect(h.gtagCalls).toHaveLength(1);
  });

  it('exists but stays silent when no tag was built', () => {
    const h = boot({ ga4: false, stored: 'granted' });
    expect(typeof (window as unknown as { lgTrack: unknown }).lgTrack).toBe('function');
    track('store_click');
    expect(h.gtagCalls).toEqual([]);
  });

  it('does not throw when gtag is missing entirely', () => {
    boot({ stored: 'granted' });
    delete (window as unknown as { gtag?: unknown }).gtag;
    expect(() => track('store_click')).not.toThrow();
  });
});

// --------------------------------------------------------------- reopening

describe('reopening from the footer', () => {
  it('reveals the close box and reflects the standing choice', () => {
    boot({ stored: 'granted' });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    expect(consentEl().hidden).toBe(false);
    expect($<HTMLElement>('[data-consent-close]').hidden).toBe(false);
    expect($('[data-consent="granted"]').getAttribute('aria-pressed')).toBe('true');
    expect($('[data-consent="denied"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('mirrors a standing Decline', () => {
    boot({ stored: 'denied' });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    expect($('[data-consent="denied"]').getAttribute('aria-pressed')).toBe('true');
    expect($('[data-consent="granted"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('withholds the close box from a visitor who never answered', () => {
    // An escape that leaves consent at the denied default would be a third
    // answer wearing a dismissal's clothes. Both real answers are one click away.
    boot({});
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    expect($<HTMLElement>('[data-consent-close]').hidden).toBe(true);
  });
});

// --------------------------------------------------------------- dismissal

describe('dismissing a reopened banner', () => {
  it('closes on the close box and leaves the choice standing', () => {
    boot({ stored: 'denied' });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    $<HTMLButtonElement>('[data-consent-close]').click();
    expect(consentEl().hidden).toBe(true);
    expect(localStorage.getItem('lingogram_consent')).toBe('denied');
  });

  it('returns focus to the control that opened it', () => {
    boot({ stored: 'granted' });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    $<HTMLButtonElement>('[data-consent-close]').click();
    expect(document.activeElement).toBe($('[data-consent-reopen]'));
  });

  it('closes on Escape', () => {
    boot({ stored: 'granted' });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(consentEl().hidden).toBe(true);
    expect(localStorage.getItem('lingogram_consent')).toBe('granted');
  });

  it('REFUSES to dismiss an unanswered banner via Escape', () => {
    // The load-bearing one. Escaping an undecided banner would leave consent at
    // the denied default while looking like the visitor dealt with it — a
    // silent answer nobody gave.
    boot({});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(consentEl().hidden).toBe(false);
    expect(localStorage.getItem('lingogram_consent')).toBeNull();
  });

  it('ignores other keys', () => {
    boot({ stored: 'granted' });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    for (const key of ['Enter', 'Esc', ' ']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }
    expect(consentEl().hidden).toBe(false);
  });

  it('is a no-op when the banner is already hidden', () => {
    boot({ stored: 'granted' });
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
    expect(consentEl().hidden).toBe(true);
  });

  it('leaves the /languages/ search field working alongside it', () => {
    // Two document-level Escape handlers coexist (the search filter clears on
    // Escape too) and neither calls stopPropagation. Benign today — this pins
    // that the banner's handler does not swallow the other's key.
    boot({
      stored: 'granted',
      extraHTML: '<div id="lang-search-host" data-search-label="Search"></div>',
    });
    $<HTMLButtonElement>('[data-consent-reopen]').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(consentEl().hidden).toBe(true);
    expect($('#lang-search-host')).not.toBeNull();
  });
});

// ------------------------------------------------------------- store clicks

describe('store_click', () => {
  const link = (attrs: string, href = 'https://chromewebstore.google.com/detail/x') =>
    `<a href="${href}" ${attrs}><span id="inner">Install</span></a>`;

  it('reports edition, placement and locale from the markup', () => {
    const h = boot({
      stored: 'granted',
      extraHTML: link('data-store="rezka" data-place="home-card"'),
    });
    $<HTMLAnchorElement>('a[href*="chromewebstore"]').click();
    expect(h.gtagCalls).toEqual([
      ['event', 'store_click', {
        edition: 'rezka', placement: 'home-card', page_locale: 'en',
        // These links navigate the same tab, so the hit has to outlive the
        // unload — often it is queued before async gtag.js has even loaded.
        transport_type: 'beacon',
      }],
    ]);
  });

  it('carries an exact, closed set of params', () => {
    // The allowlist. /privacy/site/ states that no email or account id is ever
    // attached; this fails the moment a call site adds a key. transport_type is
    // a gtag directive rather than reported data, but it is listed here anyway
    // so that adding anything at all has to be a deliberate edit to this line.
    const h = boot({ stored: 'granted', extraHTML: link('data-store="a" data-place="b"') });
    $<HTMLAnchorElement>('a[href*="chromewebstore"]').click();
    const params = h.gtagCalls[0][2] as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(
      ['edition', 'page_locale', 'placement', 'transport_type'],
    );
  });

  it('asks for the beacon transport so the hit survives the navigation', () => {
    const h = boot({ stored: 'granted', extraHTML: link('data-store="a" data-place="b"') });
    $<HTMLAnchorElement>('a[href*="chromewebstore"]').click();
    expect((h.gtagCalls[0][2] as Record<string, string>).transport_type).toBe('beacon');
  });

  it('still fires for the legacy webstore URL', () => {
    // No build-time link uses this form any more, so only a test covers it.
    const h = boot({
      stored: 'granted',
      extraHTML: link('data-store="a" data-place="b"', 'https://chrome.google.com/webstore/detail/x'),
    });
    $<HTMLAnchorElement>('a[href*="webstore"]').click();
    expect(h.gtagCalls).toHaveLength(1);
  });

  it('fires when the click lands on a child element', () => {
    const h = boot({ stored: 'granted', extraHTML: link('data-store="a" data-place="b"') });
    $<HTMLElement>('#inner').click();
    expect(h.gtagCalls).toHaveLength(1);
  });

  it('ignores links that are not the store', () => {
    const h = boot({ stored: 'granted', extraHTML: '<a href="https://example.com/">x</a>' });
    $<HTMLAnchorElement>('a[href*="example.com"]').click();
    expect(h.gtagCalls).toEqual([]);
  });

  it('falls back to unknown/other when the attributes are missing', () => {
    // A newly added CTA that forgets data-store still reports, but visibly as
    // 'unknown' rather than silently as some other edition.
    const h = boot({ stored: 'granted', extraHTML: link('') });
    $<HTMLAnchorElement>('a[href*="chromewebstore"]').click();
    expect(h.gtagCalls[0][2]).toEqual({
      edition: 'unknown', placement: 'other', page_locale: 'en', transport_type: 'beacon',
    });
  });

  it('caps oversized attribute values', () => {
    const h = boot({
      stored: 'granted',
      extraHTML: link(`data-store="${'x'.repeat(200)}" data-place="${'y'.repeat(200)}"`),
    });
    document.documentElement.lang = 'z'.repeat(40);
    $<HTMLAnchorElement>('a[href*="chromewebstore"]').click();
    const params = h.gtagCalls[0][2] as Record<string, string>;
    expect(params.edition).toHaveLength(64);
    expect(params.placement).toHaveLength(64);
    expect(params.page_locale).toHaveLength(16);
  });

  it('reports an empty locale when the lang attribute is absent', () => {
    const h = boot({ stored: 'granted', extraHTML: link('data-store="a" data-place="b"') });
    document.documentElement.removeAttribute('lang');
    $<HTMLAnchorElement>('a[href*="chromewebstore"]').click();
    expect((h.gtagCalls[0][2] as Record<string, string>).page_locale).toBe('');
  });

  it('sends nothing for a declined visitor', () => {
    const h = boot({ stored: 'denied', extraHTML: link('data-store="a" data-place="b"') });
    $<HTMLAnchorElement>('a[href*="chromewebstore"]').click();
    expect(h.gtagCalls).toEqual([]);
  });
});
