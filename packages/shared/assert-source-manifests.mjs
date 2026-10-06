#!/usr/bin/env node
/**
 * Before a build: the source manifests must not carry a real `key`.
 *
 * A key sets the extension's id. The dev builds get theirs from
 * vite-sibling-ids.mjs, added only when isDev; a release must carry none
 * (assert-shippable.mjs refuses one after the build). This is the earlier half
 * of that rule: a key written into apps/<edition>/manifest.json would flow into
 * every build, and catching it here costs nothing while catching it after the
 * build costs a build.
 *
 * Allowed: no `key`, or the REPLACE_WITH_ placeholder the build strips.
 *
 * Usage: node assert-source-manifests.mjs <edition>...
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apps = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps');
const editions = process.argv.slice(2);
if (!editions.length) {
    console.error('assert-source-manifests: name at least one edition');
    process.exit(2);
}

let bad = 0;
for (const edition of editions) {
    const path = join(apps, edition, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        console.error(`  ${edition}: ${path} is missing or unreadable`);
        bad = 1;
        continue;
    }
    const key = manifest.key;
    if (key === undefined || (typeof key === 'string' && key.startsWith('REPLACE_WITH_'))) continue;
    console.error(
        `  ${edition}: apps/${edition}/manifest.json carries a real \`key\`. ` +
        'Only a dev build may have one, and it is added by the build (vite-sibling-ids.mjs).',
    );
    bad = 1;
}
process.exit(bad);
