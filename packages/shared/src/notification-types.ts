// Shape of a notification after it has been resolved for one user: one
// language picked, one severity, ready to render.
//
// Split from notifications.ts on purpose. That module reaches for the network
// and reports failures through analytics-bg (which carries the GA4 api_secret
// and must never reach a content bundle), so it is service-worker-only. The
// banner renderer runs in the content script and needs nothing but this type,
// so the type lives here and both sides import it without dragging the
// transport along.

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export const NOTIFICATION_SEVERITIES: readonly NotificationSeverity[] = [
    'info',
    'warning',
    'critical',
] as const;

export function isNotificationSeverity(v: unknown): v is NotificationSeverity {
    return (NOTIFICATION_SEVERITIES as readonly string[]).includes(String(v));
}

/** A notification resolved for one user: language picked, ready to render. */
export interface RemoteNotification {
    /** Document id. Identifies the notification for the dismissal record. */
    id: string;
    severity: NotificationSeverity;
    title: string;
    body: string;
    /** Whether to render a close button. Defaults to false when unset. */
    dismissible: boolean;
}

/** What the client reports about itself so the server side can address it. */
export interface NotificationQuery {
    /** Extension version, e.g. '1.0.16'. */
    version: string;
    /** Where the user is watching: 'youtube' | 'netflix' | 'rezka' | … */
    platform: string;
    /** Which edition is installed, e.g. 'youtube-extension'. */
    source: string;
    /** UI locale, possibly regional ('pt-BR'). */
    locale: string;
}

/** Message action the content script posts to the service worker. */
export const GET_NOTIFICATION_ACTION = 'GET_NOTIFICATION' as const;

export interface GetNotificationMessage extends NotificationQuery {
    action: typeof GET_NOTIFICATION_ACTION;
}

/** Action the content script posts once the user closes a notification. */
export const DISMISS_NOTIFICATION_ACTION = 'DISMISS_NOTIFICATION' as const;

export interface DismissNotificationMessage {
    action: typeof DISMISS_NOTIFICATION_ACTION;
    id: string;
}
