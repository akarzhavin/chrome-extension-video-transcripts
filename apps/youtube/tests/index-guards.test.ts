/**
 * The two navigation guards on the caption path (§26.2, §27.3).
 *
 * Both are decisions with a side that matters more than the one anybody thinks
 * to test. The stale-result guard is there to drop a late reply — but dropping
 * too eagerly loses a legitimate track, silently. The shorts guard is there to
 * defer a search — but its other half is that watch pages always search, panel
 * open or closed, which is the case every ordinary viewer is in.
 *
 * They lived inside index.ts, which runs bootstrap() at import; the preceding
 * commit made them importable without moving any behaviour.
 */
import { decideCaptionSearch, isStaleResult, shouldDeferSearch } from '../src/content/nav-guards';

describe('a track for a video already left is discarded', () => {
    // §26.2, T5.21. Results arrive asynchronously. One issued for the video the
    // user was on can land after they moved to the next, and adding its track
    // then puts another video's subtitles into the panel — the same words over
    // the wrong film.
    test('a result naming the video the user left is stale', () => {
        expect(isStaleResult('vid1', 'vid2')).toBe(true);
    });

    test('a result naming the video the user is on is not', () => {
        expect(isStaleResult('vid2', 'vid2')).toBe(false);
    });

    // The three ways the comparison cannot be made. Each of them dropping the
    // result is a track going missing with nothing said about it, so each is
    // named rather than left to a single "handles missing ids" check.
    test('a result carrying no video id is kept — older page-script replies do', () => {
        expect(isStaleResult(undefined, 'vid2')).toBe(false);
    });

    test('a result arriving while the current video is unknown is kept', () => {
        expect(isStaleResult('vid1', null)).toBe(false);
    });

    test('neither side known is kept', () => {
        expect(isStaleResult(undefined, null)).toBe(false);
    });

    // An empty string is what a URL with `?v=` and nothing after it yields.
    // Treating it as a name would make every result on such a page stale.
    test('an empty id is not a name to compare against', () => {
        expect(isStaleResult('', 'vid2')).toBe(false);
        expect(isStaleResult('vid1', '')).toBe(false);
    });
});

describe('watch pages always search, even with the panel closed', () => {
    // §27.3, T5.22 — the counter-half of the shorts deferral (T0.2). Dropping
    // the isShortsPage() term makes every viewer who watches with the panel
    // collapsed get no subtitles at all, and the panel says "no subtitles
    // available" for a video whose captions are fine.
    test('a watch page with the panel collapsed still searches', () => {
        expect(shouldDeferSearch(false, true)).toBe(false);
    });

    test('a watch page with the panel open searches', () => {
        expect(shouldDeferSearch(false, false)).toBe(false);
    });

    // The half that already had a check, restated here so the pair reads as
    // one table: only a short with nobody looking defers.
    test('a short with the panel collapsed defers', () => {
        expect(shouldDeferSearch(true, true)).toBe(true);
    });

    test('a short with the panel open searches — the user is looking at it', () => {
        expect(shouldDeferSearch(true, false)).toBe(false);
    });
});

describe('no subtitle search is planned before a language pair is chosen', () => {
    // §1.7, T5.14's second half. Until the pair is stored the panel raises the
    // first-run picker and nothing is fetched. The chip half of the claim is
    // pinned in app-base-status.test.ts; this is the planner half — the
    // decision the caption path takes before anything is planned. The four
    // combinations are listed rather than one, because the picker has to win
    // over the shorts deferral too: a deferred search would later run against
    // a pair that does not exist.
    test.each([
        [false, false],
        [false, true],
        [true, false],
        [true, true],
    ])('with no pair (shorts=%s, collapsed=%s) the answer is setup — never a load, never a deferral', (isShorts, collapsed) => {
        expect(decideCaptionSearch(false, isShorts, collapsed)).toBe('setup');
    });

    test('with a pair, the shorts decision stands exactly as before', () => {
        expect(decideCaptionSearch(true, false, false)).toBe('load');
        expect(decideCaptionSearch(true, false, true)).toBe('load');
        expect(decideCaptionSearch(true, true, false)).toBe('load');
        expect(decideCaptionSearch(true, true, true)).toBe('defer');
    });
});
