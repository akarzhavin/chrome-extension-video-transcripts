// How a loaded track reads in a picker (the sidebar's selects, HDrezka's CC
// menu). Track names carry the language word first for matching
// ("Russian — Русский"); the viewer sees the site's own label after it.

import { SUPPORTED_LANGUAGES } from './languages';
import { AI_SUFFIX } from './subtitle-ai/controller';

/** "Русский", "English (реж.)"; the AI translation by its language alone, "Українська"; the bare name otherwise. */
export function trackLabel(name: string): string {
    if (name.endsWith(AI_SUFFIX)) return aiTrackLabel(name.slice(0, -AI_SUFFIX.length));
    const i = name.indexOf(' — ');
    return i === -1 ? name : name.slice(i + 3);
}

/** The AI translation into a language, by its English label or its code: "Українська", nothing added (the owner's call). */
export function aiTrackLabel(language: string): string {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.label === language || l.code === language);
    return lang?.native ?? language;
}
