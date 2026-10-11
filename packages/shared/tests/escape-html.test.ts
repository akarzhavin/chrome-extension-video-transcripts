import { escapeHtml } from '../src/escape-html';

describe('escapeHtml', () => {
    test('escapes what could close a tag or an attribute value', () => {
        expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    });

    test('leaves plain text alone', () => {
        expect(escapeHtml('give it a shot')).toBe('give it a shot');
    });
});
