/**
 * The sign-in handoff arrives from whichever frontend the user opened, which is
 * not necessarily the target the service worker is pointed at — the badge is
 * usually untouched at that moment. Every build-supplied target must be
 * accepted.
 */
const HOME_URL = 'https://home.example.com';
const PREPROD_URL = 'https://preprod.example.com';
const PROD_URL = 'https://prod.example.com';

const RING = [
    {
        name: 'preprod',
        projectId: 'project-preprod',
        apiKey: 'key-preprod',
        frontendBaseUrl: PREPROD_URL,
        apiBaseUrl: 'https://api-preprod.example.com',
    },
    {
        name: 'prod',
        projectId: 'lingogram-prod',
        apiKey: 'key-prod',
        frontendBaseUrl: PROD_URL,
        apiBaseUrl: 'https://api-prod.example.com',
    },
];

function setBuild(targets: unknown[], homeName = 'local'): void {
    jest.resetModules();
    (global as any).__EXT_ENV__ = 'dev';
    (global as any).__FRONTEND_BASE_URL__ = HOME_URL;
    (global as any).__FIREBASE_PROJECT_ID__ = 'demo-lingogram';
    (global as any).__FIREBASE_API_KEY__ = 'demo';
    (global as any).__IDENTITY_TOOLKIT_URL__ = 'http://localhost:9099/identitytoolkit.googleapis.com';
    (global as any).__SECURE_TOKEN_URL__ = 'http://localhost:9099/securetoken.googleapis.com';
    (global as any).__FIRESTORE_URL__ = 'http://localhost:8080';
    (global as any).__EXT_API_BASE_URL__ = 'https://api-local.example.com';
    (global as any).__EXT_HOME_TARGET_NAME__ = homeName;
    (global as any).__EXT_DEV_TARGETS__ = targets.length ? JSON.stringify(targets) : '';
}

const load = () => import('../../../packages/shared/src/auth/devEnvSwitch');

describe('handoff origin allowlist spans every switchable target', () => {
    beforeEach(() => setBuild(RING));

    test('all three are offered, and switching does not drop any', async () => {
        const { switchableFrontendBaseUrls, applySide } = await load();
        const all = [HOME_URL, PREPROD_URL, PROD_URL].sort();

        expect(switchableFrontendBaseUrls().sort()).toEqual(all);

        // The bug this pins: a set frozen at startup held only the booted
        // target, so the other frontends' handoffs were refused.
        for (const side of ['preprod', 'prod', 'local']) {
            applySide(side);
            expect(switchableFrontendBaseUrls().sort()).toEqual(all);
        }
    });

    test('a build with no other target offers only its own frontend', async () => {
        setBuild([]);
        const { switchableFrontendBaseUrls, canSwitch } = await load();
        expect(switchableFrontendBaseUrls()).toEqual([HOME_URL]);
        expect(canSwitch()).toBe(false);
    });
});

describe('the ring cycles through every target', () => {
    beforeEach(() => setBuild(RING));

    test('home comes first and the ring wraps back to it', async () => {
        const { targetNames, currentSide, nextSide, applySide } = await load();

        expect(targetNames()).toEqual(['local', 'preprod', 'prod']);
        expect(currentSide()).toBe('local');

        // Three clicks from home must return to home — a ring that does not
        // close leaves a target you can enter but never leave.
        const visited: string[] = [];
        for (let i = 0; i < 3; i++) {
            const next = nextSide();
            applySide(next);
            visited.push(currentSide());
        }
        expect(visited).toEqual(['preprod', 'prod', 'local']);
    });

    test('a target carries its Firebase hosts, not just its project', async () => {
        // The reason the earlier two-slot version could not reach a cloud
        // project from an emulator build: it retargeted projectId/apiKey and
        // left identityToolkitUrl pointing at localhost:9099.
        const { applySide } = await load();
        const { config } = await import('../../../packages/shared/src/auth/config');

        expect(config.firestoreUrl).toBe('http://localhost:8080');

        applySide('prod');
        expect(config.projectId).toBe('lingogram-prod');
        expect(config.apiKey).toBe('key-prod');
        // Rows that name no hosts inherit the build's own — which is what a
        // second CLOUD target wants, and what an emulator-booted build must
        // NOT silently keep when the row does name them.
        expect(config.apiBaseUrl).toBe('https://api-prod.example.com');
    });

    test('an explicit host on a row overrides the build default', async () => {
        setBuild([
            {
                name: 'cloud',
                projectId: 'project-cloud',
                apiKey: 'key-cloud',
                frontendBaseUrl: PROD_URL,
                identityToolkitUrl: 'https://identitytoolkit.googleapis.com',
                secureTokenUrl: 'https://securetoken.googleapis.com',
                firestoreUrl: 'https://firestore.googleapis.com',
            },
        ]);
        const { applySide } = await load();
        const { config } = await import('../../../packages/shared/src/auth/config');

        applySide('cloud');
        expect(config.firestoreUrl).toBe('https://firestore.googleapis.com');
        expect(config.identityToolkitUrl).toBe('https://identitytoolkit.googleapis.com');
    });

    test('the alarm colour follows the project, not the ring position', async () => {
        // isLiveProd decides the badge's warning colour. Deriving it from a
        // target's NAME or its slot would let a row called anything at all
        // point at real user data while the badge stayed calm.
        const { applySide, isLiveProd } = await load();

        expect(isLiveProd()).toBe(false);
        applySide('preprod');
        expect(isLiveProd()).toBe(false);
        applySide('prod');
        expect(isLiveProd()).toBe(true);
    });
});

describe('a malformed ring degrades instead of killing the worker', () => {
    // An unparseable define must not throw during module evaluation: in a
    // service worker that registers NO listeners and the extension is silently
    // dead, with nothing shown on chrome://extensions.
    test('invalid JSON leaves a ring of one', async () => {
        setBuild([]);
        (global as any).__EXT_DEV_TARGETS__ = '{not json';
        const { canSwitch, targetNames } = await load();
        expect(canSwitch()).toBe(false);
        expect(targetNames()).toEqual(['local']);
    });

    test('a row missing its api key is skipped, the rest survive', async () => {
        // The project and its key must move together: preprod's
        // /auth/extension-token mints a token signed by ITS project, which
        // Firebase refuses to exchange with another project's key.
        setBuild([
            { name: 'broken', projectId: 'project-x', frontendBaseUrl: PREPROD_URL },
            RING[1],
        ]);
        const { targetNames } = await load();
        expect(targetNames()).toEqual(['local', 'prod']);
    });
});
