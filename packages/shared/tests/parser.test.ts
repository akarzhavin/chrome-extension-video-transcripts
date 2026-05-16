/**
 * @jest-environment jsdom
 */

import { parseVTT } from '../src/parser';

describe('parseVTT', () => {
    test('should parse a standard VTT file', () => {
        const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hello, world!

2
00:00:05.000 --> 00:00:08.500
This is a test.`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('Hello, world!');
        expect(result[0].startTime).toBe(1.0);
        expect(result[0].endTime).toBe(4.0);
        expect(result[1].text).toBe('This is a test.');
        expect(result[1].startTime).toBe(5.0);
        expect(result[1].endTime).toBe(8.5);
    });

    test('should handle VTT without hour component', () => {
        const vtt = `WEBVTT

00:01.000 --> 00:04.000
Short timecode`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(1);
        expect(result[0].startTime).toBe(1.0);
        expect(result[0].endTime).toBe(4.0);
    });

    test('should handle VTT with hour component', () => {
        const vtt = `WEBVTT

01:30:00.000 --> 01:30:05.000
One hour thirty minutes in`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(1);
        expect(result[0].startTime).toBe(5400.0);
        expect(result[0].endTime).toBe(5405.0);
    });

    test('should strip HTML tags from subtitle text', () => {
        const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<b>Bold</b> and <i>italic</i> text`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Bold and italic text');
    });

    test('should strip voice tags (<v Name>)', () => {
        const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Speaker>Hello there!</v>`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Hello there!');
    });

    test('should handle multiline subtitles', () => {
        const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Line one
Line two`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(1);
        expect(result[0].text).toContain('Line one');
        expect(result[0].text).toContain('Line two');
    });

    test('should return empty array for invalid VTT', () => {
        const result = parseVTT('This is not a VTT file');
        expect(result).toHaveLength(0);
    });

    test('should return empty array for empty input', () => {
        const result = parseVTT('');
        expect(result).toHaveLength(0);
    });

    test('should handle \\r\\n line endings', () => {
        const vtt = "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:04.000\r\nWindows line endings";

        const result = parseVTT(vtt);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Windows line endings');
    });

    test('should skip blocks without text content', () => {
        const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000


00:00:05.000 --> 00:00:08.000
Valid subtitle`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Valid subtitle');
    });

    test('should handle Cyrillic text correctly', () => {
        const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Привет, мир!

00:00:05.000 --> 00:00:08.000
Це тестовий субтитр.`;

        const result = parseVTT(vtt);
        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('Привет, мир!');
        expect(result[1].text).toBe('Це тестовий субтитр.');
    });
});
