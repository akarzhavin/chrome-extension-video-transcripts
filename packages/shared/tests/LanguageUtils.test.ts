/**
 * @jest-environment jsdom
 */

import { LanguageUtils } from '../src/LanguageUtils';
import { Subtitle, Track } from '../src/types';

describe('LanguageUtils', () => {
    test('guessLanguage should identify English', () => {
        const subs: Partial<Subtitle>[] = [
            { text: "Hello there!" },
            { text: "This is a test subtitle." }
        ];
        expect(LanguageUtils.guessLanguage(subs as Subtitle[])).toBe("English");
    });

    test('guessLanguage should identify Russian', () => {
        const subs: Partial<Subtitle>[] = [
            { text: "Привет!" },
            { text: "Это тестовые субтитры." }
        ];
        expect(LanguageUtils.guessLanguage(subs as Subtitle[])).toBe("Russian");
    });

    test('guessLanguage should identify Ukrainian', () => {
        const subs: Partial<Subtitle>[] = [
            { text: "Привіт!" },
            { text: "Це тестові субтитри з літерою ї та є." }
        ];
        expect(LanguageUtils.guessLanguage(subs as Subtitle[])).toBe("Ukrainian");
    });

    test('generateTrackName should handle multiple tracks of same language', () => {
        const existing: Partial<Track>[] = [{ name: 'English' }, { name: 'Russian' }];
        expect(LanguageUtils.generateTrackName([{ text: 'Hello' }] as Subtitle[], existing as Track[])).toBe('English 2');
        expect(LanguageUtils.generateTrackName([{ text: 'Привет' }] as Subtitle[], existing as Track[])).toBe('Russian 2');
        expect(LanguageUtils.generateTrackName([{ text: '123 !!!' }] as Subtitle[], existing as Track[])).toBe('Track');
    });
});
