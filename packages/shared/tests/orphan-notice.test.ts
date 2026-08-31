// The "extension updated, reload the page" notice.
//
// The bug this covers shipped silently: after an extension reload the content
// script loses its context, rezka's timeupdate handler returned early without a
// word, and the sidebar went on showing correctly-parsed subtitles that no
// longer followed the video. It read as a subtitle-selection bug for as long as
// it took to check the extension contexts.
//
// So the assertions here are about the failure being VISIBLE and the detector
// surviving the very teardown it reports — not about the markup.

import {
    isContextOrphaned,
    showOrphanNotice,
    watchForOrphanedContext,
} from '../src/content/orphan-notice';

/** A live extension context: what every healthy content script sees. */
function setLiveContext(): void {
    (global as any).chrome = {
        runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
        i18n: { getMessage: (k: string) => k },
        storage: { local: {} },
    };
}

/**
 * An orphaned context, copied from a real one measured over CDP in an
 * hdrezka tab whose extension had been rebuilt underneath it: `chrome` itself
 * survives, but runtime.id is gone and the i18n/storage namespaces are
 * undefined outright — which is why the notice cannot localize its own text.
 */
function setOrphanedContext(): void {
    (global as any).chrome = { runtime: {} };
}

// The panel's real shape, down to the one part that matters here: the notice
// mounts into the banner slot, the row right after #vtt-subheader, so a fixture
// without that anchor would pass on markup no build ever produces.
beforeEach(() => {
    document.body.innerHTML =
        '<div id="vtt-sidebar">' +
        '<div id="vtt-header"></div>' +
        '<div id="vtt-subheader"></div>' +
        '<div id="vtt-list"></div>' +
        '</div>';
    setLiveContext();
    jest.useFakeTimers();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('isContextOrphaned', () => {
    it('is false while the extension context is alive', () => {
        expect(isContextOrphaned()).toBe(false);
    });

    it('is true once runtime.id is gone', () => {
        setOrphanedContext();
        expect(isContextOrphaned()).toBe(true);
    });

    // A detector that throws is a detector that never reports, and this runs in
    // a context that is actively being torn down.
    it('reports orphaned rather than throwing when chrome is missing entirely', () => {
        delete (global as any).chrome;
        expect(() => isContextOrphaned()).not.toThrow();
        expect(isContextOrphaned()).toBe(true);
    });
});

describe('showOrphanNotice', () => {
    it('renders a notice carrying a reload control', () => {
        showOrphanNotice();
        const notice = document.getElementById('vtt-orphan-notice');
        expect(notice).not.toBeNull();
        expect(notice!.querySelector('button')).not.toBeNull();
    });

    // The panel is stale and the user has to act to leave that state, so the
    // message must interrupt rather than queue behind a dead transcript.
    it('announces itself assertively to assistive tech', () => {
        showOrphanNotice();
        expect(document.getElementById('vtt-orphan-notice')!.getAttribute('role')).toBe('alert');
    });

    // Called from a timeupdate handler that fires several times a second.
    it('is idempotent', () => {
        showOrphanNotice();
        showOrphanNotice();
        showOrphanNotice();
        expect(document.querySelectorAll('#vtt-orphan-notice')).toHaveLength(1);
    });

    // The whole point: the message has to render in the state it describes,
    // where chrome.i18n is undefined and msg() would throw.
    it('renders with no chrome API available at all', () => {
        delete (global as any).chrome;
        expect(() => showOrphanNotice()).not.toThrow();
        const notice = document.getElementById('vtt-orphan-notice');
        expect(notice).not.toBeNull();
        expect(notice!.textContent).toMatch(/reload/i);
    });

    // Frames without a panel of ours (rezka injects into every iframe) must not
    // grow a stray banner.
    it('does nothing when there is no panel to mount into', () => {
        document.body.innerHTML = '';
        expect(() => showOrphanNotice()).not.toThrow();
        expect(document.getElementById('vtt-orphan-notice')).toBeNull();
    });

    // The banner slot: the row immediately after #vtt-subheader, shared with
    // #vtt-notification and #vtt-partial-notice.
    it('mounts into the banner slot, right after the sub-header', () => {
        showOrphanNotice();
        const subheader = document.getElementById('vtt-subheader')!;
        expect(subheader.nextElementSibling!.id).toBe('vtt-orphan-notice');
    });

    // Above the transcript, not inside it: #vtt-list scrolls, and a banner that
    // scrolls away with the lines it is warning about is no banner at all.
    it('sits outside the transcript list', () => {
        showOrphanNotice();
        const notice = document.getElementById('vtt-orphan-notice')!;
        expect(document.getElementById('vtt-list')!.contains(notice)).toBe(false);
        expect(notice.compareDocumentPosition(document.getElementById('vtt-list')!))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
});

describe('watchForOrphanedContext', () => {
    it('shows nothing while the context stays alive', () => {
        watchForOrphanedContext();
        jest.advanceTimersByTime(60_000);
        expect(document.getElementById('vtt-orphan-notice')).toBeNull();
    });

    // The case a paused tab lands in: no timeupdate ever fires, so polling is
    // the only thing that can notice.
    it('shows the notice after the context is torn away', () => {
        watchForOrphanedContext();
        expect(document.getElementById('vtt-orphan-notice')).toBeNull();
        setOrphanedContext();
        jest.advanceTimersByTime(5_000);
        expect(document.getElementById('vtt-orphan-notice')).not.toBeNull();
    });

    // Already dead when the script was injected — the user should not wait a
    // poll interval to be told about a state that is already true.
    it('reports immediately when the context is already gone', () => {
        setOrphanedContext();
        watchForOrphanedContext();
        expect(document.getElementById('vtt-orphan-notice')).not.toBeNull();
    });

    // The context never comes back, so the interval has nothing left to learn.
    it('stops polling once it has reported', () => {
        const clearSpy = jest.spyOn(global, 'clearInterval');
        watchForOrphanedContext();
        setOrphanedContext();
        jest.advanceTimersByTime(5_000);
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });

    it('teardown stops the poll', () => {
        const stop = watchForOrphanedContext();
        stop();
        setOrphanedContext();
        jest.advanceTimersByTime(60_000);
        expect(document.getElementById('vtt-orphan-notice')).toBeNull();
    });
});
