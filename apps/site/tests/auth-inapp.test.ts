/**
 * In-app browser detection and the hand-off to the system browser, behind the
 * landing page's Google button (Google refuses OAuth in embedded browsers).
 */
import { externalBrowserUrl, inAppMessage, isInAppBrowser, openInBrowserLabel } from '../src/auth/inapp';

const UA = {
  telegramAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 Telegram-Android/11.2.2 (Google Pixel 8; Android 14; SDK 34; HIGH)',
  iosWebView:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0',
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

describe('isInAppBrowser', () => {
  it.each([
    ['telegramAndroid', true],
    ['iosWebView', true],
    ['instagram', true],
    ['iosSafari', false],
    ['iosChrome', false],
    ['androidChrome', false],
    ['desktop', false],
  ] as const)('%s → %s', (name, want) => {
    expect(isInAppBrowser(UA[name])).toBe(want);
  });
});

describe('externalBrowserUrl', () => {
  const href = 'https://lingogram.ai/ru/register/?utm_source=telegram#top';

  it('hands Android to the default browser with a fallback to the page', () => {
    expect(externalBrowserUrl(href, UA.telegramAndroid)).toBe(
      'intent://lingogram.ai/ru/register/?utm_source=telegram#Intent;scheme=https;S.browser_fallback_url=' +
        encodeURIComponent(href) +
        ';end',
    );
  });

  it('hands iOS to Safari', () => {
    expect(externalBrowserUrl(href, UA.iosWebView)).toBe(
      'x-safari-https://lingogram.ai/ru/register/?utm_source=telegram#top',
    );
  });

  it('leaves other browsers and non-https pages alone', () => {
    expect(externalBrowserUrl(href, UA.desktop)).toBe(href);
    expect(externalBrowserUrl('http://localhost:5173/register/', UA.telegramAndroid)).toBe(
      'http://localhost:5173/register/',
    );
  });
});

describe('messages', () => {
  it('speak the page language, English otherwise', () => {
    expect(inAppMessage('ru')).toMatch(/встроенном браузере/);
    expect(openInBrowserLabel('ru-RU')).toBe('Открыть в браузере');
    expect(inAppMessage('de')).toMatch(/in-app browser/);
    expect(openInBrowserLabel('')).toBe('Open in browser');
  });
});
