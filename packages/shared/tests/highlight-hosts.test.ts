import { readFileSync } from 'fs';
import { join } from 'path';
import { highlightSiteOf, isHighlightOff, normalizeHost, withHighlight } from '../src/highlight-hosts';

describe('normalizeHost', () => {
    test('strips a leading www.', () => {
        expect(normalizeHost('www.bbc.com')).toBe('bbc.com');
    });

    test('is case-insensitive', () => {
        expect(normalizeHost('WWW.BBC.Com')).toBe('bbc.com');
    });

    test('keeps every other subdomain', () => {
        expect(normalizeHost('en.wikipedia.org')).toBe('en.wikipedia.org');
        expect(normalizeHost('news.bbc.co.uk')).toBe('news.bbc.co.uk');
    });

    test('strips www. only at the start', () => {
        expect(normalizeHost('docs.www.example.com')).toBe('docs.www.example.com');
        expect(normalizeHost('wwwexample.com')).toBe('wwwexample.com');
    });
});

describe('isHighlightOff', () => {
    test('www. and bare host are one entry', () => {
        expect(isHighlightOff(['bbc.com'], 'www.bbc.com')).toBe(true);
        expect(isHighlightOff(['bbc.com'], 'bbc.com')).toBe(true);
    });

    test('a subdomain is a different site from its parent, both ways', () => {
        expect(isHighlightOff(['bbc.co.uk'], 'news.bbc.co.uk')).toBe(false);
        expect(isHighlightOff(['news.bbc.co.uk'], 'bbc.co.uk')).toBe(false);
    });

    test('an empty list switches nothing off', () => {
        expect(isHighlightOff([], 'bbc.com')).toBe(false);
    });
});

describe('withHighlight', () => {
    test('off adds the normalised host once', () => {
        expect(withHighlight([], 'WWW.BBC.com', false)).toEqual(['bbc.com']);
        expect(withHighlight(['bbc.com'], 'www.bbc.com', false)).toEqual(['bbc.com']);
    });

    test('on removes exactly that host', () => {
        expect(withHighlight(['a.com', 'bbc.com', 'b.com'], 'www.bbc.com', true)).toEqual(['a.com', 'b.com']);
    });

    test('does not change the list it was given', () => {
        const list = ['a.com'];
        withHighlight(list, 'b.com', false);
        expect(list).toEqual(['a.com']);
    });
});

describe('highlightSiteOf', () => {
    test('an http(s) page gives its normalised host', () => {
        expect(highlightSiteOf('https://www.theguardian.com/world/x?y=1')).toBe('theguardian.com');
        expect(highlightSiteOf('http://en.wikipedia.org/wiki/Cat')).toBe('en.wikipedia.org');
    });

    test.each(['chrome://extensions', 'chrome://newtab/', 'file:///tmp/a.html', 'chrome-extension://abc/words.html', 'about:blank', 'not a url', ''])(
        'gives nothing for %s',
        (url) => {
            expect(highlightSiteOf(url)).toBeNull();
        },
    );

    test('gives nothing without a URL', () => {
        expect(highlightSiteOf(undefined)).toBeNull();
    });

    test("gives nothing on Lingogram's own site, as the manifest excludes it", () => {
        expect(highlightSiteOf('https://lingogram.ai/app/vocab')).toBeNull();
        expect(highlightSiteOf('https://api.lingogram.ai/x')).toBeNull();
        expect(highlightSiteOf('https://notlingogram.ai/')).toBe('notlingogram.ai');
    });
});

describe('the manifests', () => {
    test.each(['youtube', 'rezka'])("%s: the page-highlight script's exclusions are the two Lingogram patterns this module knows", (app) => {
        const manifest = JSON.parse(readFileSync(join(__dirname, `../../../apps/${app}/manifest.json`), 'utf8'));
        const script = manifest.content_scripts.find((c: any) => c.js.includes('src/content/page-highlight.js'));
        expect(script.exclude_matches).toEqual(['https://lingogram.ai/*', 'https://*.lingogram.ai/*']);
    });

    test.each(['youtube', 'rezka'])('%s: no tabs permission, so tab.url comes from activeTab alone', (app) => {
        const manifest = JSON.parse(readFileSync(join(__dirname, `../../../apps/${app}/manifest.json`), 'utf8'));
        expect(manifest.permissions).toContain('activeTab');
        expect(manifest.permissions).not.toContain('tabs');
    });
});
