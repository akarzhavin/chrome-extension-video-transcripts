/**
 * @jest-environment jsdom
 *
 * /uninstall/ feedback form, run against the REAL src/js/main.js.
 *
 * That file ships to build/ verbatim with no bundler, so it exports nothing to
 * import: the tests below eval it into the page the way a <script> tag would.
 * Testing a refactored copy would leave the shipped file uncovered.
 *
 * The contract this file exists to pin: NOTHING reaches the network before the
 * submit button is pressed. Ticking a box, typing, changing your mind — all of
 * it is local until the visitor commits, and a page they abandon leaves no
 * trace at all.
 *
 * Markup mirrors what build.mjs emits for uninstallPage().
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
  const options = REASONS.map(
    (id) => `
        <label class="uni-opt">
          <input type="checkbox" name="reason" value="${id}">
          <span class="uni-opt-box" aria-hidden="true"></span>
          <span class="uni-opt-label">${id}</span>
        </label>`,
  ).join('');
  return `
<main class="narrow uni">
  <form id="feedback-form" data-mailto="team@example.com"
        action="mailto:team@example.com" method="post" enctype="text/plain">
    <fieldset class="uni-opts">
      <legend class="uni-legend">Why did you uninstall?</legend>${options}
    </fieldset>
    <textarea id="feedback-text" name="details" rows="3"></textarea>
    <div class="cta-row uni-actions">
      <button class="btn btn-primary" type="submit">Send</button>
      <a class="uni-skip" href="/">No thanks</a>
    </div>
    <p class="uni-status" data-status role="status" aria-live="polite"></p>
  </form>
</main>`;
}

type Commit = { id: string; text: string; source: string; uid: string };

interface Harness {
  commits: Commit[];
  /** Every fetch the page made, so "no network yet" is assertable. */
  calls: string[];
  release: () => void;
}

/**
 * A fetch fake close enough to the emulator for this flow: the day counter
 * 404s until the first commit lands, then reports its value.
 */
function mockFirestore(opts: { failCommits?: boolean; defer?: boolean } = {}): Harness {
  const commits: Commit[] = [];
  const calls: string[] = [];
  let count = 0;
  const gate: Array<() => void> = [];

  const respond = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.indexOf(':commit') === -1) {
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
    const doc = JSON.parse(String(init?.body ?? '{}')).writes[0].update;
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
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (!opts.defer) return respond(url, init);
    return new Promise<Response>((res) => gate.push(() => res(respond(url, init) as never)));
  };

  return {
    commits,
    calls,
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
const box = (id: string) => $<HTMLInputElement>(`input[value="${id}"]`);
const submitBtn = () => $<HTMLButtonElement>('button[type=submit]');
const statusText = () => ($('[data-status]') as HTMLElement).textContent || '';
const flush = () => new Promise((r) => setTimeout(r, 0));

function tick(id: string): void {
  const el = box(id);
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function type(text: string): void {
  const el = $<HTMLTextAreaElement>('#feedback-text');
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function pressSend(): void {
  $<HTMLFormElement>('#feedback-form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
}

describe('nothing is sent before the button is pressed', () => {
  it('makes no request when a box is ticked', async () => {
    const fs = mockFirestore();
    boot();
    tick('setup');
    await flush();
    expect(fs.calls).toEqual([]);
  });

  it('makes no request while the visitor types', async () => {
    const fs = mockFirestore();
    boot();
    tick('setup');
    type('half a thought');
    type('half a thought, finished');
    await flush();
    expect(fs.calls).toEqual([]);
  });

  it('makes no request when the visitor changes their mind and unticks', async () => {
    const fs = mockFirestore();
    boot();
    tick('setup');
    tick('setup');
    tick('oneoff');
    await flush();
    expect(fs.calls).toEqual([]);
    expect(fs.commits).toHaveLength(0);
  });
});

describe('the submit button reflects whether there is anything to send', () => {
  it('starts disabled on an untouched form', () => {
    mockFirestore();
    boot();
    expect(submitBtn().disabled).toBe(true);
  });

  it('enables on a ticked box alone — reasons are a complete answer', () => {
    mockFirestore();
    boot();
    tick('setup');
    expect(submitBtn().disabled).toBe(false);
  });

  it('enables on prose alone — a note with no boxes is a complete answer too', () => {
    mockFirestore();
    boot();
    type('none of these, but here is the thing');
    expect(submitBtn().disabled).toBe(false);
  });

  it('goes back to disabled when the last input is cleared', () => {
    mockFirestore();
    boot();
    tick('setup');
    type('something');
    type('');
    expect(submitBtn().disabled).toBe(false); // box still ticked
    tick('setup');
    expect(submitBtn().disabled).toBe(true);
  });

  it('treats whitespace-only prose as empty', () => {
    mockFirestore();
    boot();
    type('   \n  ');
    expect(submitBtn().disabled).toBe(true);
  });
});

describe('submitting', () => {
  it('sends one doc with the ticked reasons', async () => {
    const fs = mockFirestore();
    boot();
    tick('setup');
    pressSend();
    await flush();

    expect(fs.commits).toHaveLength(1);
    expect(fs.commits[0].text).toBe('[reason:setup]');
    expect(fs.commits[0].source).toBe('site-uninstall');
    expect(fs.commits[0].uid).toBe('');
    expect(fs.commits[0].id).toMatch(/^\d{8}_1$/);
  });

  it('comma-joins several reasons in on-screen order, not click order', async () => {
    const fs = mockFirestore();
    boot();
    // Ticked bottom-up; the doc must still read top-down.
    tick('oneoff');
    tick('subtitles');
    tick('setup');
    pressSend();
    await flush();

    expect(fs.commits[0].text).toBe('[reason:subtitles,setup,oneoff]');
  });

  it('appends the prose after the machine-read prefix', async () => {
    const fs = mockFirestore();
    boot();
    tick('translation');
    type('the second line lagged behind');
    pressSend();
    await flush();

    expect(fs.commits[0].text).toBe('[reason:translation] the second line lagged behind');
  });

  it('sends prose alone when no box is ticked', async () => {
    const fs = mockFirestore();
    boot();
    type('something else entirely');
    pressSend();
    await flush();

    expect(fs.commits).toHaveLength(1);
    expect(fs.commits[0].text).toBe('something else entirely');
  });

  it('collapses the form and thanks the visitor', async () => {
    mockFirestore();
    boot();
    tick('setup');
    pressSend();
    await flush();

    expect(statusText()).toBe(I18N.sent);
    expect($('.uni-opts').hasAttribute('hidden')).toBe(true);
    expect($('#feedback-text').hasAttribute('hidden')).toBe(true);
    expect($('.uni-actions').hasAttribute('hidden')).toBe(true);
  });

  it('announces sending before the outcome, never a false success', async () => {
    const fs = mockFirestore({ defer: true });
    boot();
    tick('setup');
    pressSend();
    expect(statusText()).toBe(I18N.sending);

    fs.release();
    await flush();
    fs.release();
    await flush();
    expect(statusText()).toBe(I18N.sent);
  });

  it('ignores a double submit while the first is in flight', async () => {
    const fs = mockFirestore({ defer: true });
    boot();
    tick('setup');
    pressSend();
    pressSend();
    for (let i = 0; i < 4; i += 1) {
      fs.release();
      await flush();
    }
    expect(fs.commits).toHaveLength(1);
  });

  it('ignores further submits once the form has closed', async () => {
    const fs = mockFirestore();
    boot();
    tick('setup');
    pressSend();
    await flush();
    pressSend();
    await flush();
    expect(fs.commits).toHaveLength(1);
  });

  it('clamps to the UTF-8 budget while keeping the prefix intact', async () => {
    const fs = mockFirestore();
    boot();
    tick('setup');
    // Cyrillic is 2 bytes per char, so 3000 chars is 6000 bytes — well over.
    type('я'.repeat(3000));
    pressSend();
    await flush();

    const text = fs.commits[0].text;
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(2000);
    expect(text.indexOf('[reason:setup] ')).toBe(0);
  });
});

describe('when the write is refused', () => {
  it('offers mailto carrying the whole answer, and lets the visitor retry', async () => {
    mockFirestore({ failCommits: true });
    boot();
    tick('setup');
    type('and a note');
    pressSend();
    await flush();

    expect(statusText()).toContain(I18N.failed);
    const link = $<HTMLAnchorElement>('[data-status] a');
    expect(link.textContent).toBe(I18N.mailtoFallback);
    const href = decodeURIComponent(link.href);
    expect(href).toContain('[reason:setup]');
    expect(href).toContain('and a note');

    // The form stays open and the button live — this is recoverable.
    expect($('.uni-opts').hasAttribute('hidden')).toBe(false);
    expect(submitBtn().disabled).toBe(false);
  });

  it('sends again on retry rather than staying stuck', async () => {
    mockFirestore({ failCommits: true });
    boot();
    tick('setup');
    pressSend();
    await flush();

    const ok = mockFirestore();
    pressSend();
    await flush();
    expect(ok.commits).toHaveLength(1);
    expect(statusText()).toBe(I18N.sent);
  });
});
