/**
 * The two navigation guards on the YouTube caption path, as functions.
 *
 * Both used to be `if` conditions inside `index.ts`, which runs `bootstrap()`
 * at import: reaching them from a test meant standing up a whole player page,
 * so neither was ever asserted directly. They are decisions — "is this result
 * still wanted", "is this page worth spending requests on" — and a decision
 * with two sides is exactly the thing that should be callable.
 *
 * Nothing here reads the DOM or the location: the callers already hold what
 * these need, and taking it as arguments is what makes them answerable.
 */

/**
 * Whether a caption result should be dropped as stale.
 *
 * Results arrive asynchronously, so one issued for the video the user was on
 * can land after they have already moved to the next. Adding its track then
 * puts another video's subtitles into the panel — the same words, the wrong
 * film.
 *
 * Only a result that NAMES a video and disagrees with a KNOWN current one is
 * stale. Either side missing means we cannot tell, and dropping on an unknown
 * is how a legitimate track goes missing: a result carrying no videoId (older
 * page-script replies) or one arriving while the URL is mid-navigation would
 * both be discarded.
 */
export function isStaleResult(
    resultVideoId: string | undefined,
    currentVideoId: string | null,
): boolean {
    return !!resultVideoId && !!currentVideoId && resultVideoId !== currentVideoId;
}

/**
 * Whether to defer the caption search instead of running it now.
 *
 * True only for a short whose panel is closed. The feed is scrolled fast, and
 * every short would spend its own requests on subtitles nobody is looking at —
 * on a surface where translation is throttled per IP, those requests are what
 * makes the throttle arrive sooner for the videos the user DOES open.
 *
 * Both terms are load-bearing, in opposite directions. A watch page always
 * searches, panel open or closed: watch pages are opened one at a time and
 * deliberately, and dropping the shorts term would silence the panel on the
 * ordinary case. A short with the panel OPEN searches too: the user is looking
 * at it.
 */
export function shouldDeferSearch(isShorts: boolean, sidebarCollapsed: boolean): boolean {
    return isShorts && sidebarCollapsed;
}
