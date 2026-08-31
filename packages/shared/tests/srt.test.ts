/**
 * @jest-environment jsdom
 */

import { isDownloadable, srtFileName, toSrt } from '../src/srt';
import { Subtitle } from '../src/types';

const cue = (startTime: number, endTime: number, text: string): Subtitle => ({
    startTime,
    endTime,
    text,
});

describe('toSrt', () => {
    test('writes numbered blocks with comma-separated milliseconds', () => {
        const srt = toSrt([cue(1, 4, 'Hello, world!'), cue(5, 8.5, 'This is a test.')]);

        expect(srt).toBe(
            '1\r\n00:00:01,000 --> 00:00:04,000\r\nHello, world!\r\n' +
                '\r\n' +
                '2\r\n00:00:05,000 --> 00:00:08,500\r\nThis is a test.\r\n',
        );
    });

    test('formats hours, minutes and milliseconds', () => {
        const srt = toSrt([cue(3661.007, 3662, 'Late cue')]);
        expect(srt).toContain('01:01:01,007 --> 01:01:02,000');
    });

    test('renumbers in time order, not file order', () => {
        // Netflix stores a two-line caption as two cues whose file order does
        // not follow the clock; a player stops at the first backwards jump.
        const srt = toSrt([cue(10, 12, 'second'), cue(2, 4, 'first')]);
        const blocks = srt.trim().split('\r\n\r\n');

        expect(blocks[0]).toContain('first');
        expect(blocks[0].startsWith('1\r\n')).toBe(true);
        expect(blocks[1]).toContain('second');
        expect(blocks[1].startsWith('2\r\n')).toBe(true);
    });

    test('drops blank cues so no caption-shaped gap is written', () => {
        const srt = toSrt([cue(1, 2, 'kept'), cue(3, 4, '   '), cue(5, 6, 'also kept')]);

        expect(srt).toContain('kept');
        expect(srt).toContain('also kept');
        // Two blocks, numbered 1 and 2 — the blank one leaves no hole.
        expect(srt.trim().split('\r\n\r\n')).toHaveLength(2);
        expect(srt).toContain('2\r\n00:00:05,000');
    });

    test('gives a zero-length cue a visible span', () => {
        const srt = toSrt([cue(7, 7, 'instant')]);
        expect(srt).toContain('00:00:07,000 --> 00:00:08,000');
    });

    test('normalizes newlines inside a cue to CRLF', () => {
        const srt = toSrt([cue(1, 2, 'line one\nline two')]);
        expect(srt).toContain('line one\r\nline two');
    });

    test('clamps a negative start rather than emitting a broken timestamp', () => {
        const srt = toSrt([cue(-1, 2, 'early')]);
        expect(srt).toContain('00:00:00,000 -->');
    });

    test('returns an empty string when nothing is worth writing', () => {
        expect(toSrt([])).toBe('');
        expect(toSrt([cue(1, 2, '  ')])).toBe('');
    });
});

describe('srtFileName', () => {
    test('joins the page title and the track name', () => {
        expect(srtFileName('My Video', 'English')).toBe('My Video.English.srt');
    });

    test('replaces characters a filesystem rejects', () => {
        expect(srtFileName('A/B: "C" <D>|E?', 'ru')).toBe('A B C D E.ru.srt');
    });

    test('strips control characters', () => {
        expect(srtFileName('Tab\there', 'en')).toBe('Tab here.en.srt');
    });

    test('falls back when the title is empty or unusable', () => {
        expect(srtFileName('', 'en')).toBe('subtitles.en.srt');
        expect(srtFileName('///', 'en')).toBe('subtitles.en.srt');
    });

    test('omits the track segment when there is no usable track name', () => {
        expect(srtFileName('My Video', '')).toBe('My Video.srt');
    });

    test('keeps the name to a sane length', () => {
        const name = srtFileName('x'.repeat(200), 'y'.repeat(100));
        expect(name.length).toBeLessThanOrEqual(80 + 1 + 40 + 4);
    });
});

describe('isDownloadable', () => {
    test('true only when the track has a cue with text', () => {
        expect(isDownloadable({ name: 'en', subtitles: [cue(1, 2, 'hi')] })).toBe(true);
        expect(isDownloadable({ name: 'en', subtitles: [cue(1, 2, '  ')] })).toBe(false);
        expect(isDownloadable({ name: 'en', subtitles: [] })).toBe(false);
        expect(isDownloadable(undefined)).toBe(false);
    });
});
