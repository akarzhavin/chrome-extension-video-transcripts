/**
 * The sign-in handoff arrives from whichever frontend the user opened, which is
 * not necessarily the side the service worker is pointed at — the badge is
 * usually untouched at that moment. Both build-supplied sides must be accepted.
 */
describe('handoff origin allowlist spans both switchable sides', () => {
    const HOME_URL = 'https://home.example.com';
    const AWAY_URL = 'https://away.example.com';

    beforeEach(() => {
        jest.resetModules();
        (global as any).__EXT_ENV__ = 'dev';
        (global as any).__FRONTEND_BASE_URL__ = HOME_URL;
        (global as any).__EXT_ALT_PROJECT_ID__ = 'project-away';
        (global as any).__EXT_ALT_API_KEY__ = 'key-away';
        (global as any).__EXT_ALT_FRONTEND_BASE_URL__ = AWAY_URL;
    });

    test('both sides are offered, and switching does not drop either', async () => {
        const { switchableFrontendBaseUrls, applySide } = await import(
            '../../../packages/shared/src/auth/devEnvSwitch'
        );

        expect(switchableFrontendBaseUrls().sort()).toEqual([AWAY_URL, HOME_URL].sort());

        // The bug: after switching, a set frozen at startup still held only the
        // booted side, so the other frontend's handoff was refused.
        applySide('away');
        expect(switchableFrontendBaseUrls().sort()).toEqual([AWAY_URL, HOME_URL].sort());

        applySide('home');
        expect(switchableFrontendBaseUrls().sort()).toEqual([AWAY_URL, HOME_URL].sort());
    });

    test('a build with no second target offers only its own frontend', async () => {
        (global as any).__EXT_ALT_PROJECT_ID__ = '';
        (global as any).__EXT_ALT_API_KEY__ = '';
        (global as any).__EXT_ALT_FRONTEND_BASE_URL__ = '';

        const { switchableFrontendBaseUrls } = await import(
            '../../../packages/shared/src/auth/devEnvSwitch'
        );
        expect(switchableFrontendBaseUrls()).toEqual([HOME_URL]);
    });
});
