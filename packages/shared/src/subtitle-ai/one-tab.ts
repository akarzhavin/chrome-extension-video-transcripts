// AI translation runs in one tab at a time: the worker's side. The tab that
// starts or comes back to a translation claims it; the tab that had it is
// told to pause, and resumes by claiming again when the viewer returns to it.
// Each running translation spends AI credits, so two tabs left playing would
// spend twice for one viewer.
//
// The owner is kept in storage.session, so a worker restart does not forget
// it and let two tabs run.

const OWNER_KEY = 'aiTranslateTab';

export const CLAIM = 'SUBTITLE_AI_CLAIM' as const;
export const RELEASE = 'SUBTITLE_AI_RELEASE' as const;
/** Sent to the tab that had the translation. */
export const YIELD = 'SUBTITLE_AI_YIELD';

async function owner(): Promise<number | null> {
    try {
        const got: unknown = (await chrome.storage.session.get(OWNER_KEY))[OWNER_KEY];
        return typeof got === 'number' ? got : null;
    } catch {
        return null;
    }
}

async function setOwner(tab: number | null): Promise<void> {
    try {
        if (tab === null) await chrome.storage.session.remove(OWNER_KEY);
        else await chrome.storage.session.set({ [OWNER_KEY]: tab });
    } catch {
        /* storage gone: the next claim sets it */
    }
}

// One change at a time, so two claims arriving together cannot both see the
// old owner and both keep running.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
};

/** The tab sender now translates; the one before it, if another, is told to pause. */
export function claim(tab: number | undefined): Promise<{ ok: boolean }> {
    if (tab === undefined) return Promise.resolve({ ok: false });
    return serial(async () => {
        const before = await owner();
        await setOwner(tab);
        if (before !== null && before !== tab) {
            // A closed tab answers with an error; nothing to pause there.
            void chrome.tabs.sendMessage(before, { action: YIELD }).catch(() => undefined);
        }
        return { ok: true };
    });
}

/** The tab stopped translating; only the owner's release clears the owner. */
export function release(tab: number | undefined): Promise<{ ok: boolean }> {
    if (tab === undefined) return Promise.resolve({ ok: false });
    return serial(async () => {
        if ((await owner()) === tab) await setOwner(null);
        return { ok: true };
    });
}
