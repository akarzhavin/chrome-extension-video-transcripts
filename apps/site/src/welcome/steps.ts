// The setup steps on /welcome/: Language, Account, Settings, in a left menu.
//
// Bundled by vite.auth.config.ts to build/welcome-steps.js. The steps are THE
// /welcome/ page: shown to every visitor, in place of the ordinary welcome
// content (which comes back after "Finish" when there is nowhere else to go).
//
// The extension opens this page on install with ?id=<its extension id>. When
// that extension answers over externally_connectable, every choice is written
// to it (packages/shared/src/welcome/bridge.ts validates each one). When it
// does not (opened by hand, extension not installed or disabled) the steps
// still show: languages from the list below, sign-in through the site's own
// page, and the switches shown off-limits with a pointer to install.
// All text comes from window.__WELCOME_STEPS, built per locale by build.mjs,
// and is set with textContent — nothing from the extension becomes markup.

// The extensions' language list, for a visitor whose extension did not answer.
// HDrezka's subset mirrors apps/rezka/src/config.ts SUBTITLE_LANGUAGES.
import { SUPPORTED_LANGUAGES } from '../../../../packages/shared/src/languages';
import type { AccountDeps } from './account';
import type { RuntimeAuthConfig } from '../auth/core';
const REZKA_LANGUAGES = ['en', 'ru', 'uk'];

export interface StepsI18n {
  menuLabel: string;
  progress: string;
  stepLanguage: string;
  stepAccount: string;
  stepSettings: string;
  required: string;
  optional: string;
  skipped: string;
  langTitle: string;
  langLead: string;
  learning: string;
  native: string;
  select: string;
  langHint: string;
  continue: string;
  accountTitle: string;
  accountLead: string;
  signIn: string;
  skip: string;
  accountHint: string;
  signedIn: string;
  settingsTitle: string;
  settingsLead: string;
  videoSites: string;
  siteSub: string;
  otherSub: string;
  otherInstalledSub: string;
  installed: string;
  addToChrome: string;
  anyWebsite: string;
  highlightLabel: string;
  highlightHint: string;
  finishYoutube: string;
  finish: string;
  needsExtension: string;
  retryConnect: string;
}

export interface Snapshot {
  ok: true;
  edition: 'youtube' | 'rezka';
  signedIn: boolean;
  email: string;
  learning: string;
  native: string;
  languages: Array<{ code: string; label: string; native: string }>;
  sites: Record<string, boolean>;
  pageHighlight: boolean;
  siblingInstalled: boolean;
  skippedAccount: boolean;
  finished: boolean;
}

/** The site's own sign-up / log-in copy (i18n auth.*), reused on the Account step. */
export interface AuthI18n {
  or: string;
  emailLabel: string;
  passwordLabel: string;
  registerPasswordPlaceholder: string;
  registerSubmit: string;
  registerBusy: string;
  registerGoogle: string;
  registerAltPrefix: string;
  registerAltLink: string;
  loginSubmit: string;
  loginBusy: string;
  loginGoogle: string;
  loginAltPrefix: string;
  loginAltLink: string;
}

declare global {
  interface Window {
    __WELCOME_STEPS?: { i18n: StepsI18n; auth: AuthI18n; lang: string };
    __WS_DEPS__?: AccountDeps;
    LINGOGRAM_AUTH?: RuntimeAuthConfig;
    lgTrack?: (name: string, params?: Record<string, unknown>) => void;
  }
}

const SITE_NAME: Record<string, string> = { youtube: 'YouTube', netflix: 'Netflix', rezka: 'HDrezka' };
const OTHER_SITES: Record<string, string[]> = { youtube: ['rezka'], rezka: ['youtube', 'netflix'] };
// The other edition's store page, by the edition that is installed here.
const OTHER_STORE: Record<string, string> = {
  youtube: 'https://chromewebstore.google.com/detail/hmdkmkimdbomemfcjmgeclchbcdbhabj',
  rezka: 'https://chromewebstore.google.com/detail/pkoibjilnaeadmcnmfkgcjhalljbmfan',
};
// This edition's own store page, for a visitor without it.
const OWN_STORE: Record<string, string> = {
  youtube: 'https://chromewebstore.google.com/detail/pkoibjilnaeadmcnmfkgcjhalljbmfan',
  rezka: 'https://chromewebstore.google.com/detail/hmdkmkimdbomemfcjmgeclchbcdbhabj',
};
const ANSWER_TIMEOUT_MS = 1500;


/** The extension id from ?id=, or null. Chrome ids are 32 letters a–p. */
export function extensionIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get('id') ?? '';
  return /^[a-p]{32}$/.test(id) ? id : null;
}

type Send = (message: Record<string, unknown>) => Promise<any>;

/** chrome.runtime.sendMessage to one extension, with a timeout. Null when unreachable. */
export function messenger(id: string, win: Window = window): Send | null {
  const runtime = (win as unknown as { chrome?: { runtime?: any } }).chrome?.runtime;
  if (!runtime?.sendMessage) return null;
  return (message) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ANSWER_TIMEOUT_MS);
      try {
        runtime.sendMessage(id, { type: 'lingogram-welcome', ...message }, (res: unknown) => {
          clearTimeout(timer);
          void runtime.lastError;
          resolve(res ?? null);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
}

/** What the steps show when no extension answered: nothing set, nothing switchable. */
export function offlineSnapshot(search: string): Snapshot {
  const edition = new URLSearchParams(search).get('ext') === 'rezka' ? 'rezka' : 'youtube';
  const langs = edition === 'rezka' ? SUPPORTED_LANGUAGES.filter((l) => REZKA_LANGUAGES.includes(l.code)) : SUPPORTED_LANGUAGES;
  return {
    ok: true,
    edition,
    signedIn: false,
    email: '',
    learning: '',
    native: '',
    languages: langs.map(({ code, label, native }) => ({ code, label, native })),
    sites: edition === 'rezka' ? { rezka: false } : { youtube: false, netflix: false },
    pageHighlight: false,
    siblingInstalled: false,
    skippedAccount: false,
    finished: false,
  };
}

export type Status = 'done' | 'skipped' | 'optional' | 'required';

/** The menu row of each step. Pure, for the tests. */
export function statuses(s: Snapshot, siteSignedIn = false): Status[] {
  const lang: Status = s.learning && s.native ? 'done' : 'required';
  const account: Status = s.signedIn || siteSignedIn ? 'done' : s.skippedAccount ? 'skipped' : 'optional';
  return [lang, account, s.finished ? 'done' : 'optional'];
}

/** The language in the page's locale, plus its own name when that differs. */
export function languageLabel(code: string, nativeName: string, english: string, pageLang: string): string {
  let local = english;
  try {
    local = new Intl.DisplayNames([pageLang], { type: 'language' }).of(code) || english;
  } catch {
    // no Intl.DisplayNames: the English name.
  }
  return local.toLowerCase() === nativeName.toLowerCase() ? local : `${local} — ${nativeName}`;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function track(win: Window, action: string, step: string): void {
  try {
    win.lgTrack?.('welcome_step', { step, action });
  } catch {
    // analytics never blocks setup.
  }
}

interface View {
  doc: Document;
  win: Window;
  t: StepsI18n;
  a: AuthI18n;
  /** Sign-up or log-in, on the Account step. */
  mode: 'register' | 'login';
  /** Signed in on the site during this visit (with or without the extension). */
  siteEmail: string;
  /** Why the extension could not be connected after a site sign-in, if it failed. */
  connectError: string;
  /** Retries that connection (set once a site sign-in has happened). */
  retryConnect: (() => Promise<void>) | null;
  lang: string;
  /** Null when no extension answered: choices stay on this page. */
  send: Send | null;
  root_: string;
  s: Snapshot;
  step: 0 | 1 | 2;
  root: HTMLElement;
  ordinary: HTMLElement | null;
}

export async function initSteps(doc: Document = document, win: Window = window): Promise<boolean> {
  const cfg = win.__WELCOME_STEPS;
  const root = doc.getElementById('ws');
  if (!cfg || !root) return false;
  const id = extensionIdFrom(win.location.search);
  let send: Send | null = id ? messenger(id, win) : null;
  let s = send ? ((await send({ op: 'state' })) as Snapshot | null) : null;
  if (!s || s.ok !== true) {
    send = null;
    s = offlineSnapshot(win.location.search);
  }

  const v: View = {
    doc,
    win,
    t: cfg.i18n,
    a: cfg.auth,
    mode: 'register',
    siteEmail: '',
    connectError: '',
    retryConnect: null,
    lang: cfg.lang,
    send,
    root_: cfg.lang === 'en' ? '' : `/${cfg.lang}`,
    s,
    step: s.learning && s.native ? (s.signedIn || s.skippedAccount ? 2 : 1) : 0,
    root,
    ordinary: doc.querySelector('main.wl'),
  };
  if (v.ordinary) v.ordinary.hidden = true;
  root.hidden = false;
  paint(v);
  track(win, 'shown', 'language');

  // A sign-in finishes in the /extension-auth tab the extension opened; pick it
  // up when this tab is looked at again.
  if (send) {
    const live = send;
    const refresh = async () => {
      const next = (await live({ op: 'state' })) as Snapshot | null;
      if (next?.ok === true) {
        v.s = next;
        paint(v);
      }
    };
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible') void refresh();
    });
    win.addEventListener('focus', () => void refresh());
  }
  return true;
}

function paint(v: View): void {
  v.root.replaceChildren(menu(v), content(v));
}

function menu(v: View): HTMLElement {
  const { doc, t } = v;
  const nav = el(doc, 'nav', 'ws-menu');
  nav.setAttribute('aria-label', t.menuLabel);
  const st = statuses(v.s, !!v.siteEmail);
  const done = st.filter((x) => x === 'done').length;

  const progress = el(doc, 'div', 'ws-progress');
  const bar = el(doc, 'div', 'ws-bar');
  const fill = el(doc, 'div', 'ws-bar-fill');
  fill.style.width = `${Math.round((done / 3) * 100)}%`;
  bar.appendChild(fill);
  progress.append(bar, el(doc, 'span', 'ws-progress-text', t.progress.replace('{done}', String(done))));

  const list = el(doc, 'div', 'ws-steps');
  const labels = [t.stepLanguage, t.stepAccount, t.stepSettings];
  const statusText: Record<Status, string> = { done: '', skipped: t.skipped, optional: t.optional, required: t.required };
  labels.forEach((label, i) => {
    const row = el(doc, 'button', 'ws-step');
    row.type = 'button';
    if (v.step === i) {
      row.classList.add('is-current');
      row.setAttribute('aria-current', 'step');
    }
    const isDone = st[i] === 'done';
    const dot = el(doc, 'span', `ws-dot${isDone ? ' is-done' : ''}`, isDone ? '✓' : String(i + 1));
    dot.setAttribute('aria-hidden', 'true');
    row.append(dot, el(doc, 'span', 'ws-step-label', label), el(doc, 'span', `ws-step-status${st[i] === 'skipped' ? ' is-skipped' : ''}`, statusText[st[i]]));
    row.addEventListener('click', () => {
      v.step = i as 0 | 1 | 2;
      paint(v);
    });
    list.appendChild(row);
  });
  nav.append(progress, list);
  return nav;
}

function content(v: View): HTMLElement {
  const box = el(v.doc, 'div', 'ws-content');
  if (v.step === 0) languageStep(v, box);
  else if (v.step === 1) accountStep(v, box);
  else settingsStep(v, box);
  return box;
}

function heading(v: View, box: HTMLElement, title: string, lead: string): void {
  box.append(el(v.doc, 'h1', 'ws-title', title), el(v.doc, 'p', 'ws-lead', lead));
}

function button(v: View, cls: string, text: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el(v.doc, 'button', cls, text);
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}

function languageStep(v: View, box: HTMLElement): void {
  const { doc, t, s } = v;
  heading(v, box, t.langTitle, t.langLead);
  const pick = (label: string, value: string) => {
    const row = el(doc, 'label', 'ws-field');
    row.appendChild(el(doc, 'span', 'ws-field-label', label));
    const select = el(doc, 'select', 'ws-select');
    const placeholder = el(doc, 'option', undefined, t.select);
    placeholder.value = '';
    placeholder.disabled = true;
    select.appendChild(placeholder);
    for (const l of s.languages) {
      const o = el(doc, 'option', undefined, languageLabel(l.code, l.native, l.label, v.lang));
      o.value = l.code;
      select.appendChild(o);
    }
    select.value = value;
    row.appendChild(select);
    return { row, select };
  };
  const offered = s.languages.map((l) => l.code);
  const guessed = (v.win.navigator.language || '').toLowerCase().split('-')[0];
  const learning = pick(t.learning, s.learning || (offered.includes('en') ? 'en' : ''));
  const native = pick(t.native, s.native || (offered.includes(guessed) && guessed !== learning.select.value ? guessed : ''));
  const next = button(v, 'ws-primary', t.continue, async (b) => {
    if (v.send) {
      b.disabled = true;
      const res = await v.send({ op: 'setLanguages', learning: learning.select.value, native: native.select.value });
      b.disabled = false;
      if (res?.ok !== true) return;
    }
    v.s = { ...v.s, learning: learning.select.value, native: native.select.value };
    track(v.win, 'done', 'language');
    v.step = 1;
    paint(v);
  });
  const sync = () => {
    next.disabled = !learning.select.value || !native.select.value;
  };
  learning.select.addEventListener('change', sync);
  native.select.addEventListener('change', sync);
  sync();
  box.append(learning.row, native.row, el(doc, 'span', 'ws-hint', t.langHint), next);
}

async function accountDeps(v: View): Promise<AccountDeps | null> {
  if (v.win.__WS_DEPS__) return v.win.__WS_DEPS__;
  const cfg = v.win.LINGOGRAM_AUTH;
  if (!cfg) return null;
  // The Firebase SDK is fetched only now, when someone signs in.
  const { realDeps } = await import('./account');
  return realDeps(cfg);
}

/**
 * After the site sign-in: hand the extension its own session, through the
 * same message the /extension-auth page sends. The one-shot nonce comes from
 * the extension itself, asked for just now.
 */
async function connectExtension(v: View, deps: AccountDeps, idToken: string, uid: string, email: string): Promise<boolean> {
  if (!v.send) return false;
  const begun = await v.send({ op: 'beginSignIn' });
  if (begun?.ok !== true || typeof begun.nonce !== 'string') return false;
  const customToken = await deps.extensionToken(idToken);
  const res = await v.send({ type: 'lingogram-extension-auth', payload: { customToken, uid, email, nonce: begun.nonce } });
  return res?.ok === true;
}

function accountStep(v: View, box: HTMLElement): void {
  const { doc, t, a, s } = v;
  heading(v, box, t.accountTitle, t.accountLead);
  const email = s.signedIn ? s.email : v.siteEmail;
  if (email) {
    box.appendChild(el(doc, 'div', 'ws-ok', t.signedIn.replace('{email}', email)));
    // Signed in on the site, but the extension did not take the session: say
    // so and offer another try, rather than a "signed in" that is half true.
    if (v.connectError && !s.signedIn) {
      const err = el(doc, 'div', 'ws-error', v.connectError);
      err.setAttribute('role', 'alert');
      box.appendChild(err);
      if (v.retryConnect) {
        const retry = v.retryConnect;
        box.appendChild(button(v, 'ws-secondary', t.retryConnect, async (b) => {
          b.disabled = true;
          await retry();
        }));
      }
    }
    box.appendChild(
      button(v, 'ws-primary', t.continue, () => {
        v.step = 2;
        paint(v);
      }),
    );
    return;
  }

  const reg = v.mode === 'register';
  const error = el(doc, 'div', 'ws-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const fail = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    error.textContent = msg;
    error.hidden = !msg;
  };
  const done = async (deps: AccountDeps, who: { uid: string; email: string; idToken: string }) => {
    v.siteEmail = who.email;
    track(v.win, reg ? 'registered' : 'signed_in', 'account');
    const connect = async () => {
      v.connectError = '';
      const connected = await connectExtension(v, deps, who.idToken, who.uid, who.email).catch((e) => {
        v.connectError = e instanceof Error ? e.message : String(e);
        return false;
      });
      if (connected && v.send) {
        const next = (await v.send({ op: 'state' })) as Snapshot | null;
        if (next?.ok === true) v.s = next;
      }
      paint(v);
    };
    v.retryConnect = v.send ? connect : null;
    await connect();
  };

  const google = el(doc, 'button', 'ws-secondary ws-google', reg ? a.registerGoogle : a.loginGoogle);
  google.type = 'button';
  google.addEventListener('click', async () => {
    google.disabled = true;
    fail('');
    try {
      const deps = await accountDeps(v);
      if (!deps) throw new Error('Sign-in is unavailable on this page.');
      await done(deps, await deps.google());
    } catch (err) {
      // Closing the Google popup is a choice, not an error.
      if (!/popup-closed|cancelled-popup/.test(String((err as { code?: string })?.code ?? ''))) fail(err);
    } finally {
      google.disabled = false;
    }
  });

  const form = el(doc, 'form', 'ws-form');
  form.noValidate = true;
  const field = (label: string, type: string, auto: string, placeholder = '') => {
    const row = el(doc, 'label', 'ws-field');
    row.appendChild(el(doc, 'span', 'ws-field-label', label));
    const input = el(doc, 'input', 'ws-input');
    input.type = type;
    input.autocomplete = auto;
    input.required = true;
    if (placeholder) input.placeholder = placeholder;
    row.appendChild(input);
    return { row, input };
  };
  const emailF = field(a.emailLabel, 'email', 'email');
  const passF = field(a.passwordLabel, 'password', reg ? 'new-password' : 'current-password', reg ? a.registerPasswordPlaceholder : '');
  const submit = el(doc, 'button', 'ws-primary', reg ? a.registerSubmit : a.loginSubmit);
  submit.type = 'submit';
  form.append(emailF.row, passF.row, error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = emailF.input.value.trim();
    const pw = passF.input.value;
    if (!em || !pw) return fail(reg ? a.registerPasswordPlaceholder : a.passwordLabel);
    submit.disabled = true;
    submit.textContent = reg ? a.registerBusy : a.loginBusy;
    fail('');
    try {
      const deps = await accountDeps(v);
      if (!deps) throw new Error('Sign-in is unavailable on this page.');
      await done(deps, reg ? await deps.register(em, pw) : await deps.login(em, pw));
    } catch (err) {
      fail(err);
      submit.disabled = false;
      submit.textContent = reg ? a.registerSubmit : a.loginSubmit;
    }
  });

  const switcher = el(doc, 'p', 'ws-hint');
  const link = el(doc, 'button', 'ws-linkbtn', reg ? a.registerAltLink : a.loginAltLink);
  link.type = 'button';
  link.addEventListener('click', () => {
    v.mode = reg ? 'login' : 'register';
    paint(v);
  });
  switcher.append(doc.createTextNode(`${reg ? a.registerAltPrefix : a.loginAltPrefix} `), link);

  box.append(
    google,
    el(doc, 'div', 'ws-or', a.or),
    form,
    switcher,
    button(v, 'ws-secondary', t.skip, async () => {
      await v.send?.({ op: 'progress', skippedAccount: true });
      v.s = { ...v.s, skippedAccount: true };
      track(v.win, 'skipped', 'account');
      v.step = 2;
      paint(v);
    }),
    el(doc, 'span', 'ws-hint', t.accountHint),
  );
}

function switchRow(v: View, title: string, sub: string, checked: boolean, onChange: (on: boolean) => Promise<boolean>) {
  const { doc } = v;
  const row = el(doc, 'label', 'ws-row');
  const text = el(doc, 'span', 'ws-row-text');
  text.append(el(doc, 'span', 'ws-row-title', title), el(doc, 'span', 'ws-row-sub', sub));
  const box = el(doc, 'input', 'ws-switch');
  box.type = 'checkbox';
  box.checked = checked;
  box.disabled = !v.send;
  box.addEventListener('change', async () => {
    const want = box.checked;
    // Shown as the extension stored it: a refused write flips the switch back.
    if (!(await onChange(want))) box.checked = !want;
  });
  row.append(text, box);
  return row;
}

function settingsStep(v: View, box: HTMLElement): void {
  const { doc, t, s } = v;
  heading(v, box, t.settingsTitle, t.settingsLead);
  const setPref = async (key: string, on: boolean) =>
    !!v.send && (await v.send({ op: 'setPrefs', prefs: { [key]: on } }))?.ok === true;
  if (!v.send) {
    // Nothing to switch without the extension: say so, and where to get it.
    const note = el(doc, 'div', 'ws-note');
    const add = el(doc, 'a', 'ws-secondary ws-add', t.addToChrome);
    add.href = OWN_STORE[s.edition];
    add.target = '_blank';
    add.rel = 'noopener';
    note.append(el(doc, 'span', undefined, t.needsExtension), add);
    box.appendChild(note);
  }

  box.appendChild(el(doc, 'div', 'ws-group-title', t.videoSites));
  const group = el(doc, 'div', 'ws-group');
  const prefKey: Record<string, string> = { youtube: 'siteYoutube', netflix: 'siteNetflix', rezka: 'siteRezka' };
  for (const [site, on] of Object.entries(s.sites)) {
    group.appendChild(
      switchRow(v, SITE_NAME[site] ?? site, t.siteSub, on, async (want) => {
        const ok = await setPref(prefKey[site], want);
        if (ok) v.s.sites[site] = want;
        return ok;
      }),
    );
  }
  const other = el(doc, 'div', 'ws-row');
  const otherText = el(doc, 'span', 'ws-row-text');
  otherText.append(
    el(doc, 'span', 'ws-row-title', (OTHER_SITES[s.edition] ?? []).map((x) => SITE_NAME[x]).join(', ')),
    el(doc, 'span', 'ws-row-sub', s.siblingInstalled ? t.otherInstalledSub : t.otherSub),
  );
  other.appendChild(otherText);
  if (s.siblingInstalled) {
    other.appendChild(el(doc, 'span', 'ws-installed', t.installed));
  } else {
    const add = el(doc, 'a', 'ws-secondary ws-add', t.addToChrome);
    add.href = OTHER_STORE[s.edition];
    add.target = '_blank';
    add.rel = 'noopener';
    other.appendChild(add);
  }
  group.appendChild(other);
  box.appendChild(group);

  box.appendChild(el(doc, 'div', 'ws-group-title', t.anyWebsite));
  const web = el(doc, 'div', 'ws-group');
  web.appendChild(
    switchRow(v, t.highlightLabel, t.highlightHint, s.pageHighlight, async (want) => {
      const ok = await setPref('pageHighlight', want);
      if (ok) v.s.pageHighlight = want;
      return ok;
    }),
  );
  box.appendChild(web);

  box.appendChild(
    button(v, 'ws-primary', s.edition === 'youtube' ? t.finishYoutube : t.finish, async () => {
      await v.send?.({ op: 'progress', finished: true });
      track(v.win, 'finished', 'settings');
      if (s.edition === 'youtube' && v.send) {
        v.win.location.href = 'https://www.youtube.com/';
        return;
      }
      // HDrezka, or no extension: back to the ordinary welcome content (the
      // reload-your-film-tab advice, the tour, the buttons to open a site).
      v.root.hidden = true;
      if (v.ordinary) v.ordinary.hidden = false;
    }),
  );
}

if (typeof window !== 'undefined' && !(window as unknown as { __WS_NO_AUTO__?: boolean }).__WS_NO_AUTO__) {
  void initSteps();
}
