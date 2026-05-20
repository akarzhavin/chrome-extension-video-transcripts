const PILL_ID = 'lingogram-quick-add-pill';
const TOAST_ID = 'lingogram-quick-add-toast';
const MAX_TERM_LEN = 256;

function getSelectionText(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    return sel.toString().trim();
}

function getSelectionRect(): DOMRect | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
}

function removePill(): void {
    document.getElementById(PILL_ID)?.remove();
}

function showToast(text: string, ok: boolean): void {
    document.getElementById(TOAST_ID)?.remove();
    const t = document.createElement('div');
    t.id = TOAST_ID;
    t.textContent = text;
    Object.assign(t.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        padding: '10px 14px',
        borderRadius: '8px',
        background: ok ? 'rgba(22,163,74,0.95)' : 'rgba(185,28,28,0.95)',
        color: '#fff',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    } as CSSStyleDeclaration);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function showPill(rect: DOMRect, term: string): void {
    removePill();
    const pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.textContent = '+ Lingogram';
    Object.assign(pill.style, {
        position: 'fixed',
        left: `${Math.round(rect.left + rect.width / 2 - 50)}px`,
        top: `${Math.round(rect.top - 32)}px`,
        zIndex: '2147483647',
        padding: '4px 10px',
        borderRadius: '999px',
        border: '0',
        background: '#2563eb',
        color: '#fff',
        fontSize: '12px',
        fontWeight: '600',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        cursor: 'pointer',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    } as CSSStyleDeclaration);

    pill.addEventListener('mousedown', (e) => {
        // Prevent selection collapse before click fires.
        e.preventDefault();
    });

    pill.addEventListener('click', async (e) => {
        e.stopPropagation();
        pill.disabled = true;
        pill.textContent = '…';
        try {
            const res = await sendMessage<{ ok: boolean; error?: string }>({
                action: 'ADD_WORD',
                term,
                sourceUrl: location.href,
            });
            if (!res.ok) throw new Error(res.error ?? 'add failed');
            showToast(`Added: ${term}`, true);
        } catch (err) {
            showToast(`Sign in via the extension icon first.`, false);
            console.warn('Lingogram add failed:', err);
        } finally {
            removePill();
        }
    });

    document.body.appendChild(pill);
}

function sendMessage<T>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(msg, (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(res as T);
            });
        } catch (err) {
            reject(err);
        }
    });
}

export function installQuickAddOverlay(): void {
    document.addEventListener('mouseup', () => {
        // Defer so that selection is finalized after click on existing pill clearing it.
        setTimeout(() => {
            const text = getSelectionText();
            if (!text || text.length > MAX_TERM_LEN) {
                removePill();
                return;
            }
            const rect = getSelectionRect();
            if (!rect) {
                removePill();
                return;
            }
            showPill(rect, text.toLowerCase());
        }, 0);
    });

    document.addEventListener('mousedown', (e) => {
        const pill = document.getElementById(PILL_ID);
        if (pill && !pill.contains(e.target as Node)) {
            removePill();
        }
    });
}
