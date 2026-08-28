// List every promo pipeline: version, what it makes, and what it needs.
//
//   node pipelines/index.mjs
//
// Reads each pipelines/<name>@<v>/manifest.json. Pipelines are self-contained,
// so this only reports — it never renders and nothing here is imported by a
// pipeline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMO_ROOT = path.dirname(HERE);

const dirs = fs.readdirSync(HERE, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(HERE, e.name, 'manifest.json')))
  .map((e) => e.name)
  .sort();

for (const dir of dirs) {
  const m = JSON.parse(fs.readFileSync(path.join(HERE, dir, 'manifest.json'), 'utf8'));
  const built = fs.existsSync(path.join(PROMO_ROOT, m.outputs.dir));
  console.log(`\n${dir}  v${m.version}${m.status ? '  [' + m.status.split(' —')[0] + ']' : ''}`);
  console.log(`  ${m.title}`);
  console.log(`  run:    ${m.run}`);
  console.log(`  writes: ${m.outputs.dir}${built ? '' : '  (not built yet)'}`);
  const caps = m.inputs?.captures;
  if (caps) {
    const missing = caps.files.filter((f) =>
      !f.includes('<') && !fs.existsSync(path.join(path.resolve(HERE, dir, caps.dir), f)));
    if (missing.length) console.log(`  MISSING ${missing.length} capture(s): ${missing.join(', ')}`);
  }
  for (const issue of m.knownIssues ?? []) {
    console.log(`  ! ${issue.split('. ')[0]}.`);
  }
}
console.log();
