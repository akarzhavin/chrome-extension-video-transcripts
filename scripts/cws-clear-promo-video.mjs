#!/usr/bin/env node
/**
 * Гоняет секцию «Промо-видео» из docs/setDescription.js через CDP.
 *
 *   node scripts/cws-clear-promo-video.mjs            # только показать, где заполнено
 *   node scripts/cws-clear-promo-video.mjs --clear    # очистить во всех языках
 *   node scripts/cws-clear-promo-video.mjs --clear --section "Global promo video"
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const CLEAR = argv.includes('--clear');
const SECTION = arg('section', 'Localised promo video');
const CDP = arg('cdp', 'http://127.0.0.1:9333');

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap(c => c.pages()).find(p => /devconsole/.test(p.url()));
if (!page) { console.error('вкладка devconsole не найдена — открой Store listing'); process.exit(1); }
console.log('вкладка: ' + page.url().slice(0, 95));
console.log(`секция: ${SECTION} · режим: ${CLEAR ? 'ОЧИСТИТЬ' : 'только показать'}`);

page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[CWS-Autofill]')) console.log('   ' + t.replace('[CWS-Autofill] ', ''));
});
page.on('dialog', async (d) => { console.log('   [dialog] → OK'); await d.accept(); });

await page.evaluate(s => {
  document.getElementById('cws-autofill-panel')?.remove();
  new Function(s)();
}, readFileSync('docs/setDescription.js', 'utf8'));
if (!await page.evaluate(() => !!document.getElementById('cws-autofill-panel'))) {
  console.error('панель не поднялась'); process.exit(1);
}
await page.selectOption('#cws-vidsection', SECTION);

await page.click(CLEAR ? '#cws-viddel' : '#cws-vidscan');
await page.waitForFunction(() => {
  const l = document.getElementById('cws-log');
  // «: пусто» / «: https://…» — исход одиночной проверки Global-поля; без него
  // раннер ждал таймаут на уже завершённой работе.
  return l && /(Готово ✔|Нигде не заполнено|Заполнено в |уже пусто|Есть ошибки|Очищено:|»: пусто|»: http|Поле «)/.test(l.innerText);
}, null, { timeout: 30 * 60 * 1000 }).catch(() => console.log('   ⚠ таймаут'));

await browser.close();
