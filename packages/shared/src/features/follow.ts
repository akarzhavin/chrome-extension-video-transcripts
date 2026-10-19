// A page's side of the feature answer: when to have the worker ask (english repo spec 032).

import { notifyWorker } from '../messaging';
import { onTabReturn, REASK_MS } from '../tab-return';

const askWorker = () => notifyWorker('FEATURES_REFRESH');

/** A view opening asks at once, and again on each return to its tab, at most once a minute; returns the stop. */
export function followFeatures(doc: Document): () => void {
    askWorker();
    return onTabReturn(doc, REASK_MS, askWorker);
}
