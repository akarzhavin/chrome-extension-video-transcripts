export * from './AppState';
export * from './i18n';
export * from './SidebarUI';
export * from './LanguageUtils';
export * from './languages';
export * from './parser';
export * from './subtitle-download';
export * from './prefs';
export * from './types';
export * from './auth';
export * from './content';
// Word lookup: one name, not `export *`. A wildcard would put the dictionary
// client and its cache on the barrel, and the barrel is the embed's surface —
// the embed has no worker to route LOOKUP_WORD through. See src/lookup/index.
export { installLookupStrip, WordScreen } from './lookup';
export * from './popup';
export * from './onboarding';
// Content-safe half only. analytics-bg.ts is deliberately NOT re-exported: it
// reads __GA4_API_SECRET__, and this barrel is imported by content scripts
// whose bundles are readable from any page. Service workers import it by
// relative path.
export * from './analytics';
// Types and message contract only. notifications.ts itself is NOT re-exported
// for the same reason as analytics-bg: it imports it to report fetch failures,
// so it carries the GA4 secret transitively. Service workers import it by
// relative path; content scripts only ever need these types.
export * from './notification-types';
