/**
 * @jest-environment jsdom
 */

// The banner renders copy authored in the Firebase Console, so the two things
// that matter most here are where it lands in the DOM and that its text can
// never become markup.

const sendMessageMock = jest.fn();

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        sendMessage: sendMessageMock,
        lastError: undefined,
        getManifest: () => ({ version: '1.0.16' }),
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
};

import {
    fetchAndRenderNotification,
    removeNotificationBanner,
    renderNotificationBanner,
} from '../src/content/notification-banner';
import type { RemoteNotification } from '../src/notification-types';

function n(over: Partial<RemoteNotification> = {}): RemoteNotification {
    return { id: 'n1', severity: 'warning', title: 'T', body: 'B', dismissible: false, ...over };
}

function sidebar(): void {
    document.body.innerHTML = `
        <div id="vtt-sidebar">
            <div id="vtt-header">
                <div id="vtt-subheader"></div>
                <div id="vtt-settings-panel"></div>
            </div>
            <div id="vtt-list"></div>
        </div>`;
}

beforeEach(() => {
    sendMessageMock.mockReset();
    sidebar();
});

describe('renderNotificationBanner', () => {
    it('inserts the banner directly after the sub-header', () => {
        renderNotificationBanner(n());
        const el = document.getElementById('vtt-notification');
        expect(el).not.toBeNull();
        // Placement is the whole point: inside #vtt-header, above the settings
        // panel, so it never pushes the transcript down.
        expect(document.getElementById('vtt-subheader')!.nextElementSibling).toBe(el);
        expect(el!.parentElement!.id).toBe('vtt-header');
    });

    it('renders the title and body', () => {
        renderNotificationBanner(n({ title: 'Broken', body: 'Fixing it' }));
        expect(document.querySelector('.vtt-notification-title')!.textContent).toBe('Broken');
        expect(document.querySelector('.vtt-notification-text')!.textContent).toBe('Fixing it');
    });

    it('tags the severity as a class', () => {
        renderNotificationBanner(n({ severity: 'critical' }));
        expect(document.getElementById('vtt-notification')!.className).toContain('is-critical');
    });

    it('escalates the live region only for critical', () => {
        renderNotificationBanner(n({ severity: 'info' }));
        expect(document.getElementById('vtt-notification')!.getAttribute('role')).toBe('status');
        renderNotificationBanner(n({ severity: 'critical' }));
        expect(document.getElementById('vtt-notification')!.getAttribute('role')).toBe('alert');
    });

    it('never turns backend copy into markup', () => {
        renderNotificationBanner(n({ title: '<img src=x onerror=alert(1)>', body: '<b>no</b>' }));
        const el = document.getElementById('vtt-notification')!;
        expect(el.querySelector('img')).toBeNull();
        expect(el.querySelector('b')).toBeNull();
        expect(document.querySelector('.vtt-notification-text')!.textContent).toBe('<b>no</b>');
    });

    it('clears the banner when passed null', () => {
        renderNotificationBanner(n());
        renderNotificationBanner(null);
        expect(document.getElementById('vtt-notification')).toBeNull();
    });

    it('replaces rather than stacks on re-render', () => {
        renderNotificationBanner(n({ severity: 'info' }));
        renderNotificationBanner(n({ severity: 'critical' }));
        expect(document.querySelectorAll('#vtt-notification')).toHaveLength(1);
        // A stale severity class left behind would mis-colour the banner.
        expect(document.getElementById('vtt-notification')!.className).not.toContain('is-info');
    });

    it('omits the close button unless the notification is dismissible', () => {
        renderNotificationBanner(n({ dismissible: false }));
        expect(document.querySelector('.vtt-notification-close')).toBeNull();
        renderNotificationBanner(n({ dismissible: true }));
        expect(document.querySelector('.vtt-notification-close')).not.toBeNull();
    });

    it('closes and records the dismissal on click', () => {
        renderNotificationBanner(n({ id: 'yt-outage', dismissible: true }));
        (document.querySelector('.vtt-notification-close') as HTMLButtonElement).click();
        expect(document.getElementById('vtt-notification')).toBeNull();
        expect(sendMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'DISMISS_NOTIFICATION', id: 'yt-outage' }),
            expect.any(Function),
        );
    });

    // T5.28 (§22.4). This asserted only toBeTruthy(), which the visible glyph
    // '\u00d7' satisfies — so the check passed on a control whose accessible name
    // was the multiplication sign, the exact thing an aria-label is here to
    // replace. Pinned to the word instead.
    it('names the close button "Dismiss", not its glyph', () => {
        renderNotificationBanner(n({ dismissible: true }));
        const btn = document.querySelector('.vtt-notification-close')!;
        expect(btn.getAttribute('aria-label')).toBe('Dismiss');
        // The tooltip is the pointer user's copy of the same name; a divergence
        // means one of the two audiences is reading a different control.
        expect(btn.getAttribute('title')).toBe('Dismiss');
        // And the label is not merely the glyph repeated.
        expect(btn.getAttribute('aria-label')).not.toBe(btn.textContent);
    });

    it('does nothing when there is no sidebar to attach to', () => {
        document.body.innerHTML = '';
        expect(() => renderNotificationBanner(n())).not.toThrow();
        expect(document.getElementById('vtt-notification')).toBeNull();
    });

    it('removeNotificationBanner is safe with no banner present', () => {
        expect(() => removeNotificationBanner()).not.toThrow();
    });
});

describe('fetchAndRenderNotification', () => {
    it('passes version, platform and locale to the worker', async () => {
        sendMessageMock.mockImplementation((_m, cb) => cb({ notification: null }));
        await fetchAndRenderNotification('youtube');
        expect(sendMessageMock.mock.calls[0][0]).toEqual({
            action: 'GET_NOTIFICATION',
            version: '1.0.16',
            platform: 'youtube',
            locale: 'en',
        });
    });

    it('renders whatever the worker returns', async () => {
        sendMessageMock.mockImplementation((_m, cb) => cb({ notification: n({ title: 'Live' }) }));
        await fetchAndRenderNotification('youtube');
        expect(document.querySelector('.vtt-notification-title')!.textContent).toBe('Live');
    });

    it('renders nothing when the worker has nothing', async () => {
        sendMessageMock.mockImplementation((_m, cb) => cb({ notification: null }));
        await fetchAndRenderNotification('youtube');
        expect(document.getElementById('vtt-notification')).toBeNull();
    });

    it('survives an undefined reply from a sleeping worker', async () => {
        sendMessageMock.mockImplementation((_m, cb) => cb(undefined));
        await expect(fetchAndRenderNotification('youtube')).resolves.toBeUndefined();
        expect(document.getElementById('vtt-notification')).toBeNull();
    });

    it('never rejects when messaging throws', async () => {
        sendMessageMock.mockImplementation(() => {
            throw new Error('extension reloading');
        });
        await expect(fetchAndRenderNotification('youtube')).resolves.toBeUndefined();
    });
});
