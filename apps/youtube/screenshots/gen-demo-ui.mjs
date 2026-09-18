// Regenerates apps/youtube/src/content/demo-ui.ts from _locales/<loc>/messages.json.
//
//   node apps/youtube/screenshots/gen-demo-ui.mjs
//
// WHY THIS EXISTS
// Chrome's --lang flag does NOT change an extension's UI language, so a promo
// capture would render the sidebar in English no matter which locale it is for.
// Demo mode works around that by installing an i18n override map (setI18nOverride
// in packages/shared/src/i18n.ts) built from this file.
//
// The map used to carry only the 14 sidebar-chrome keys, which was enough while
// promo slides showed the subtitle list. It is not enough for the settings panel:
// every label outside the map falls through to the English default compiled into
// SidebarUI.ts, so a Russian capture came back with "Языки" next to "Font family".
//
// KEYS is therefore derived from the SOURCE rather than hand-listed, so a new
// control cannot silently go untranslated in captures.
//
// IT HAPPENED AGAIN, AND THAT IS WHY THE SCAN IS NOW A DIRECTORY WALK. The list
// was two named files, SidebarUI.ts and auth-status-badge.ts. When the lookup
// card and the word screen shipped, their eight keys (ytLookupSave,
// ytLookupRemove, ytLookupLoading, …) were in neither, so every localized
// capture would have drawn the dictionary's buttons in English — the same bug
// as "Языки" next to "Font family", one layer down. A named-file list is a
// hand-written list wearing a derivation's clothes: it only covers the files
// someone remembered. Walking packages/shared/src + apps/youtube/src instead
// means a new UI file is covered the day it is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');            // apps/youtube
const LOCALES = path.join(ROOT, '_locales');
const SHARED_SRC = path.resolve(ROOT, '../../packages/shared/src');
const YT_SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'src/content/demo-ui.ts');

// Every msg()/i18nMsg() key anywhere in the in-page UI source.
const keysIn = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:i18n)?[mM]sg\('([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
};
// Walk rather than name files: see the note above on why a named list rots.
// Tests and generated output are skipped — a key that only a test mentions is
// not rendered, and demo-ui.ts is this script's own product.
const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      out.push(...walk(full));
    } else if (/\.ts$/.test(e.name)
      && !/\.(test|spec)\.ts$/.test(e.name)
      && e.name !== 'demo-ui.ts') {
      out.push(full);
    }
  }
  return out;
};
const SOURCES = [...walk(SHARED_SRC), ...walk(YT_SRC)];
const KEYS = [...new Set(SOURCES.flatMap(keysIn))].sort();

const locales = fs.readdirSync(LOCALES).filter((d) =>
  fs.existsSync(path.join(LOCALES, d, 'messages.json'))).sort();

const blocks = [];
for (const loc of locales) {
  const msgs = JSON.parse(fs.readFileSync(path.join(LOCALES, loc, 'messages.json'), 'utf8'));
  const lines = [];
  for (const k of KEYS) {
    const m = msgs[k]?.message;
    // Absent keys are simply omitted: msg() then falls back to chrome.i18n and
    // finally to the English default, which is the correct behaviour for a key
    // this locale has not translated yet.
    if (m != null) lines.push(`        ${JSON.stringify(k)}: ${JSON.stringify(m)},`);
  }
  blocks.push(`    ${JSON.stringify(loc)}: {\n${lines.join('\n')}\n    },`);
}

const out = `// Extension-UI strings the promo demo renders, per locale — GENERATED from
// _locales/<loc>/messages.json by screenshots/gen-demo-ui.mjs. Do not edit by
// hand; run the generator instead.
//
// Demo mode feeds these to msg() via setI18nOverride so the whole sidebar —
// header, onboarding labels AND the settings panel — localizes in screenshots,
// independent of Chrome's extension-UI language (which --lang does not change).
//
// Covers every key SidebarUI.ts and auth-status-badge.ts render (${KEYS.length} keys,
// ${locales.length} locales). Not used outside demo mode.

export type DemoUiStrings = Record<string, string>;

export const DEMO_UI_BY_LANG: Record<string, DemoUiStrings> = {
${blocks.join('\n')}
};
`;
fs.writeFileSync(OUT, out);
console.log(`✓ ${locales.length} locales × up to ${KEYS.length} keys → ${path.relative(process.cwd(), OUT)}`);
