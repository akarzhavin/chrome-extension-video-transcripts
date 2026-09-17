/**
 * @jest-environment jsdom
 *
 * Retrying the mint once the ad that blocked it is over.
 *
 * The ad guard in doMintPotViaCcToggle is deliberately a "come back later": it
 * refuses to click, and leaves the video UNCLAIMED so a later attempt can still
 * mint. Trace wjZofJX0v4M (2026-09-17) is what happens when nobody comes back.
 * The mint bailed, the three tokenless attempts ran out, the verdict went to
 * "no subtitles", and the pre-roll ended seconds later with nothing watching.
 * The late-token rescue could not help either: it waits for a token the player
 * only mints when asked, and asking is precisely what the ad prevented.
 *
 * So the guard's promise needs a keeper. These tests pin its bounds, which are
 * the same ones every other retry in this codebase carries: at most one, only
 * while the video is still the one on screen, and nothing outliving a
 * navigation.
 */
import { AfterAdMint } from '../src/content/after-ad-mint';

function harness(over: { adAtStart?: boolean } = {}) {
    let adPlaying = over.adAtStart ?? true;
    const minted: string[] = [];
    let tick: (() => void) | null = null;

    const runner = new AfterAdMint({
        isAdPlaying: () => adPlaying,
        mint: (videoId) => { minted.push(videoId); },
        // Stand-in for the player-state observer; driven by hand so the tests
        // carry no timers.
        watch: (fn) => { tick = fn; return () => { tick = null; }; },
    });

    return {
        runner,
        minted,
        endAd: () => { adPlaying = false; tick?.(); },
        /** The observer fires on player changes that are not the ad ending. */
        noise: () => { tick?.(); },
        watching: () => tick !== null,
    };
}

const live = () => new AbortController();

describe('AfterAdMint', () => {
    test('the mint runs once the ad ends', () => {
        const h = harness();
        h.runner.arm({ videoId: 'vid', signal: live().signal });
        expect(h.minted).toEqual([]);

        h.endAd();

        expect(h.minted).toEqual(['vid']);
    });

    test('nothing runs while the ad is still playing', () => {
        const h = harness();
        h.runner.arm({ videoId: 'vid', signal: live().signal });

        h.noise();
        h.noise();

        expect(h.minted).toEqual([]);
    });

    test('it fires at most once', () => {
        const h = harness();
        h.runner.arm({ videoId: 'vid', signal: live().signal });

        h.endAd();
        h.noise();
        h.noise();

        expect(h.minted).toEqual(['vid']);
    });

    test('arming twice for the same video does not stack a second watcher', () => {
        const h = harness();
        h.runner.arm({ videoId: 'vid', signal: live().signal });
        h.runner.arm({ videoId: 'vid', signal: live().signal });

        h.endAd();

        expect(h.minted).toEqual(['vid']);
    });

    test('it stops watching once it has fired', () => {
        const h = harness();
        h.runner.arm({ videoId: 'vid', signal: live().signal });

        h.endAd();

        expect(h.watching()).toBe(false);
    });

    // A navigation aborts the signal; nothing may outlive the video it
    // belonged to, least of all something that clicks the player's controls.
    test('a navigation cancels the wait', () => {
        const h = harness();
        const ctl = live();
        h.runner.arm({ videoId: 'vid', signal: ctl.signal });

        ctl.abort();
        h.endAd();

        expect(h.minted).toEqual([]);
        expect(h.watching()).toBe(false);
    });

    test('arming on an already-aborted navigation does nothing at all', () => {
        const h = harness();
        const ctl = live();
        ctl.abort();

        h.runner.arm({ videoId: 'vid', signal: ctl.signal });

        expect(h.watching()).toBe(false);
        h.endAd();
        expect(h.minted).toEqual([]);
    });

    test('clear() drops the wait, as a video change must', () => {
        const h = harness();
        h.runner.arm({ videoId: 'vid', signal: live().signal });

        h.runner.clear();
        h.endAd();

        expect(h.minted).toEqual([]);
        expect(h.watching()).toBe(false);
    });

    // Arming when no ad is on screen would mean the caller misread the state;
    // firing immediately is right, and is also what makes the runner safe to
    // arm unconditionally from the mint's ad branch.
    test('an ad that is already over fires on the next player change', () => {
        const h = harness({ adAtStart: false });
        h.runner.arm({ videoId: 'vid', signal: live().signal });

        h.noise();

        expect(h.minted).toEqual(['vid']);
    });

    test('a mint that throws does not leave the watcher attached', () => {
        let tick: (() => void) | null = null;
        const runner = new AfterAdMint({
            isAdPlaying: () => false,
            mint: () => { throw new Error('player went away'); },
            watch: (fn) => { tick = fn; return () => { tick = null; }; },
        });

        runner.arm({ videoId: 'vid', signal: live().signal });
        expect(() => tick?.()).not.toThrow();
        expect(tick).toBeNull();
    });
});
