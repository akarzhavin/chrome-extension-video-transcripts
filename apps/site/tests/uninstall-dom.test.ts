/**
 * @jest-environment jsdom
 *
 * /uninstall/ feedback flow, run against the REAL src/js/main.js.
 *
 * That file ships to build/ verbatim with no bundler, so it exports nothing to
 * import: the tests below eval it into the page the way a <script> tag would.
 * Testing a refactored copy would leave the shipped file uncovered, and the
 * branches here are exactly the ones that are easy to get subtly wrong — an
 * empty Send after a FAILED tap must not print a thank-you over an empty
 * database, and a Send pressed while the tap is still in flight must not write
 * the reason twice.
 *
 * Markup mirrors what build.mjs emits for uninstallPage(), including the
 * status paragraph sitting ABOVE .uni-more.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAIN_JS = readFileSync(resolve(__dirname, '../src/js/main.js'), 'utf8');

const REASONS = ['subtitles', 'translation', 'setup', 'expected', 'oneoff', 'other'];

const I18N = {
  sending: 'Sending…',
  sent: 'Thank you — this really helps.',
  failed: "Couldn't send. Try again?",
  mailtoFallback: 'send it by email instead',
};

function pageHTML(): string {
  const chips = REASONS.map(
    (id) => `
      <button type="button" class="uni-chip" data-reason="${id}" aria-pressed="false">
        <span class="uni-chip-tick" aria-hidden="true"></span>
        ${id}
      </button>`,
  ).join('');
  return `
<main class="narrow uni">
  <form id="feedback-form" data-mailto="team@example.com"
        action="mailto:team@example.com" method="post" enctype="text/plain">
    <div class="uni-chips" role="group" aria-label="Why did you uninstall?">${chips}</div>
    <p class="uni-status" data-status role="status" aria-live="polite"></p>
    <div class="uni-more" hidden>
      <textarea id="feedback-text" rows="3"></textarea>
      <div class="cta-row uni-actions">
        <button class="btn btn-primary" type="submit">Send</button>
        <a class="uni-skip" href="/">No thanks</a>
      </div>
    </div>
  </form>
</main>`;
}

/** Firestore doc paths the page writes, in commit order. */
type Commit = { id: string; text: string; source: string; uid: string };

interface Harness {
  commits: Commit[];
  /** Resolves the pending counter GET / commit POST, for in-flight tests. */
  release: () => void;
}

/**
 * Installs a fetch fake that mimics the emulator closely enough for the flow:
 * the day counter 404s until the first commit lands, then reports its value —
 * so a second doc is written as {day}_2, exactly as the rules require.
 */
function mockFirestore(opts: { failCommits?: boolean; defer?: boolean } = {}): Harness {
  const commits: Commit[] = [];
  let count = 0;
  const gate: Array<() => void> = [];

  const respond = async (url: string, init?: RequestInit): Promise<Response> => {
    const isCommit = url.indexOf(':commit') !== -1;
    if (!isCommit) {
      // The counter read.
      if (count === 0) return { ok: false, status: 404, json: async () => ({}) } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ fields: { count: { integerValue: String(count) } } }),
      } as Response;
    }
    if (opts.failCommits) {
      return { ok: false, status: 403, text: async () => 'PERMISSION_DENIED' } as Response;
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    const doc = body.writes[0].update;
    commits.push({
      id: String(doc.name).split('/').pop() as string,
      text: doc.fields.text.stringValue,
      source: doc.fields.source.stringValue,
      uid: doc.fields.uid.stringValue,
    });
    count += 1;
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  };

  (globalThis as unknown as { fetch: unknown }).fetch = (url: string, init?: RequestInit) => {
    if (!opts.defer) return respond(url, init);
    return new Promise<Response>((res) => gate.push(() => res(respond(url, init) as never)));
  };

  return {
    commits,
    release: () => {
      while (gate.length) (gate.shift() as () => void)();
    },
  };
}

function boot(): void {
  document.body.innerHTML = pageHTML();
  (window as unknown as { __UNINSTALL: unknown }).__UNINSTALL = {
    i18n: I18N,
    maxBytes: 2000,
    source: 'site-uninstall',
  };
  (window as unknown as { LINGOGRAM_AUTH: unknown }).LINGOGRAM_AUTH = {
    projectId: 'p',
    firestoreUrl: 'https://firestore.example',
  };
  // eslint-disable-next-line no-new-func
  new Function(MAIN_JS)();
}

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const chip = (id: string) => $<HTMLButtonElement>(`.uni-chip[data-reason="${id}"]`);
const statusText = () => ($('[data-status]') as HTMLElement).textContent || '';
const flush = () => new Promise((r) => setTimeout(r, 0));

function type(text: string): void {
  $<HTMLTextAreaElement>('#feedback-text').value = text;
}
function pressSend(): void {
  $<HTMLFormElement>('#feedback-form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
}

describe('tap commits the answer', () => {
  it('writes the reason on chip click, without waiting for Send', async () => {
    const fs = mockFirestore();
    boot();
    chip('setup').click();
    await flush();

    expect(fs.commits).toHaveLength(1);
    expect(fs.commits[0].text).toBe('[reason:setup]');
    expect(fs.commits[0].source).toBe('site-uninstall');
    expect(fs.commits[0].uid).toBe('');
    expect(fs.commits[0].id).toMatch(/^\d{8}_1$/);
  });

  it('announces sending, then thanks — and keeps the chips open for prose', async () => {
    const fs = mockFirestore({ defer: true });
    boot();
    chip('setup').click();
    expect(statusText()).toBe(I18N.sending);

    fs.release();
    await flush();
    fs.release();
    await flush();

    expect(statusText()).toBe(I18N.sent);
    expect($('.uni-chips').hasAttribute('hidden')).toBe(false);
    expect($('.uni-more').hasAttribute('hidden')).toBe(false);
  });

  it('reveals the prose box and does not steal focus into it', async () => {
    mockFirestore();
    boot();
    expect($('.uni-more').hasAttribute('hidden')).toBe(true);
    chip('other').click();
    await flush();
    expect($('.uni-more').hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).not.toBe($('#feedback-text'));
  });

  it('offers mailto when the tap is rejected, and keeps the chip pressed', async () => {
    mockFirestore({ failCommits: true });
    boot();
    chip('translation').click();
    await flush();

    expect(statusText()).toContain(I18N.failed);
    const link = $<HTMLAnchorElement>('[data-status] a');
    expect(link.textContent).toBe(I18N.mailtoFallback);
    expect(decodeURIComponent(link.href)).toContain('[reason:translation]');
    expect(chip('translation').getAttribute('aria-pressed')).toBe('true');
  });

  it('writes once for a double-click', async () => {
    const fs = mockFirestore();
    boot();
    chip('setup').click();
    chip('setup').click();
    await flush();
    expect(fs.commits).toHaveLength(1);
  });

  it('does not re-send when the visitor switches chips', async () => {
    const fs = mockFirestore();
    boot();
    chip('setup').click();
    await flush();
    chip('oneoff').click();
    await flush();

    // The first tap is what landed; the UI follows the latest choice.
    expect(fs.commits).toHaveLength(1);
    expect(fs.commits[0].text).toBe('[reason:setup]');
    expect(chip('oneoff').getAttribute('aria-pressed')).toBe('true');
    expect(chip('setup').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Send adds prose as a second doc', () => {
  it('marks the prose doc with [more] and gives it the next id', async () => {
    const fs = mockFirestore();
    boot();
    chip('setup').click();
    await flush();
    type('the popup never opened');
    pressSend();
    await flush();

    expect(fs.commits).toHaveLength(2);
    expect(fs.commits[1].text).toBe('[reason:setup] [more] the popup never opened');
    expect(fs.commits[1].id).toMatch(/^\d{8}_2$/);
    expect($('.uni-chips').hasAttribute('hidden')).toBe(true);
    expect($('.uni-more').hasAttribute('hidden')).toBe(true);
    expect(statusText()).toBe(I18N.sent);
  });

  it('carries the corrected reason when the visitor switched chips', async () => {
    const fs = mockFirestore();
    boot();
    chip('setup').click();
    await flush();
    chip('expected').click();
    await flush();
    type('actually this');
    pressSend();
    await flush();

    expect(fs.commits[0].text).toBe('[reason:setup]');
    expect(fs.commits[1].text).toBe('[reason:expected] [more] actually this');
  });

  it('writes nothing for an empty Send — it just means "I am done"', async () => {
    const fs = mockFirestore();
    boot();
    chip('setup').click();
    await flush();
    pressSend();
    await flush();

    expect(fs.commits).toHaveLength(1);
    expect(statusText()).toBe(I18N.sent);
    expect($('.uni-chips').hasAttribute('hidden')).toBe(true);
  });

  it('ignores clicks and submits once the form has closed', async () => {
    const fs = mockFirestore();
    boot();
    chip('setup').click();
    await flush();
    pressSend();
    await flush();

    chip('other').click();
    pressSend();
    await flush();
    expect(fs.commits).toHaveLength(1);
  });
});

describe('Send after a failed tap retries the whole answer', () => {
  it('does NOT print a thank-you over an empty database', async () => {
    const fs = mockFirestore({ failCommits: true });
    boot();
    chip('setup').click();
    await flush();
    pressSend();
    await flush();

    // The empty-box shortcut must not fire: nothing was ever recorded.
    expect(fs.commits).toHaveLength(0);
    expect(statusText()).toContain(I18N.failed);
    expect($('.uni-chips').hasAttribute('hidden')).toBe(false);
  });

  it('sends one unmarked doc when the retry carries prose', async () => {
    const fs = mockFirestore({ failCommits: true });
    boot();
    chip('setup').click();
    await flush();

    // The commits start succeeding — the visitor came back online.
    const ok = mockFirestore();
    type('here is what happened');
    pressSend();
    await flush();

    expect(ok.commits).toHaveLength(1);
    // No [more]: there is no sibling doc to disambiguate this one from.
    expect(ok.commits[0].text).toBe('[reason:setup] here is what happened');
    expect(fs.commits).toHaveLength(0);
    expect($('.uni-more').hasAttribute('hidden')).toBe(true);
  });
});

describe('Send pressed while the tap is still in flight', () => {
  it('waits for the tap and then adds the prose as a second doc', async () => {
    const fs = mockFirestore({ defer: true });
    boot();
    chip('setup').click();
    type('typed fast');
    pressSend();

    // Nothing has resolved yet: the submit must be parked on the tap promise.
    expect(fs.commits).toHaveLength(0);

    for (let i = 0; i < 4; i += 1) {
      fs.release();
      await flush();
    }

    expect(fs.commits).toHaveLength(2);
    expect(fs.commits[0].text).toBe('[reason:setup]');
    expect(fs.commits[1].text).toBe('[reason:setup] [more] typed fast');
  });

  it('retries as a single doc when the in-flight tap turns out to have failed', async () => {
    const fs = mockFirestore({ defer: true, failCommits: true });
    boot();
    chip('setup').click();
    type('typed fast');
    pressSend();

    for (let i = 0; i < 4; i += 1) {
      fs.release();
      await flush();
    }

    // Both attempts were rejected, so the visitor is left with mailto.
    expect(statusText()).toContain(I18N.failed);
    expect(decodeURIComponent($<HTMLAnchorElement>('[data-status] a').href)).toContain('typed fast');
  });
});

describe('byte clamp', () => {
  it('keeps the machine-read prefix and stays inside the UTF-8 budget', async () => {
    mockFirestore();
    boot();
    const fs2 = mockFirestore();
    chip('setup').click();
    await flush();

    // Cyrillic is 2 bytes per char, so 3000 chars is 6000 bytes — well over.
    type('я'.repeat(3000));
    pressSend();
    await flush();

    const text = fs2.commits[1].text;
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(2000);
    expect(text.indexOf('[reason:setup] [more] ')).toBe(0);
  });
});
