// The note under the sidebar header when a window nears its limit.

import { msg } from '../i18n';

const NOTE_MS = 8000;

export function showWarningNote(headerTop: HTMLElement, window: 'day' | 'month'): void {
    const doc = headerTop.ownerDocument;
    doc.getElementById('vtt-ai-warn')?.remove();
    const note = doc.createElement('div');
    note.id = 'vtt-ai-warn';
    note.setAttribute('role', 'status');
    note.textContent =
        window === 'month'
            ? msg('aiWarnMonth', 'AI is almost used up for this month')
            : msg('aiWarnDay', 'AI is almost used up for today');
    headerTop.after(note);
    setTimeout(() => note.remove(), NOTE_MS);
}
