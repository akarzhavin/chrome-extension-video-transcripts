#!/usr/bin/env node
/**
 * Гоняет панель из docs/setDescription.js на живом дашборде CWS через CDP.
 *
 * Зачем скрипт, а не сниппет руками: панель читает файлы из <input type=file>,
 * который человеку пришлось бы наполнять диалогом на каждый язык. Playwright
 * умеет положить файлы в input напрямую (setInputFiles), поэтому весь прогон
 * идёт без единого клика — а консольный лог панели виден здесь же.
 *
 *   node scripts/cws-upload-shots.mjs --dir apps/youtube/promo/out/store-i18n@5
 *   node scripts/cws-upload-shots.mjs --dir <...> --only en,ru      # подмножество
 *   node scripts/cws-upload-shots.mjs --dir <...> --add             # не заменять
 *   node scripts/cws-upload-shots.mjs --dir <...> --dry             # только отчёт
 */
import { chromium } from 'playwright-core';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { verifyOrder } from './lib/cws-verify-order.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);

const DIR = resolve(arg('dir', 'apps/youtube/promo/out/store-i18n@5'));
const ONLY = (arg('only') || '').split(',').map(s => s.trim()).filter(Boolean);
const REPLACE = !has('add');
const SECTION = arg('section', 'Localised screenshots');
const CDP = arg('cdp', 'http://127.0.0.1:9333');

// ---- собираем файлы: <dir>/<lang>/screenshot-N.png ------------------------
const locales = readdirSync(DIR)
  .filter(d => statSync(join(DIR, d)).isDirectory())
  .filter(d => !ONLY.length || ONLY.includes(d))
  .sort();
if (!locales.length) { console.error('нет локалей в ' + DIR); process.exit(1); }

const plan = locales.map(code => ({
  code: code.replace(/_/g, '-'),
  dirName: code,
  files: readdirSync(join(DIR, code))
    .filter(f => /\.(png|jpe?g)$/i.test(f))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)?.[1] ?? 0, 10)) - (parseInt(b.match(/(\d+)/)?.[1] ?? 0, 10)))
    .map(f => join(DIR, code, f)),
}));

console.log(`папка: ${DIR}`);
console.log(`локалей: ${plan.length} · файлов: ${plan.reduce((n, p) => n + p.files.length, 0)}`);
console.log(`секция: ${SECTION} · режим: ${REPLACE ? 'ЗАМЕНИТЬ' : 'добавить'}`);
const odd = plan.filter(p => p.files.length !== 4);
if (odd.length) console.log('⚠ не по 4 файла: ' + odd.map(p => `${p.code}:${p.files.length}`).join(', '));
if (has('dry')) { console.log('--dry: выходим, ничего не трогаем'); process.exit(0); }

// ---- подключаемся --------------------------------------------------------
const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap(c => c.pages()).find(p => /devconsole/.test(p.url()));
if (!page) { console.error('вкладка devconsole не найдена — открой Store listing'); process.exit(1); }
console.log('вкладка: ' + page.url().slice(0, 95));

page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[CWS-Autofill]')) console.log('   ' + t.replace('[CWS-Autofill] ', ''));
});
// confirm() в режиме «заменить» блокирует evaluate — подтверждаем автоматически,
// подтверждение уже дано запуском этого скрипта.
page.on('dialog', async (d) => { console.log('   [dialog] ' + d.message().slice(0, 80).replace(/\n/g, ' ') + ' → OK'); await d.accept(); });

// ---- инжектим панель -----------------------------------------------------
const snippet = readFileSync('docs/setDescription.js', 'utf8');
await page.evaluate(s => {
  document.getElementById('cws-autofill-panel')?.remove();
  // Trusted Types запрещает eval через <script>; Function-конструктор проходит.
  new Function(s)();
}, snippet);
const up = await page.evaluate(() => !!document.getElementById('cws-autofill-panel'));
if (!up) { console.error('панель не поднялась'); process.exit(1); }
console.log('панель: ok');

await page.selectOption('#cws-section', SECTION);
await page.evaluate(r => { document.getElementById('cws-replace').checked = r; }, REPLACE);

// ---- прогон по локалям ---------------------------------------------------
const t0 = Date.now();
const summary = [];
for (const [i, p] of plan.entries()) {
  console.log(`\n[${i + 1}/${plan.length}] ${p.code}  (${p.files.length} файлов)`);
  // Панель группирует по имени файла «код_номер», поэтому кладём файлы
  // по одной локали за раз в плоский пикер — так порядок и язык однозначны.
  // Пикер папки чистим в самой странице: Playwright не даёт передать []
  // в input с webkitdirectory.
  await page.evaluate(() => { const d = document.getElementById('cws-dirfiles'); if (d) d.files = new DataTransfer().files; });
  await page.setInputFiles('#cws-files', p.files);
  await page.evaluate((code) => {
    // подменяем name→«код_N», чтобы groupFilesByLang отнёс файлы к нужному языку
    const inp = document.getElementById('cws-files');
    const dt = new DataTransfer();
    [...inp.files].forEach((f, n) => dt.items.add(new File([f], `${code}_${n + 1}.png`, { type: f.type })));
    inp.files = dt.files;
  }, p.code);

  await page.click('#cws-shot');
  await page.waitForFunction(() => {
    const l = document.getElementById('cws-log');
    return l && /———— ИТОГ ————/.test(l.innerText);
  }, null, { timeout: 15 * 60 * 1000 }).catch(() => console.log('   ⚠ таймаут ожидания ИТОГа'));

  const res = await page.evaluate(() => {
    const txt = document.getElementById('cws-log').innerText;
    const tail = txt.slice(txt.lastIndexOf('———— ИТОГ ————'));
    // первая строка после заголовка — «код: got/want [← причина]»
    return (tail.split('\n')[1] || '').trim();
  });

  // Независимая проверка: панель считает плитки, а порядок подтверждаем
  // по пикселям — дашборд подписывает превью позиционно, по подписям не сверить.
  let ord = { ok: false, note: 'не проверялся' };
  try { ord = await verifyOrder(page, SECTION, p.files); }
  catch (e) { ord = { ok: false, note: 'сбой проверки: ' + e.message.slice(0, 60) }; }

  const bad = /←/.test(res) || !ord.ok;
  console.log(`   → ${res}   ${ord.note}${bad ? '   ✗' : ''}`);
  summary.push({ code: p.code, line: res, ord: ord.note, bad });
  await page.evaluate(() => { document.getElementById('cws-log').textContent = ''; });
}

console.log(`\n════════ СВОДКА (${Math.round((Date.now() - t0) / 1000)}с) ════════`);
for (const s of summary) console.log(`  ${s.bad ? '✗' : '✓'} ${s.line}   ${s.ord}`);
const broken = summary.filter(s => s.bad);
console.log(broken.length
  ? `\n✗ ПРОБЛЕМНЫЕ (${broken.length}): ${broken.map(s => s.code).join(', ')}\n  перезапусти скрипт с --only ${broken.map(s => s.code).join(',')}`
  : `\n✓ все ${summary.length} локалей: количество и порядок подтверждены`);
console.log('\nSave draft НЕ нажат — проверь глазами и сохрани сам.');
await browser.close();
