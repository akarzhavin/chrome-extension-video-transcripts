// Google refuses OAuth inside embedded browsers (403 disallowed_useragent), and
// Telegram, Instagram and Facebook open links in one. These helpers spot such a
// browser and build a link that hands the page to the system browser instead.

const IN_APP_MARKERS = /Telegram|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|; wv\)/i;

/** Whether ua is an embedded (in-app) browser, where Google sign-in fails. */
export function isInAppBrowser(ua: string): boolean {
  if (IN_APP_MARKERS.test(ua)) return true;
  // An iOS WKWebView reports Mobile/ without Safari/, unlike Safari and Chrome on iOS.
  return /iPhone|iPad|iPod/.test(ua) && /Mobile\//.test(ua) && !/Safari\//.test(ua);
}

/**
 * A link that opens href in the system browser from an in-app one: an Android
 * intent (falling back to href), Safari's x-safari-https scheme on iOS, or
 * href itself elsewhere.
 */
export function externalBrowserUrl(href: string, ua: string): string {
  const u = new URL(href);
  if (u.protocol !== 'https:') return href;
  const rest = u.host + u.pathname + u.search + u.hash;
  if (/Android/i.test(ua)) {
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  }
  if (/iPhone|iPad|iPod/.test(ua)) return 'x-safari-https://' + rest;
  return href;
}

/** The message shown instead of a failing Google popup, in the page's language. */
export function inAppMessage(lang: string): string {
  return lang.toLowerCase().startsWith('ru')
    ? 'Вход через Google не работает во встроенном браузере. Откройте страницу в обычном браузере или войдите по email.'
    : "Google sign-in doesn't work in this in-app browser. Open the page in your browser, or sign in with email.";
}

export function openInBrowserLabel(lang: string): string {
  return lang.toLowerCase().startsWith('ru') ? 'Открыть в браузере' : 'Open in browser';
}
