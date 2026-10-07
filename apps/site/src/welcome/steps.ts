// The setup steps on /welcome/: Language, Account, Start, in a left menu.
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
// page, and the highlight switch shown off-limits with a pointer to install.
//
// The page speaks the visitor's NATIVE language: opened on the root (English)
// page it moves to the matching /<lang>/ page, and choosing another native
// language moves it again. The language being learned is picked from a short
// set of popular languages with flags, or from the rest in a list.
// All text comes from window.__WELCOME_STEPS, built per locale by build.mjs,
// and is set with textContent — nothing from the extension becomes markup.

// The extensions' language list, for a visitor whose extension did not answer.
// HDrezka's subset mirrors apps/rezka/src/config.ts SUBTITLE_LANGUAGES.
import { SUPPORTED_LANGUAGES } from '../../../../packages/shared/src/languages';
import type { AccountDeps } from './account';
import type { RuntimeAuthConfig } from '../auth/core';
import { FLAGS } from './flags';
const REZKA_LANGUAGES = ['en', 'ru', 'uk'];

export interface StepsI18n {
  menuLabel: string;
  progress: string;
  stepLanguage: string;
  stepAccount: string;
  stepStart: string;
  skipped: string;
  langTitle: string;
  langLead: string;
  learning: string;
  native: string;
  select: string;
  otherLanguage: string;
  nativeHint: string;
  continue: string;
  accountTitle: string;
  orEmail: string;
  skip: string;
  accountHint: string;
  signedIn: string;
  signedInSite: string;
  startTitle: string;
  startLead: string;
  startLeadRezka: string;
  watchFirst: string;
  addToChrome: string;
  highlightLabel: string;
  highlightHint: string;
  importLabel: string;
  importHint: string;
  importButton: string;
  finish: string;
  findVideo: string;
  frameCaption: string;
  demoLine: string;
  demoWord: string;
  demoSave: string;
  connectTitle: string;
  connectLead: string;
  updateTitle: string;
  updateLead: string;
  notNow: string;
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
  pageHighlight: boolean;
  /** The extension can import Google Translate words (not every build can). */
  gtImport?: boolean;
  skippedAccount: boolean;
  finished: boolean;
}

/** The site's own sign-up / log-in copy (i18n auth.*), reused on the Account step. */
export interface AuthI18n {
  emailLabel: string;
  passwordLabel: string;
  registerPasswordPlaceholder: string;
  registerSubmit: string;
  registerBusy: string;
  registerGoogle: string;
  loginSubmit: string;
  loginBusy: string;
  loginGoogle: string;
}

declare global {
  interface Window {
    __WELCOME_STEPS?: {
      i18n: StepsI18n;
      auth: AuthI18n;
      lang: string;
      /** Codes of the languages that have their own /<lang>/welcome/ page. */
      locales: string[];
      /** A checked first video by the language being learned. */
      videos: Record<string, { id?: string; title: string }>;
    };
    __WS_NAVIGATE__?: (url: string) => void;
    __WS_DEPS__?: AccountDeps;
    LINGOGRAM_AUTH?: RuntimeAuthConfig;
    lgTrack?: (name: string, params?: Record<string, unknown>) => void;
  }
}

// This edition's own store page, for a visitor without it.
const OWN_STORE: Record<string, string> = {
  youtube: 'https://chromewebstore.google.com/detail/pkoibjilnaeadmcnmfkgcjhalljbmfan',
  rezka: 'https://chromewebstore.google.com/detail/hmdkmkimdbomemfcjmgeclchbcdbhabj',
};
// The languages offered as tiles, in this order: the ones this site's own
// visitors learn most, then the most-studied languages in the world. English
// is always the first tile. The row is the same whatever the native language:
// choosing one never takes a tile away or shifts the others.
const POPULAR = ['en', 'es', 'de', 'ja', 'fr', 'ko', 'zh', 'it', 'pt', 'ru', 'uk'];
const TILE_COUNT = 8;
// Native languages as tiles, in the order this site's visitors have them
// (GA4, native language by users). The current one always comes first, so
// the pressed tile leads the row.
const NATIVE_POPULAR = ['ru', 'zh', 'es', 'en', 'pt', 'vi', 'ko', 'ja', 'tr', 'th', 'uk', 'ar', 'id'];
// Browser codes that differ from the site's locale codes.
const BROWSER_ALIAS: Record<string, string> = { nb: 'no', nn: 'no', tl: 'fil', iw: 'he' };
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
    pageHighlight: false,
    skippedAccount: false,
    finished: false,
  };
}

export type Status = 'done' | 'skipped' | 'todo';

/** The menu row of each step. Pure, for the tests. */
export function statuses(s: Snapshot, siteSignedIn = false): Status[] {
  const lang: Status = s.learning && s.native ? 'done' : 'todo';
  const account: Status = s.signedIn || siteSignedIn ? 'done' : s.skippedAccount ? 'skipped' : 'todo';
  return [lang, account, s.finished ? 'done' : 'todo'];
}

/**
 * The popular-language tiles: English always first, then the rest of POPULAR,
 * TILE_COUNT in all. Pure, for the tests.
 */
export function popularTiles(offered: string[]): string[] {
  const first = offered.includes('en') ? ['en'] : [];
  const rest = POPULAR.filter((c) => c !== 'en' && offered.includes(c));
  return [...first, ...rest].slice(0, TILE_COUNT);
}

/**
 * The native-language tiles: the default first (the system language, unless
 * one was saved or picked), then `picked` when it is a language from the list,
 * so the pressed tile is in view, then NATIVE_POPULAR as offered, TILE_COUNT
 * in all. A tile picked from the row keeps its place. Pure, for the tests.
 */
export function nativeTiles(offered: string[], current: string, picked = ''): string[] {
  const lead = [current, picked].filter((c, i, a) => c && offered.includes(c) && a.indexOf(c) === i);
  const list = NATIVE_POPULAR.filter((c) => offered.includes(c) && !lead.includes(c));
  return [...lead, ...list].slice(0, TILE_COUNT);
}

/**
 * Where the page should move so it speaks `want` (a native language, or the
 * browser's), or null to stay. Only the root page (English) moves; a page the
 * visitor reached on purpose, or one they were sent to by a choice (`hl`),
 * stays put. Pure, for the tests.
 */
export function localeTarget(o: { lang: string; locales: string[]; want: string; search: string }): string | null {
  if (o.lang !== 'en' || new URLSearchParams(o.search).has('hl')) return null;
  const code = BROWSER_ALIAS[o.want] ?? o.want;
  if (!code || code === 'en' || !o.locales.includes(code)) return null;
  return `/${code}/welcome/${o.search}`;
}

/** The address of the page in `code`'s language, marked as a choice (`hl`) so it is not moved again. */
export function pageFor(code: string, search: string): string {
  const q = new URLSearchParams(search);
  q.set('hl', '1');
  return `${code === 'en' ? '' : `/${code}`}/welcome/?${q.toString()}`;
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

const STASH_KEY = 'ws.learning';

function stash(win: Window, code?: string): string {
  try {
    if (code !== undefined) {
      win.sessionStorage.setItem(STASH_KEY, code);
      return '';
    }
    const v = win.sessionStorage.getItem(STASH_KEY) ?? '';
    win.sessionStorage.removeItem(STASH_KEY);
    return v;
  } catch {
    return '';
  }
}

// Without the extension the page has nowhere else to keep the visitor's
// answers: without this, a reload starts the setup over. The extension's own
// record wins whenever it answers.
const LOCAL_KEY = 'ws.local';

interface LocalAnswers {
  learning?: string;
  native?: string;
  skippedAccount?: boolean;
}

function readLocal(win: Window): LocalAnswers {
  try {
    const v = JSON.parse(win.localStorage.getItem(LOCAL_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeLocal(win: Window, patch: LocalAnswers): void {
  try {
    win.localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(win), ...patch }));
  } catch {
    // Storage blocked: the answers last as long as the tab.
  }
}

function navigate(win: Window, url: string): void {
  if (win.__WS_NAVIGATE__) win.__WS_NAVIGATE__(url);
  else win.location.assign(url);
}

interface View {
  /** The native language the page opened with: it leads the native row and stays put on a click. */
  nativeFirst: string;
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
  /** A sign-in is in flight: the page must not be rebuilt under it. */
  busy: boolean;
  /** Retries that connection (set once a site sign-in has happened). */
  retryConnect: (() => Promise<void>) | null;
  lang: string;
  locales: string[];
  videos: Record<string, { id?: string; title: string }>;
  /** Null when no extension answered: choices stay on this page. */
  send: Send | null;
  s: Snapshot;
  /** The two languages as picked so far, saved to the extension on Continue. */
  draft: { learning: string; native: string };
  step: 0 | 1 | 2;
  root: HTMLElement;
  ordinary: HTMLElement | null;
}

/** The browser's first language as a bare code ('pt-BR' → 'pt'). */
function browserLanguage(win: Window): string {
  const first = win.navigator.languages?.[0] || win.navigator.language || '';
  return first.toLowerCase().split('-')[0];
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
    const kept = readLocal(win);
    const codes = s.languages.map((l) => l.code);
    if (kept.learning && kept.native && codes.includes(kept.learning) && codes.includes(kept.native)) {
      s = { ...s, learning: kept.learning, native: kept.native };
    }
    if (kept.skippedAccount === true) s = { ...s, skippedAccount: true };
  }

  // Speak the visitor's native language: the one saved in the extension, else the browser's.
  const move = localeTarget({ lang: cfg.lang, locales: cfg.locales ?? [], want: s.native || browserLanguage(win), search: win.location.search });
  if (move) {
    navigate(win, move);
    return true;
  }

  const offered = s.languages.map((l) => l.code);
  // A page opened by choosing a native language (`hl`) is that language; the
  // pick made just before moving here comes with it. Otherwise what the
  // extension saved leads, then the system's language, then the page's.
  const chose = new URLSearchParams(win.location.search).has('hl');
  const system = BROWSER_ALIAS[browserLanguage(win)] ?? browserLanguage(win);
  const native =
    chose && offered.includes(cfg.lang)
      ? cfg.lang
      : s.native || (offered.includes(system) ? system : offered.includes(cfg.lang) ? cfg.lang : '');
  const kept = stash(win);
  let learning = offered.includes(kept) ? kept : s.learning;
  if (!learning && native !== 'en' && offered.includes('en')) learning = 'en';

  const v: View = {
    nativeFirst: native,
    doc,
    win,
    t: cfg.i18n,
    a: cfg.auth,
    mode: 'register',
    siteEmail: '',
    connectError: '',
    busy: false,
    retryConnect: null,
    lang: cfg.lang,
    locales: cfg.locales ?? [],
    videos: cfg.videos ?? {},
    send,
    s,
    draft: { learning, native },
    // Back on the Language step after choosing a native language, even when
    // languages were saved before: the choice is not finished until Continue.
    step: !chose && s.learning && s.native ? (s.signedIn || s.skippedAccount ? 2 : 1) : 0,
    root,
    ordinary: doc.querySelector('main.wl'),
  };
  if (v.ordinary) v.ordinary.hidden = true;
  root.hidden = false;
  paint(v);
  track(win, 'shown', ['language', 'account', 'start'][v.step]);
  void restoreSiteSession(v);

  // A sign-in finishes in the /extension-auth tab the extension opened; pick it
  // up when this tab is looked at again.
  if (send) {
    const live = send;
    const refresh = async () => {
      const next = (await live({ op: 'state' })) as Snapshot | null;
      // Looking at the tab again must not wipe what is being typed: repaint
      // only when the extension's answer differs from what is shown.
      if (next?.ok === true && !v.busy && JSON.stringify(next) !== JSON.stringify(v.s)) {
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

/**
 * A visitor who signed in on the site earlier is still signed in there: the
 * session survives a reload even when the extension never took it. Show it,
 * and when there is an extension, let Continue hand it over.
 */
async function restoreSiteSession(v: View): Promise<void> {
  if (v.s.signedIn) return;
  const deps = await accountDeps(v).catch(() => null);
  const who = deps?.session ? await deps.session().catch(() => null) : null;
  if (!deps || !who || v.siteEmail || v.s.signedIn) return;
  v.siteEmail = who.email;
  if (v.send) v.retryConnect = makeConnect(v, deps, who);
  if (!v.busy) paint(v);
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
  const labels = [t.stepLanguage, t.stepAccount, t.stepStart];
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
    row.append(dot, el(doc, 'span', 'ws-step-label', label), el(doc, 'span', 'ws-step-status is-skipped', st[i] === 'skipped' ? t.skipped : ''));
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
  else startStep(v, box);
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

/** A language's name in the page's language, capitalised the way a label is. */
function localName(code: string, english: string, pageLang: string): string {
  let name = english;
  try {
    name = new Intl.DisplayNames([pageLang], { type: 'language' }).of(code) || english;
  } catch {
    // no Intl.DisplayNames: the English name.
  }
  return name.charAt(0).toLocaleUpperCase(pageLang) + name.slice(1);
}

interface PickerOptions {
  cls: string;
  label: string;
  tiles: string[];
  chosen: string;
  name: (code: string) => string;
  rest: Array<{ code: string; label: string; native: string }>;
  otherCls?: string;
  pick: (code: string) => void;
}

/** Popular languages as tiles (with flags, but not for HDrezka), and every other one in a list after them. */
function tilePicker(v: View, o: PickerOptions): HTMLElement {
  const { doc, t } = v;
  const field = el(doc, 'div', `ws-field ${o.cls}`);
  field.appendChild(el(doc, 'span', 'ws-field-label', o.label));
  const grid = el(doc, 'div', 'ws-tiles');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', o.label);
  for (const code of o.tiles) {
    const tile = el(doc, 'button', 'ws-tile');
    tile.type = 'button';
    tile.dataset.code = code;
    tile.setAttribute('aria-pressed', String(o.chosen === code));
    // No flags for HDrezka: its languages are Russian and Ukrainian, and a
    // country's flag next to the other's can hurt. The names say it all.
    if (v.s.edition !== 'rezka' && FLAGS[code]) {
      const flag = el(doc, 'span', 'ws-flag');
      flag.innerHTML = FLAGS[code]; // constant markup from flags.ts
      tile.appendChild(flag);
    }
    tile.appendChild(el(doc, 'span', 'ws-tile-name', o.name(code)));
    tile.addEventListener('click', () => o.pick(code));
    grid.appendChild(tile);
  }
  if (o.rest.length) {
    const other = el(doc, 'select', `ws-select ws-other${o.otherCls ? ` ${o.otherCls}` : ''}`);
    other.setAttribute('aria-label', `${o.label}: ${t.otherLanguage}`);
    const placeholder = el(doc, 'option', undefined, t.otherLanguage);
    placeholder.value = '';
    other.appendChild(placeholder);
    for (const l of o.rest) {
      const opt = el(doc, 'option', undefined, languageLabel(l.code, l.native, l.label, v.lang));
      opt.value = l.code;
      other.appendChild(opt);
    }
    other.value = o.tiles.includes(o.chosen) ? '' : o.chosen;
    if (other.value) other.classList.add('is-chosen');
    other.addEventListener('change', () => o.pick(other.value));
    grid.appendChild(other);
  }
  field.appendChild(grid);
  return field;
}

function languageStep(v: View, box: HTMLElement): void {
  const { doc, t, s } = v;
  heading(v, box, t.langTitle, t.langLead);
  const byCode = new Map(s.languages.map((l) => [l.code, l]));
  const offered = s.languages.map((l) => l.code);

  // I'm learning: popular languages as tiles, everything else in a list.
  const learnTiles = popularTiles(offered);
  const learn = tilePicker(v, {
    cls: 'ws-learn',
    label: t.learning,
    tiles: learnTiles,
    chosen: v.draft.learning,
    name: (code) => localName(code, byCode.get(code)?.label ?? code, v.lang),
    rest: s.languages.filter((l) => !learnTiles.includes(l.code)),
    pick: (code) => {
      v.draft.learning = code;
      paint(v);
    },
  });

  // My native language, also the language of this page: the same tiles, each
  // named in its own language so a speaker finds theirs on any page.
  const nativeCodes = nativeTiles(
    offered,
    v.nativeFirst,
    nativeTiles(offered, v.nativeFirst).includes(v.draft.native) ? '' : v.draft.native,
  );
  const nativeRow = tilePicker(v, {
    cls: 'ws-native-field',
    label: t.native,
    tiles: nativeCodes,
    chosen: v.draft.native,
    name: (code) => byCode.get(code)?.native ?? code,
    rest: s.languages.filter((l) => !nativeCodes.includes(l.code)),
    otherCls: 'ws-native',
    pick: (code) => {
      v.draft.native = code;
      if (v.draft.learning === code) v.draft.learning = '';
      // The page follows: this language's page, with the learning pick carried over.
      if (code !== v.lang && v.locales.includes(code)) {
        stash(v.win, v.draft.learning);
        navigate(v.win, pageFor(code, v.win.location.search));
        return;
      }
      paint(v);
    },
  });

  const next = button(v, 'ws-primary', t.continue, async (b) => {
    if (v.send) {
      b.disabled = true;
      const res = await v.send({ op: 'setLanguages', learning: v.draft.learning, native: v.draft.native });
      b.disabled = false;
      if (res?.ok !== true) return;
    }
    v.s = { ...v.s, learning: v.draft.learning, native: v.draft.native };
    if (!v.send) writeLocal(v.win, { learning: v.draft.learning, native: v.draft.native });
    track(v.win, 'done', 'language');
    v.step = 1;
    paint(v);
  });
  next.disabled = !v.draft.learning || !v.draft.native;
  box.append(learn, nativeRow, el(doc, 'span', 'ws-hint', t.nativeHint), next);
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

/**
 * The signed-in learner's last step lives in the cabinet: /app/vocab/start
 * shows the same introduction as step 3 here, and retires itself once a word
 * is saved. The extension id goes along so the cabinet can talk to it.
 */
export function cabinetUrl(extId: string, edition: string): string {
  const q = new URLSearchParams({ ext: extId, edition, from: 'welcome' });
  return `/app/vocab/start?${q.toString()}`;
}

function toCabinet(v: View): void {
  track(v.win, 'to_cabinet', 'account');
  navigate(v.win, cabinetUrl(extensionIdFrom(v.win.location.search), v.s.edition));
}

/** Hands the site session to the extension; on success, on to the cabinet. */
function makeConnect(v: View, deps: AccountDeps, who: { uid: string; email: string; idToken: string }): () => Promise<void> {
  return async () => {
    v.connectError = '';
    const connected = await connectExtension(v, deps, who.idToken, who.uid, who.email).catch((e) => {
      v.connectError = e instanceof Error ? e.message : String(e);
      return false;
    });
    if (!connected && v.send && !v.connectError) v.connectError = 'Could not connect the extension.';
    if (connected && v.send) {
      const next = (await v.send({ op: 'state' })) as Snapshot | null;
      if (next?.ok === true) v.s = next;
    }
    // Signed in everywhere it can be: on to the cabinet, whose first screen
    // is the introduction (unless the visitor has gone to another step
    // meanwhile). A half-done connection stays here, with its message and
    // the retry; signed in on the site with no extension, the last step here
    // asks for the install.
    if (!v.connectError && v.step === 1) {
      if (connected && v.send) {
        toCabinet(v);
        return;
      }
      v.step = 2;
    }
    paint(v);
  };
}

function accountStep(v: View, box: HTMLElement): void {
  const { doc, t, a, s } = v;
  box.appendChild(el(doc, 'h1', 'ws-title', t.accountTitle));
  const email = s.signedIn ? s.email : v.siteEmail;
  if (email) {
    // "and in the extension" only when the extension says so.
    const line = s.signedIn ? t.signedIn : t.signedInSite;
    box.appendChild(el(doc, 'div', 'ws-ok', line.replace('{email}', () => email)));
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
      button(v, 'ws-primary', t.continue, async (b) => {
        if (s.signedIn && v.send) {
          toCabinet(v);
          return;
        }
        // Signed in on the site only: hand the session over first.
        if (v.send && v.retryConnect && !v.connectError) {
          b.disabled = true;
          await v.retryConnect();
          return;
        }
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
    const connect = makeConnect(v, deps, who);
    v.retryConnect = v.send ? connect : null;
    await connect();
  };

  // Create account / Log in: the same form either way, the mode picks the words.
  const modes = el(doc, 'div', 'ws-modes');
  modes.setAttribute('role', 'tablist');
  for (const [mode, label] of [['register', a.registerSubmit], ['login', a.loginSubmit]] as const) {
    const tab = el(doc, 'button', 'ws-mode', label);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(v.mode === mode));
    tab.addEventListener('click', () => {
      if (v.mode === mode) return;
      v.mode = mode;
      paint(v);
    });
    modes.appendChild(tab);
  }
  box.appendChild(modes);

  const google = el(doc, 'button', 'ws-secondary ws-google');
  google.type = 'button';
  const mark = el(doc, 'span', 'ws-gmark');
  mark.innerHTML = GOOGLE_G; // constant markup
  google.append(mark, doc.createTextNode(reg ? a.registerGoogle : a.loginGoogle));
  google.addEventListener('click', async () => {
    google.disabled = true;
    v.busy = true;
    fail('');
    try {
      const deps = await accountDeps(v);
      if (!deps) throw new Error('Sign-in is unavailable on this page.');
      await done(deps, await deps.google());
    } catch (err) {
      // Closing the Google popup is a choice, not an error.
      if (!/popup-closed|cancelled-popup/.test(String((err as { code?: string })?.code ?? ''))) fail(err);
    } finally {
      v.busy = false;
      google.disabled = false;
    }
  });

  box.append(google, el(doc, 'div', 'ws-or', t.orEmail));

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
    v.busy = true;
    fail('');
    try {
      const deps = await accountDeps(v);
      if (!deps) throw new Error('Sign-in is unavailable on this page.');
      await done(deps, reg ? await deps.register(em, pw) : await deps.login(em, pw));
    } catch (err) {
      fail(err);
      submit.disabled = false;
      submit.textContent = reg ? a.registerSubmit : a.loginSubmit;
    } finally {
      v.busy = false;
    }
  });

  // Skipping is a link in the closing line, next to the reason it is safe.
  const foot = el(doc, 'p', 'ws-hint ws-skip-line');
  const skip = button(v, 'ws-linkbtn', t.skip, async () => {
    await v.send?.({ op: 'progress', skippedAccount: true });
    v.s = { ...v.s, skippedAccount: true };
    if (!v.send) writeLocal(v.win, { skippedAccount: true });
    track(v.win, 'skipped', 'account');
    v.step = 2;
    paint(v);
  });
  foot.append(doc.createTextNode(`${t.accountHint} `), skip);
  box.append(form, foot);
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

// Google's "G", as its sign-in buttons carry it. Constant markup.
const GOOGLE_G =
  '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

const PLAY =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#fff"/></svg>';

/** YouTube's own "Subtitles/CC" search filter. */
const CC_FILTER = 'EgIoAQ%3D%3D';

/** Videos with subtitles, for a language with no checked first video. */
export function searchUrl(languageName: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(languageName)}&sp=${CC_FILTER}`;
}

// The still the step is built around: one subtitle line of the first video,
// its translation into the page language, and the card a click on the marked
// word opens. The subtitle line is English on every page, like the video.
const DEMO_BEFORE = 'We are looking back at the cosmic ';
const DEMO_WORD = 'dawn';

function demoFrame(v: View): HTMLElement {
  const { doc, t } = v;
  const fig = el(doc, 'figure', 'ws-frame');
  const pic = el(doc, 'div', 'ws-frame-pic');
  const first = v.videos.en;
  if (first?.id) {
    const img = el(doc, 'img') as HTMLImageElement;
    img.src = `https://i.ytimg.com/vi/${first.id}/mqdefault.jpg`;
    img.alt = '';
    pic.appendChild(img);
  }
  const subs = el(doc, 'div', 'ws-frame-subs');
  const line = el(doc, 'p', 'ws-frame-l1');
  line.append(doc.createTextNode(DEMO_BEFORE), el(doc, 'mark', undefined, DEMO_WORD));
  subs.appendChild(line);
  if (t.demoLine) subs.appendChild(el(doc, 'p', 'ws-frame-l2', t.demoLine));
  const card = el(doc, 'div', 'ws-frame-card');
  card.append(el(doc, 'b', undefined, DEMO_WORD), el(doc, 'span', 'ws-frame-tr', t.demoWord), el(doc, 'span', 'ws-frame-save', `\u2661 ${t.demoSave}`));
  pic.append(subs, card);
  fig.append(pic, el(doc, 'figcaption', 'ws-frame-cap', t.frameCaption));
  return fig;
}

function startStep(v: View, box: HTMLElement): void {
  const { doc, t, s } = v;
  const rezka = s.edition === 'rezka';

  // Back to the ordinary welcome content (HDrezka's reload-your-film advice).
  const leave = async () => {
    await v.send?.({ op: 'progress', finished: true });
    track(v.win, 'finished', 'start');
    v.root.hidden = true;
    if (v.ordinary) v.ordinary.hidden = false;
  };

  if (!v.send) {
    // No answer from the extension. The page cannot tell "not installed" from
    // "installed, too old to answer" or "opened by hand": it says only what it
    // knows. A link the extension opened carries its id, so the extension is
    // there and only needs updating; without one, either may be true.
    const openedByExtension = extensionIdFrom(v.win.location.search) !== null;
    box.appendChild(el(doc, 'h1', 'ws-title', openedByExtension ? t.updateTitle : t.connectTitle));
    box.appendChild(demoFrame(v));
    const card = el(doc, 'div', 'ws-install');
    const text = el(doc, 'span', 'ws-row-text');
    text.append(el(doc, 'span', 'ws-row-title', openedByExtension ? t.updateLead : t.connectLead));
    card.appendChild(text);
    if (!openedByExtension) {
      const add = el(doc, 'a', 'ws-primary ws-add', t.addToChrome);
      add.href = OWN_STORE[s.edition];
      add.target = '_blank';
      add.rel = 'noopener';
      add.addEventListener('click', () => track(v.win, 'install', 'start'));
      card.appendChild(add);
    }
    box.appendChild(card);
    const later = button(v, 'ws-linkbtn ws-later', t.notNow, leave);
    box.appendChild(later);
    return;
  }

  box.appendChild(el(doc, 'h1', 'ws-title', t.startTitle));
  box.appendChild(demoFrame(v));

  // The first video: one we checked, for the language being learned; else a
  // YouTube search in that language, subtitles only.
  const learning = s.learning || v.draft.learning;
  const video = rezka ? undefined : v.videos[learning];
  const videoUrl = video?.id ? `https://www.youtube.com/watch?v=${video.id}` : '';
  const name = s.languages.find((l) => l.code === learning)?.native || learning;
  if (rezka) {
    box.appendChild(button(v, 'ws-primary ws-go', t.finish, leave));
    box.appendChild(el(doc, 'p', 'ws-hint ws-after', t.startLeadRezka));
  } else {
    const go = button(v, 'ws-primary ws-go', videoUrl ? t.watchFirst : t.findVideo, async () => {
      await v.send?.({ op: 'progress', finished: true });
      track(v.win, 'finished', 'start');
      navigate(v.win, videoUrl || searchUrl(name));
    });
    if (video && videoUrl) {
      go.appendChild(el(doc, 'small', 'ws-go-sub', `${video.title} \u00b7 YouTube`));
    }
    box.appendChild(go);
    box.appendChild(el(doc, 'p', 'ws-hint ws-after', t.startLead));
  }

  // What else it does, kept quiet: highlight saved words on any site, and
  // bring in the words already saved in Google Translate.
  const chips = el(doc, 'div', 'ws-chips');
  chips.appendChild(
    switchRow(v, t.highlightLabel, t.highlightHint, s.pageHighlight, async (want) => {
      const ok = (await v.send?.({ op: 'setPrefs', prefs: { pageHighlight: want } }))?.ok === true;
      if (ok) v.s.pageHighlight = want;
      return ok;
    }),
  );
  if (s.gtImport === true) {
    const row = el(doc, 'div', 'ws-row');
    const text = el(doc, 'span', 'ws-row-text');
    text.append(el(doc, 'span', 'ws-row-title', t.importLabel), el(doc, 'span', 'ws-row-sub', t.importHint));
    const run = button(v, 'ws-secondary ws-add', t.importButton, async () => {
      await v.send?.({ op: 'openGtImport' });
    });
    row.append(text, run);
    chips.appendChild(row);
  }
  box.appendChild(chips);
}

if (typeof window !== 'undefined' && !(window as unknown as { __WS_NO_AUTO__?: boolean }).__WS_NO_AUTO__) {
  void initSteps();
}
