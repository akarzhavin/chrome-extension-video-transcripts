// A view's "the person is back on this tab", for asking the worker again.

/** Calls cb when doc is shown again, at most once per everyMs counted from now; returns the stop. */
export function onTabReturn(doc: Document, everyMs: number, cb: () => void): () => void {
    let at = Date.now();
    const visible = () => {
        if (doc.visibilityState !== 'visible' || Date.now() - at < everyMs) return;
        at = Date.now();
        cb();
    };
    doc.addEventListener('visibilitychange', visible);
    return () => doc.removeEventListener('visibilitychange', visible);
}
