/**
 * The diagnostics recorder's actions belong to every site the recorder covers.
 *
 * This file exists because of a shipped bug with a very quiet shape. The
 * actions were implemented on YouTubeVttApp, while bootstrap() calls
 * installDebugMode(app) for WHATEVER app it built — so a Netflix session
 * recorded exactly as usual, the settings panel showed the "Record subtitle
 * diagnostics" switch, and the three rows that switch implies never appeared.
 * Nothing failed; a feature was simply half-present on one of two sites.
 *
 * The test is a source-level one on purpose. Constructing either app pulls in
 * the whole content script (players, observers, chrome.*), and what went wrong
 * was not behaviour but PLACEMENT — the method sitting on a subclass instead
 * of the base both subclasses share. That is exactly what source can answer
 * and a mock cannot.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string =>
    readFileSync(join(__dirname, '..', 'src', 'content', rel), 'utf8');

describe('traceActions lives where both sites inherit it', () => {
    test('it is defined on the shared base class', () => {
        expect(read('app-base.ts')).toMatch(/^\s{4}traceActions\(\)/m);
    });

    test('neither site class redefines it', () => {
        // A subclass override would silently win for that site and could drift
        // from the base — the same class of bug, one layer down.
        expect(read('index.ts')).not.toMatch(/^\s{4}traceActions\(\)/m);
        expect(read('netflix/app.ts')).not.toMatch(/^\s{4}traceActions\(\)/m);
    });

    test('both site apps extend that base', () => {
        // The inheritance the first two tests depend on. Stated explicitly so a
        // future class that stops extending BaseVttApp fails here rather than
        // silently losing the rows again.
        expect(read('index.ts')).toMatch(/class YouTubeVttApp extends BaseVttApp/);
        expect(read('netflix/app.ts')).toMatch(/class NetflixVttApp extends BaseVttApp/);
    });

    test('the recorder is installed for whatever app bootstrap built', () => {
        // The fact that makes this a Netflix feature at all: one call, outside
        // the per-site branch. If it ever moves inside the YouTube branch, the
        // base-class placement above stops being enough.
        const src = read('index.ts');
        const bootstrapBody = src.slice(src.indexOf('function bootstrap()'));
        const call = bootstrapBody.indexOf('installDebugMode(app)');
        const youtubeBranch = bootstrapBody.indexOf('} else if (isYouTube()) {');
        expect(call).toBeGreaterThan(-1);
        // After the whole if/else chain, not inside a site branch.
        expect(call).toBeGreaterThan(youtubeBranch);
        expect(bootstrapBody.slice(youtubeBranch, call)).toContain('}');
    });
});
