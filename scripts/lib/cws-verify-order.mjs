/**
 * Независимая проверка порядка загруженных превью.
 *
 * Дашборд подписывает превью позиционно («Screenshot 1..4»), а не именем файла,
 * поэтому сверить порядок по подписям невозможно — подпись лишь повторяет номер
 * слота. Пиксели прочитать изнутри страницы тоже нельзя: превью лежат на
 * googleusercontent, canvas от них «портится» (tainted) и getImageData падает.
 *
 * Обходим снаружи: CDP снимает element screenshot каждой плитки (песочница
 * страницы на скриншоты не распространяется), затем сравниваем перцептивные
 * отпечатки с исходными файлами. Так порядок подтверждается по содержимому.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PY = `
import sys, json, warnings
warnings.filterwarnings('ignore')
from PIL import Image
def sig(p):
    im = Image.open(p).convert('L').resize((16, 16))
    px = list(im.getdata()) if not hasattr(im, 'get_flattened_data') else list(im.get_flattened_data()); avg = sum(px) / len(px)
    return [1 if v > avg else 0 for v in px]
def dist(a, b): return sum(x != y for x, y in zip(a, b))
dash, src = json.load(sys.stdin)
D = [sig(p) for p in dash]; S = [sig(p) for p in src]
out = []
for i, d in enumerate(D):
    row = [dist(d, s) for s in S]
    best = min(range(len(row)), key=lambda j: row[j])
    out.append({"tile": i, "match": best, "d": row[best], "runnerUp": sorted(row)[1] if len(row) > 1 else 999})
print(json.dumps(out))
`;

/** @returns {{ok: boolean, note: string}} */
export async function verifyOrder(page, sectionKeyword, sourceFiles) {
  const tmp = mkdtempSync(join(tmpdir(), 'cws-verify-'));
  try {
    const n = await page.evaluate((sec) => {
      const re = new RegExp(sec, 'i');
      // Тот же путь, что и в панели: сначала ищем input ИМЕННО этой секции
      // (перебор всех input-ов подряд цепляет соседние секции — контейнер
      // «Graphic assets» содержит и иконку, и промо-плитки), затем от него
      // поднимаемся до ближайшего предка с подписью секции.
      let input = null;
      for (const f of document.querySelectorAll('input[type=file]')) {
        let n = f, h = 0;
        while (n && h < 16) {
          const t = (n.innerText || n.textContent || '').replace(/\s+/g, ' ');
          if (re.test(t) && t.length < 400) { input = f; break; }
          n = n.parentElement; h++;
        }
        if (input) break;
      }
      if (!input) return 0;
      let root = null, n2 = input.parentElement;
      for (let h = 0; n2 && h < 16; h++, n2 = n2.parentElement) {
        const t = (n2.innerText || '').replace(/\s+/g, ' ');
        if (re.test(t) && t.length < 4000) { root = n2; break; }
      }
      if (!root) return 0;
      const btns = [...root.querySelectorAll('[aria-label^="Remove image"]')];
      let k = 0;
      for (const btn of btns) {
        let tile = btn;
        for (let h = 0; h < 8 && tile; h++, tile = tile.parentElement) if (tile.querySelector?.('img')) break;
        const img = tile && tile.querySelector('img');
        // скрытые плитки-заглушки (display:none, data-image-key=undefined) не в счёт
        if (!img || !img.naturalWidth) continue;
        img.setAttribute('data-cws-verify', String(k++));
      }
      return k;
    }, sectionKeyword);

    if (n !== sourceFiles.length)
      return { ok: false, note: `превью ${n}, файлов ${sourceFiles.length}` };

    const shots = [];
    for (let i = 0; i < n; i++) {
      const p = join(tmp, `d${i}.png`);
      await page.locator(`img[data-cws-verify="${i}"]`).screenshot({ path: p, timeout: 15000 });
      shots.push(p);
    }
    const res = JSON.parse(execFileSync('python3', ['-c', PY], {
      input: JSON.stringify([shots, sourceFiles]), encoding: 'utf8',
    }));

    const wrong = res.filter(r => r.match !== r.tile);
    if (wrong.length)
      return { ok: false, note: 'порядок: ' + res.map(r => `#${r.tile + 1}←${r.match + 1}`).join(' ') };
    const weak = res.filter(r => r.runnerUp - r.d < 8);
    if (weak.length)
      return { ok: true, note: 'порядок ✓ (слабый отрыв на ' + weak.length + ' — картинки похожи)' };
    return { ok: true, note: 'порядок ✓ (по пикселям)' };
  } finally {
    await page.evaluate(() => document.querySelectorAll('[data-cws-verify]')
      .forEach(e => e.removeAttribute('data-cws-verify'))).catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
}
