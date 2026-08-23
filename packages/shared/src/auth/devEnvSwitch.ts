/**
 * Dev-only runtime switch between the prod and preprod backends.
 *
 * Every export here is guarded by `__EXT_ENV__ !== 'dev'`, which Vite replaces
 * with a literal BEFORE minification — so in a prod build the guards fold to
 * `true`, the bodies become unreachable, and the whole environment table is
 * dropped from the bundle. Verified in packages/shared/docs/dev-flags.md.
 *
 * The guard style matters. `isDev` from ./config is computed at runtime
 * (`config.env === 'dev'`), so a minifier cannot prove it constant and keeps
 * the code — that is why this file tests `__EXT_ENV__` directly and never
 * imports `isDev`.
 *
 * What this CAN switch: Firestore, Identity Toolkit, and the frontend URL, all
 * of which are read off `config` at call time.
 *
 * What it CANNOT switch: manifest.json. `externally_connectable` and
 * `host_permissions` are static, and they decide whether a page is allowed to
 * talk to the extension at all. Setting EXT_ALT_FRONTEND_BASE_URL at build time
 * writes the second origin into the manifest, which is what lets a sign-in
 * complete on the other side; without it the data plane switches but the auth
 * handoff silently never connects.
 */
import { config } from './config';
import { clearAuthState } from './storage';

/**
 * Which of the two build-supplied targets is live — deliberately NOT named
 * after any environment. The repo does not get to know what they are called.
 */
export type ExtEnvName = 'home' | 'away';

const STORAGE_KEY = 'dev.targetEnv';

interface EnvTarget {
    projectId: string;
    apiKey: string;
    frontendBaseUrl: string;
}

/**
 * The two targets, supplied at BUILD time — never written down here.
 *
 * No environment's project id, key, or host belongs in this repository. The
 * "away" target comes from EXT_ALT_* env vars (see vite.config.ts); the "home"
 * target is whatever the build was already compiled against, read off `config`.
 * A build given no EXT_ALT_* values simply has nothing to switch to, and the
 * badge stays inert — which is the correct outcome for a checkout that was
 * handed no credentials.
 *
 * The project and its key must move together: preprod's
 * /auth/extension-token mints a custom token signed by ITS project, and
 * Firebase refuses to exchange it using another project's key.
 */
// The build's own target, and the one it can switch to. Both are labelled
// 'home'/'away' rather than 'prod'/'preprod' precisely so no environment name
// has to be matched against a hardcoded project id.
const HOME: EnvTarget = {
    projectId: config.projectId,
    apiKey: config.apiKey,
    frontendBaseUrl: config.frontendBaseUrl,
};

const AWAY: EnvTarget | null =
    __EXT_ALT_PROJECT_ID__ && __EXT_ALT_API_KEY__ && __EXT_ALT_FRONTEND_BASE_URL__
        ? {
            projectId: __EXT_ALT_PROJECT_ID__,
            apiKey: __EXT_ALT_API_KEY__,
            frontendBaseUrl: __EXT_ALT_FRONTEND_BASE_URL__,
        }
        : null;

/** Whether this build was given a second target to switch to. */
export function canSwitch(): boolean {
    return __EXT_ENV__ === 'dev' && AWAY !== null;
}

/**
 * A short label for a target, for the badge. Derived from the project id the
 * build was given rather than matched against a list: a checkout must not need
 * to know what any environment is called.
 */
function labelFor(t: EnvTarget): string {
    return t.projectId.replace(/^lingogram-/, '') || t.projectId;
}

/**
 * Whether the live target is production — i.e. real users' data.
 *
 * Derived from the project the build was handed, NOT from which side it sits
 * on. Either side can be prod depending on how the build was configured, and
 * the warning colour has to follow the data, not the slot. Anything that is
 * not exactly the production project counts as safe.
 */
export function isLiveProd(): boolean {
    const live = currentSide() === 'away' && AWAY ? AWAY : HOME;
    return live.projectId === 'lingogram-prod';
}

/** Which side is live right now. */
export function currentSide(): ExtEnvName {
    if (__EXT_ENV__ !== 'dev') return 'home';
    return AWAY && config.projectId === AWAY.projectId ? 'away' : 'home';
}

/** The label to show for whatever is live right now. */
export function currentLabel(): string {
    if (__EXT_ENV__ !== 'dev') return labelFor(HOME);
    return labelFor(currentSide() === 'away' && AWAY ? AWAY : HOME);
}

/**
 * Every frontend this build can legitimately be handed an auth token by: the
 * side it is on, plus the side it can switch to.
 *
 * The sign-in handoff arrives from whichever frontend the user opened, which is
 * not necessarily the side the worker is currently pointed at — they open the
 * preprod site, and the token arrives before anyone touches the badge. Both
 * sides are build-supplied and equally trusted, so both are accepted; a prod
 * build has no AWAY and this collapses to the single origin it always was.
 */
export function switchableFrontendBaseUrls(): string[] {
    if (__EXT_ENV__ !== 'dev' || !AWAY) return [HOME.frontendBaseUrl];
    return [HOME.frontendBaseUrl, AWAY.frontendBaseUrl];
}

/**
 * Point `config` at one side. Mutates in place: every consumer reads `config.x`
 * at call time rather than caching it at import, so the change takes effect on
 * the next request with no reload.
 */
export function applySide(side: ExtEnvName): void {
    if (__EXT_ENV__ !== 'dev') return;
    const t = side === 'away' ? AWAY : HOME;
    if (!t) return;
    config.projectId = t.projectId;
    config.apiKey = t.apiKey;
    config.frontendBaseUrl = t.frontendBaseUrl;
}

/**
 * Restore the last chosen side. Called at service-worker startup, so a switch
 * survives the worker being torn down and respawned (which Chrome does
 * aggressively and invisibly).
 */
export async function restoreEnv(): Promise<void> {
    if (__EXT_ENV__ !== 'dev') return;
    const v = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
    if (v[STORAGE_KEY] === 'away') applySide('away');
}

/**
 * Switch sides and forget the current session.
 *
 * Clearing auth is not optional: a uid and an ID token are only meaningful
 * inside the project that issued them. Carrying a session across would either
 * fail confusingly or, worse, write words under a uid that means something
 * different on the other side.
 */
export async function switchEnv(side: ExtEnvName): Promise<void> {
    if (__EXT_ENV__ !== 'dev') return;
    if (side === 'away' && !AWAY) return;
    applySide(side);
    await chrome.storage.local.set({ [STORAGE_KEY]: side });
    await clearAuthState();
}

/**
 * Dispatch the dev-only actions. Lives here rather than in background.ts's
 * switch so the action names themselves never reach a prod bundle — a dead
 * `case 'DEV_SET_ENV'` would survive minification and advertise the mechanism.
 *
 * Returns null for anything it does not handle, so the caller can fall through
 * to its normal unknown-action error.
 */
export async function handleDevAction(
    request: { action: string; [k: string]: unknown },
): Promise<{ result: unknown } | null> {
    if (__EXT_ENV__ !== 'dev') return null;
    switch (request.action) {
        case 'DEV_GET_ENV':
            return {
                result: {
                    side: currentSide(),
                    label: currentLabel(),
                    canSwitch: canSwitch(),
                    isProd: isLiveProd(),
                    projectId: config.projectId,
                },
            };
        case 'DEV_SET_ENV': {
            const side: ExtEnvName = request.side === 'away' ? 'away' : 'home';
            await switchEnv(side);
            return {
                result: {
                    ok: true,
                    side: currentSide(),
                    label: currentLabel(),
                    canSwitch: canSwitch(),
                    isProd: isLiveProd(),
                    projectId: config.projectId,
                },
            };
        }
        default:
            return null;
    }
}
