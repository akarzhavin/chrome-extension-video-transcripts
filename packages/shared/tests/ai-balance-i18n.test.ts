/** Reset times survive a real chrome.i18n, which blanks "$1" when no substitution is given. */
const MESSAGES: Record<string, string> = {
    aiResetsAt: 'Resets at $1',
    aiResetsOn: 'Resets on $1',
    aiLimitDayShort: 'AI limit for today reached',
    aiLimitMonthShort: 'AI limit for this month reached',
    aiLimitDay: 'AI limit for today reached, resets at $1',
    aiLimitMonth: 'AI limit for this month reached, resets on $1',
};
// Chrome: $1..$9 take the substitutions; an unspecified one becomes ''.
const getMessage = jest.fn((key: string, subs?: string | string[]) => {
    const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
    return (MESSAGES[key] ?? '').replace(/\$(\d)/g, (_, n) => list[Number(n) - 1] ?? '');
});
(global as any).chrome = { i18n: { getMessage } };

import { msg, setI18nOverride } from '../src/i18n';
import { limitText, localDate, localTime, resetsAtText, resetsOnText } from '../src/ai-balance/format';
import { parseBalance } from '../src/ai-balance/types';

const RESET = Date.UTC(2026, 9, 12, 3, 0);
const b = parseBalance(
    {
        day: { used: 1, limit: 2, resets_at: RESET },
        month: { used: 1, limit: 2, resets_at: RESET },
        exhausted: null,
        warn_ratio: 0.8,
    },
    1,
)!;

describe('msg substitutions', () => {
    afterEach(() => setI18nOverride(null));

    it('passes substitutions to chrome.i18n', () => {
        expect(msg('aiResetsAt', 'Resets at $1', ['03:00'])).toBe('Resets at 03:00');
    });

    it('substitutes into the fallback when chrome has no message', () => {
        expect(msg('missing', 'Hello $1', ['x'])).toBe('Hello x');
    });

    it('substitutes into an override too', () => {
        setI18nOverride({ aiResetsAt: 'Um $1' });
        expect(msg('aiResetsAt', 'Resets at $1', ['03:00'])).toBe('Um 03:00');
    });
});

describe('reset time texts', () => {
    it('keep their time through a Chrome-like getMessage', () => {
        expect(resetsAtText(b.day)).toBe(`Resets at ${localTime(RESET)}`);
        expect(resetsOnText(b.month)).toBe(`Resets on ${localDate(RESET)}`);
        expect(limitText('day', b)).toBe(`AI limit for today reached, resets at ${localTime(RESET)}`);
        expect(limitText('month', b)).toBe(`AI limit for this month reached, resets on ${localDate(RESET)}`);
    });

    it('limitText without a balance says the short message, whatever the locale punctuation', () => {
        expect(limitText('day', null)).toBe('AI limit for today reached');
        expect(limitText('month', null)).toBe('AI limit for this month reached');
        setI18nOverride({ aiLimitDay: '今日のAI上限に達しました、$1にリセットされます', aiLimitDayShort: '今日のAI上限に達しました' });
        expect(limitText('day', null)).toBe('今日のAI上限に達しました');
        setI18nOverride(null);
    });
});
