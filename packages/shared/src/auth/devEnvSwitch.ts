/**
 * Dev-only runtime switch between the backends a build was compiled against.
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
 * What this CAN switch: the whole `config` row — project, key, the three
 * Firebase hosts, the frontend URL and the lookup gateway. Hosts are in the
 * row because the local emulator suite differs from the cloud by host alone:
 * an earlier version retargeted only the project and could therefore never
 * reach a cloud project from a build booted against the emulators.
 *
 * What it CANNOT switch: manifest.json. `externally_connectable` and
 * `host_permissions` are static, and they decide whether a page is allowed to
 * talk to the extension at all. Every frontend origin a build might switch to
 * has to be named at BUILD time (see EXT_DEV_TARGETS in vite.config.ts), or
 * the data plane switches but the auth handoff silently never connects.
 */
import { clearLookupCache } from '../lookup';
import { config } from './config';
import { parkAuthState, unparkAuthState } from './storage';

/**
 * A target's name is whatever the build called it — deliberately NOT a fixed
 * union. The repo does not get to know what any environment is called, so it
 * cannot hardcode 'preprod' or match against a list of them.
 */
export type ExtEnvName = string;

const STORAGE_KEY = 'dev.targetEnv';

export interface EnvTarget {
    /** The build-supplied label. Also the stored value and the badge text. */
    name: string;
    projectId: string;
    apiKey: string;
    /**
     * The three Firebase hosts. They travel WITH the project: the emulator
     * suite and the cloud differ by host, so a row that omits them can only
     * ever switch between two cloud projects.
     */
    identityToolkitUrl: string;
    secureTokenUrl: string;
    firestoreUrl: string;
    frontendBaseUrl: string;
    /**
     * The lookup API moves with the environment: switching Firebase to preprod
     * while lookups keep hitting prod is exactly the class of bug this file's
     * header warns about. Empty when that side has no API configured.
     */
    apiBaseUrl: string;
}

/**
 * The build's own target — whatever it was compiled against, read off
 * `config`. Named by the build so it can appear in the ring like any other.
 *
 * Behind the `__EXT_ENV__` literal, so a prod build drops it entirely. Without
 * that guard the object is reachable from the prod branches of currentSide()
 * and switchableFrontendBaseUrls(), and the minifier — correctly — keeps it:
 * measured as a live 8-field table in a production background bundle, with a
 * second `apiKey:` next to the one config.ts already ships. Those two
 * functions therefore read `config` directly rather than HOME.
 */
const HOME: EnvTarget = __EXT_ENV__ !== 'dev' ? (null as unknown as EnvTarget) : {
    name: __EXT_HOME_TARGET_NAME__ || labelFromProjectId(config.projectId),
    projectId: config.projectId,
    apiKey: config.apiKey,
    identityToolkitUrl: config.identityToolkitUrl,
    secureTokenUrl: config.secureTokenUrl,
    firestoreUrl: config.firestoreUrl,
    frontendBaseUrl: config.frontendBaseUrl,
    apiBaseUrl: config.apiBaseUrl,
};

/**
 * Derive a short label from a project id, for a build that named no target.
 * Kept as a function rather than a table so no environment name is written
 * down here.
 */
function labelFromProjectId(projectId: string): string {
    return projectId.replace(/^lingogram-/, '') || projectId;
}

/**
 * Every target this build can reach, in ring order, HOME first.
 *
 * Supplied at BUILD time through EXT_DEV_TARGETS — never written down here.
 * No environment's project id, key, or host belongs in this repository. A
 * build given no targets has a ring of one and the badge stays inert, which
 * is the correct outcome for a checkout that was handed no credentials.
 *
 * A malformed define must not take the extension down: `__EXT_DEV_TARGETS__`
 * is parsed defensively, and anything unusable degrades to the single HOME
 * row rather than throwing during module evaluation — in a service worker
 * that would register no listeners at all.
 */
const TARGETS: EnvTarget[] = buildRing();

function buildRing(): EnvTarget[] {
    if (__EXT_ENV__ !== 'dev') return [HOME];
    let parsed: unknown;
    try {
        parsed = __EXT_DEV_TARGETS__ ? JSON.parse(__EXT_DEV_TARGETS__) : null;
    } catch {
        return [HOME];
    }
    if (!Array.isArray(parsed)) return [HOME];

    const ring: EnvTarget[] = [HOME];
    for (const raw of parsed) {
        const t = raw as Partial<EnvTarget>;
        // A row missing any of these cannot complete a sign-in: the project
        // and its key must move together (preprod's /auth/extension-token
        // mints a token signed by ITS project, which Firebase refuses to
        // exchange with another project's key), and without the frontend URL
        // there is no origin the handoff could arrive from.
        if (!t?.projectId || !t.apiKey || !t.frontendBaseUrl) continue;
        const name = t.name || labelFromProjectId(t.projectId);
        // The build's own target may also appear in the list; keep one row.
        if (ring.some((r) => r.name === name)) continue;
        ring.push({
            name,
            projectId: t.projectId,
            apiKey: t.apiKey,
            // Hosts default to HOME's when a row omits them, which is what a
            // second CLOUD target wants: same Google endpoints, other project.
            identityToolkitUrl: t.identityToolkitUrl || HOME.identityToolkitUrl,
            secureTokenUrl: t.secureTokenUrl || HOME.secureTokenUrl,
            firestoreUrl: t.firestoreUrl || HOME.firestoreUrl,
            frontendBaseUrl: t.frontendBaseUrl,
            apiBaseUrl: t.apiBaseUrl ?? '',
        });
    }
    return ring;
}

/** Whether this build has anywhere to switch to. */
export function canSwitch(): boolean {
    return __EXT_ENV__ === 'dev' && TARGETS.length > 1;
}

/** Every target this build can reach, in ring order. */
export function targetNames(): string[] {
    if (__EXT_ENV__ !== 'dev') return [currentSide()];
    return TARGETS.map((t) => t.name);
}

/**
 * Whether the live target is production — i.e. real users' data.
 *
 * Derived from the project the build was handed, NOT from a target's name or
 * its position in the ring. A build is free to call its targets anything, and
 * the warning colour has to follow the data. Anything that is not exactly the
 * production project counts as safe.
 */
export function isLiveProd(): boolean {
    return config.projectId === 'lingogram-prod';
}

/** Which target is live right now. */
export function currentSide(): ExtEnvName {
    // `config`, not HOME: see the note on HOME. A prod build folds to the
    // label alone and needs no target table to answer this.
    if (__EXT_ENV__ !== 'dev') {
        return __EXT_HOME_TARGET_NAME__ || labelFromProjectId(config.projectId);
    }
    const live = TARGETS.find((t) => t.projectId === config.projectId);
    return (live ?? HOME).name;
}

/** The label to show for whatever is live right now. */
export function currentLabel(): string {
    return currentSide();
}

/** The target that follows the live one, wrapping around. */
export function nextSide(): ExtEnvName {
    if (__EXT_ENV__ !== 'dev') return currentSide();
    const i = TARGETS.findIndex((t) => t.name === currentSide());
    return TARGETS[(Math.max(i, 0) + 1) % TARGETS.length].name;
}

/**
 * Every frontend this build can legitimately be handed an auth token by.
 *
 * The sign-in handoff arrives from whichever frontend the user opened, which is
 * not necessarily the target the worker is currently pointed at — they open the
 * preprod site, and the token arrives before anyone touches the badge. Every
 * target is build-supplied and equally trusted, so all are accepted; a prod
 * build has a ring of one and this collapses to the single origin it always was.
 */
export function switchableFrontendBaseUrls(): string[] {
    // `config`, not HOME: see the note on HOME.
    if (__EXT_ENV__ !== 'dev') return [config.frontendBaseUrl];
    return [...new Set(TARGETS.map((t) => t.frontendBaseUrl))];
}

/**
 * Point `config` at one target. Mutates in place: every consumer reads
 * `config.x` at call time rather than caching it at import, so the change
 * takes effect on the next request with no reload.
 */
export function applySide(side: ExtEnvName): void {
    if (__EXT_ENV__ !== 'dev') return;
    const t = TARGETS.find((x) => x.name === side);
    if (!t) return;
    config.projectId = t.projectId;
    config.apiKey = t.apiKey;
    config.identityToolkitUrl = t.identityToolkitUrl;
    config.secureTokenUrl = t.secureTokenUrl;
    config.firestoreUrl = t.firestoreUrl;
    config.frontendBaseUrl = t.frontendBaseUrl;
    config.apiBaseUrl = t.apiBaseUrl;
}

/**
 * Restore the last chosen target. Called at service-worker startup, so a
 * switch survives the worker being torn down and respawned (which Chrome does
 * aggressively and invisibly).
 */
export async function restoreEnv(): Promise<void> {
    if (__EXT_ENV__ !== 'dev') return;
    const v = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
    const stored = v[STORAGE_KEY];
    if (typeof stored === 'string') applySide(stored);
}

/**
 * Switch targets, parking the session you are leaving and restoring the one
 * belonging to the target you are entering.
 *
 * The live session cannot come along: a uid and an ID token are only
 * meaningful inside the project that issued them, and carrying one across
 * would either fail confusingly or, worse, write words under a uid that means
 * a different person on the other side. But it does not have to be DESTROYED
 * for that to hold — each project's session is set aside under its own key and
 * handed back on return, so a lap of the ring costs no sign-ins at all.
 *
 * Order matters: park BEFORE applySide. Parking keys on the live project id,
 * so retargeting `config` first would file the outgoing session under the
 * INCOMING project's name — handing one environment's credentials to another.
 *
 * The lookup cache is dropped outright rather than parked: it is keyed by term
 * and language but not by backend, so answers fetched from one side would be
 * served after the switch — and switching sides is usually how you check a
 * dictionary change reached the other one. It costs a refetch, not a sign-in.
 */
export async function switchEnv(side: ExtEnvName): Promise<void> {
    if (__EXT_ENV__ !== 'dev') return;
    const target = TARGETS.find((t) => t.name === side);
    if (!target) return;
    await parkAuthState(config.projectId);
    applySide(side);
    await chrome.storage.local.set({ [STORAGE_KEY]: side });
    clearLookupCache();
    // Nothing parked for this project — clearAuthState already ran inside
    // parkAuthState, so the worker is correctly signed out and the badge will
    // ask for a sign-in here.
    await unparkAuthState(target.projectId);
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
    const state = () => ({
        side: currentSide(),
        label: currentLabel(),
        canSwitch: canSwitch(),
        isProd: isLiveProd(),
        projectId: config.projectId,
        targets: targetNames(),
        next: nextSide(),
    });
    switch (request.action) {
        case 'DEV_GET_ENV':
            return { result: state() };
        case 'DEV_SET_ENV': {
            // No side named: advance the ring. That is what the badge sends,
            // so the click does not have to know the order.
            const side = typeof request.side === 'string' ? request.side : nextSide();
            await switchEnv(side);
            return { result: { ok: true, ...state() } };
        }
        default:
            return null;
    }
}
