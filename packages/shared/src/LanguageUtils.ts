import { Subtitle, Track } from './types';

export const LanguageUtils = {
    guessLanguage(subs: Subtitle[]): string {
        if (!subs || subs.length === 0) return "Unknown";
        
        const sampleText = subs.slice(0, 20).map(s => s.text).join(' ');
        const cyrillicCount = (sampleText.match(/[а-яА-ЯёЁіІїЇєЄґҐ]/g) || []).length;
        const latinCount = (sampleText.match(/[a-zA-Z]/g) || []).length;
        
        if (cyrillicCount > latinCount) {
            const ukrainianCount = (sampleText.match(/[іІїЇєЄ]/g) || []).length;
            return ukrainianCount > 0 ? "Ukrainian" : "Russian";
        }
        if (latinCount > cyrillicCount && latinCount > 0) return "English";
        return "Track";
    },

    generateTrackName(subs: Subtitle[], existingTracks: Track[]): string {
        const lang = this.guessLanguage(subs);
        const count = existingTracks.filter(t => t.name.startsWith(lang)).length;
        return count > 0 ? `${lang} ${count + 1}` : lang;
    }
};
