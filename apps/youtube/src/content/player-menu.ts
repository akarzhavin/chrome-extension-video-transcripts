import { msg as i18nMsg } from '@video-transcripts/shared';
import { BaseVttApp } from './app-base';

// Localized UI string; see the identical helper in index.ts for why this
// delegates rather than calling chrome.i18n directly.
function t(key: string, fallback: string): string {
    return i18nMsg(key, fallback);
}

const ANCHOR_CLASS = 'vtt-ytp-anchor';
const BTN_ID = 'vtt-ytp-overlay-btn';
const CC_BTN_ID = 'vtt-ytp-cc-btn';
const MENU_ID = 'vtt-ytp-menu';

// The bar autohides after ~3s idle and the menu lives INSIDE it, so it would
// fade out mid-interaction. YouTube's own menus keep it up by calling the
// player's wakeUpControls(), which restarts the autohide timer from the inside;
// page-script.ts relays this since the player API lives in the MAIN world.
// Re-poked on an interval because a single wake only buys one timeout.
const WAKE_MS = 2000;

interface AuthStatus {
    signedIn: boolean;
    email?: string;
    inboxCount?: number;
}

function sendMessage<T>(message: object): Promise<T> {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(message, (res) => {
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

// Back arrow (submenu only — forward chevrons on rows read as clutter).
const BACK_ARROW =
    '<svg class="vtt-ytp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const CHECK =
    '<svg class="vtt-ytp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
// YouTube's caption glyph, path lifted verbatim from .ytp-subtitles-button.
const CC_PATH =
    'M21.20 3.01L21 3H3L2.79 3.01C2.30 3.06 1.84 3.29 1.51 3.65C1.18 4.02 .99 4.50 1 5V19L1.01 19.20C1.05 19.66 1.26 20.08 1.58 20.41C1.91 20.73 2.33 20.94 2.79 20.99L3 21H21L21.20 20.98C21.66 20.94 22.08 20.73 22.41 20.41C22.73 20.08 22.94 19.66 22.99 19.20L23 19V5C23.00 4.50 22.81 4.02 22.48 3.65C22.15 3.29 21.69 3.06 21.20 3.01ZM3 19V5H21V19H3ZM8 11H6C5.73 11 5.48 11.10 5.29 11.29C5.10 11.48 5 11.73 5 12C5 12.26 5.10 12.51 5.29 12.70C5.48 12.89 5.73 13 6 13H8C8.26 13 8.51 12.89 8.70 12.70C8.89 12.51 9 12.26 9 12C9 11.73 8.89 11.48 8.70 11.29C8.51 11.10 8.26 11 8 11ZM18 11H12C11.73 11 11.48 11.10 11.29 11.29C11.10 11.48 11 11.73 11 12C11 12.26 11.10 12.51 11.29 12.70C11.48 12.89 11.73 13 12 13H18C18.26 13 18.51 12.89 18.70 12.70C18.89 12.51 19 12.26 19 12C19 11.73 18.89 11.48 18.70 11.29C18.51 11.10 18.26 11 18 11ZM18 15H16C15.73 15 15.48 15.10 15.29 15.29C15.10 15.48 15 15.73 15 16C15 16.26 15.10 16.51 15.29 16.70C15.48 16.89 15.73 17 16 17H18C18.26 17 18.51 16.89 18.70 16.70C18.89 16.51 19 16.26 19 16C19 15.73 18.89 15.48 18.70 15.29C18.51 15.10 18.26 15 18 15ZM12 15H6C5.73 15 5.48 15.10 5.29 15.29C5.10 15.48 5 15.73 5 16C5 16.26 5.10 16.51 5.29 16.70C5.48 16.89 5.73 17 6 17H12C12.26 17 12.51 16.89 12.70 16.70C12.89 16.51 13 16.26 13 16C13 15.73 12.89 15.48 12.70 15.29C12.51 15.10 12.26 15 12 15Z';

// Off is YouTube's outline glyph; on INVERTS it — a filled plate with the
// caption lines knocked clean through, frame kept.
//
// Copying YouTube's own on/off (opacity 0.3 → 1 on one path) isn't an option:
// their active state leans on a red indicator bar under the button, and the
// modern "delhi" player disables even that
// (.ytp-delhi-modern … .ytp-button[aria-pressed]::after { display: none }).
// That leaves brightness as their only difference, which reads as almost no
// change at all. We invert instead — same glyph, unmistakable difference.
//
// The invert is ONE shape: a rounded plate followed by the glyph path, with
// fill-rule="evenodd" so every overlap becomes a hole. The lines are therefore
//真 transparent, showing the video through — no mask (whose black knockout path
// inherits any opacity applied to the svg, silently filling the holes back in)
// and no fake backdrop colour (the control bar is translucent over video).
// The glyph is six subpaths: [0] the outer contour, [1] the frame's inner edge,
// [2..] the four caption lines.
const CC_SUBPATHS = CC_PATH.split(/(?<=[Zz])/).map(s => s.trim()).filter(Boolean);
// Inverted: fill the glyph's OWN outer contour and knock out only the caption
// lines. Using the real contour (rather than a rect drawn to match) is what
// keeps the rounded corners — evenodd would subtract the frame band from any
// plate of our own, eating its corners and leaving square ones.
const CC_INVERTED = `${CC_SUBPATHS[0]} ${CC_SUBPATHS.slice(2).join(' ')}`;

const CC_ICON =
    `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
    // Off: the outline, exactly YouTube's glyph.
    `<path class="vtt-ytp-cc-glyph" fill="currentColor" d="${CC_PATH}"/>` +
    // On: the inverse. Only one of the two is ever visible — the outline drawn
    // over this one would fill its knocked-out lines straight back in.
    `<path class="vtt-ytp-cc-fill" fill="currentColor" fill-rule="evenodd" d="${CC_INVERTED}"/>` +
    `</svg>`;

type ModeKey = 'single' | 'dual' | 'guess';

// Rows are menuitems: role="menu" only maps to a real menu for assistive tech if
// its children carry menuitem roles, and a roving tabindex (one -1 by default,
// the active row promoted to 0) is what makes arrow keys — not Tab — the way
// through it, the way YouTube's own menus behave.
function row(id: string, className = '', role = 'menuitem'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = `vtt-ytp-row ${className}`.trim();
    btn.setAttribute('role', role);
    btn.tabIndex = -1;
    return btn;
}

/**
 * The menu behind the mascot button in YouTube's player controls.
 *
 * Anchored by containment: the menu is a child of a wrapper that also holds the
 * button, and .ytp-right-controls lives inside #movie_player — which IS
 * YouTube's fullscreen element. So the menu is inside the fullscreen element in
 * both states, needing no re-parenting, no coordinate math, and no
 * fullscreenchange plumbing (contrast SidebarUI.setupFullscreenHandling).
 *
 * State is read from AppState on open rather than mirrored continuously: the
 * menu only exists while open, so SidebarUI.elements (one reference per
 * control) stays untouched, and every action writes through the sidebar's own
 * methods, which keep it the single source of truth.
 */
class PlayerMenu {
    private anchor: HTMLDivElement;
    private btn: HTMLButtonElement;
    private ccBtn: HTMLButtonElement;
    private menu: HTMLDivElement;
    private accountRow!: HTMLButtonElement;
    private accountLabel!: HTMLSpanElement;
    private statusEl!: HTMLButtonElement;
    private statusLabel!: HTMLSpanElement;
    private statusAction!: HTMLSpanElement;
    private onboardRow!: HTMLButtonElement;
    private modesRow!: HTMLButtonElement;
    private modesValue!: HTMLSpanElement;
    private overlayRow!: HTMLButtonElement;
    private panelRow!: HTMLButtonElement;
    private panelLabel!: HTMLSpanElement;
    private downloadRow!: HTMLButtonElement;
    private settingsRow!: HTMLButtonElement;
    private modeBtns: Record<ModeKey, HTMLButtonElement>;
    private unsubscribeRefresh: (() => void) | null = null;
    private wakeTimer: number | null = null;
    private cooldownTimer: number | null = null;

    constructor(private app: BaseVttApp, btn: HTMLButtonElement) {
        this.btn = btn;
        this.anchor = document.createElement('div');
        this.anchor.className = ANCHOR_CLASS;

        // The overlay toggle gets its own bar control in ADDITION to its menu
        // row: it's the one thing wanted mid-video, and a CC glyph next to
        // YouTube's own says what it does without a word of explanation.
        this.ccBtn = document.createElement('button');
        this.ccBtn.id = CC_BTN_ID;
        this.ccBtn.className = 'vtt-ytp-cc-btn';
        this.ccBtn.type = 'button';
        this.ccBtn.innerHTML = CC_ICON;
        this.ccBtn.setAttribute('role', 'switch');
        this.ccBtn.title = `${t('ytMenuOverlay', 'Subtitles on video')} (Shift+O)`;
        this.ccBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.ui.toggleOverlay();
            this.renderCc();
        });

        this.menu = document.createElement('div');
        this.menu.id = MENU_ID;
        this.menu.hidden = true;
        this.menu.dataset.page = 'root';
        this.menu.setAttribute('role', 'menu');
        this.menu.setAttribute('aria-label', t('ytMenuLabel', 'Lingogram menu'));

        this.menu.appendChild(this.buildRootPage());
        const { page, buttons } = this.buildModesPage();
        this.menu.appendChild(page);
        this.modeBtns = buttons;

        // Any click that reaches the player toggles play/pause (and a double
        // click goes fullscreen), so the whole menu swallows clicks — not just
        // the rows that do something.
        this.menu.addEventListener('click', (e) => e.stopPropagation());
        // YouTube binds f/k/m/arrows at the document level; without this,
        // arrow-navigating the menu seeks the video.
        this.menu.addEventListener('keydown', (e) => {
            e.stopPropagation();
            this.onKeyDown(e);
        });

        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        this.btn.setAttribute('aria-haspopup', 'menu');
        this.btn.setAttribute('aria-expanded', 'false');
        this.btn.removeAttribute('aria-pressed'); // it opens a menu now, not a toggle
    }

    /**
     * Wrap the button in the anchor and hand it back for insertion into the
     * bar. The pair reads as one unit: mascot = whose it is + everything else,
     * CC = the on/off everyone wants mid-video.
     */
    mount(): HTMLDivElement {
        this.btn.replaceWith(this.anchor);
        this.anchor.append(this.btn, this.ccBtn);
        // The menu hangs off #movie_player, NOT off its button — exactly where
        // YouTube puts its own settings menu (a direct child at z-index 2300,
        // positioned right:12px bottom:62px rather than anchored to the gear).
        // Nesting it in the bar traps it inside .ytp-chrome-bottom's z-index:59
        // stacking context, where our 2147483647 counts for nothing outside it
        // and the subtitle overlay (z-index:1000) paints straight over the menu.
        // #movie_player is still the fullscreen element, so containment — and
        // with it the no-re-parenting property — survives.
        (document.getElementById('movie_player') ?? this.anchor).appendChild(this.menu);
        this.renderCc();
        // The CC button is in the bar permanently, so unlike the menu it must
        // track state even while nothing is open: Shift+O, or a track finally
        // loading (which un-disables it), both arrive this way.
        this.unsubscribeRefresh = this.app.ui.onRefresh(() => {
            this.renderCc();
            if (!this.menu.hidden) this.render();
        });
        return this.anchor;
    }

    /** Drop the state subscription when a bar rebuild orphans this instance. */
    destroy(): void {
        this.close();
        this.unsubscribeRefresh?.();
        this.unsubscribeRefresh = null;
        // The menu hangs off #movie_player rather than the anchor, so a rebuilt
        // control bar doesn't take it with it — remove it or they pile up.
        this.menu.remove();
    }

    private buildRootPage(): HTMLDivElement {
        const page = document.createElement('div');
        page.className = 'vtt-ytp-page';
        page.dataset.page = 'root';

        // Account first: it's the row that answers "am I saving anything?".
        this.accountRow = row('vtt-ytp-menu-account', 'vtt-ytp-row--account');
        this.accountLabel = document.createElement('span');
        this.accountLabel.className = 'vtt-ytp-row-label';
        this.accountRow.appendChild(this.accountLabel);
        this.accountRow.addEventListener('click', () => void this.onAccountClick());
        page.appendChild(this.accountRow);

        // One line carries the whole subtitle-health story, and doubles as the
        // retry when there's something to retry — a separate "Search again"
        // button would be a second row for a state that's usually absent.
        this.statusEl = row('vtt-ytp-menu-status', 'vtt-ytp-row--status');
        this.statusLabel = document.createElement('span');
        this.statusLabel.className = 'vtt-ytp-row-label';
        this.statusEl.appendChild(this.statusLabel);
        this.statusAction = document.createElement('span');
        this.statusAction.className = 'vtt-ytp-status-action';
        this.statusAction.textContent = '↻';
        this.statusEl.appendChild(this.statusAction);
        this.statusEl.hidden = true;
        this.statusEl.addEventListener('click', () => {
            if (this.statusEl.disabled) return;
            this.app.retrySubtitleSearch();
            this.render();
        });
        page.appendChild(this.statusEl);

        // First run: with no languages picked there's nothing on screen, so a
        // mode picker and an overlay switch would be levers attached to
        // nothing. The sidebar already owns the language onboarding — send the
        // user there rather than building a second way to write lang.v1.
        this.onboardRow = row('vtt-ytp-menu-onboard', 'vtt-ytp-row--primary');
        this.onboardRow.textContent = t('ytMenuChooseLanguages', 'Choose languages');
        this.onboardRow.hidden = true;
        this.onboardRow.addEventListener('click', () => {
            this.app.ui.openPanel();
            this.close();
        });
        page.appendChild(this.onboardRow);

        // Value on the right states the current mode, so the row explains
        // itself without opening (YouTube's own "Quality  1080p" pattern).
        this.modesRow = row('vtt-ytp-menu-modes');
        this.modesRow.setAttribute('aria-haspopup', 'menu');
        const modesLabel = document.createElement('span');
        modesLabel.className = 'vtt-ytp-row-label';
        modesLabel.textContent = t('ytMenuModes', 'Mode');
        this.modesValue = document.createElement('span');
        this.modesValue.className = 'vtt-ytp-row-value';
        this.modesRow.append(modesLabel, this.modesValue);
        this.modesRow.addEventListener('click', () => this.showPage('modes'));
        page.appendChild(this.modesRow);

        // On-screen captions as a menu row too. The CC button beside the
        // mascot stays — it's the mid-video reach — but the menu is where the
        // rest of the controls live, and a labeled switch here names the
        // feature for anyone who never guessed what the CC glyph toggles.
        this.overlayRow = row('vtt-ytp-menu-overlay', 'vtt-ytp-row--switch', 'menuitemcheckbox');
        const overlayLabel = document.createElement('span');
        overlayLabel.className = 'vtt-ytp-row-label';
        overlayLabel.textContent = t('ytMenuOverlay', 'Subtitles on video');
        const overlaySwitch = document.createElement('span');
        overlaySwitch.className = 'vtt-ytp-switch';
        overlaySwitch.setAttribute('aria-hidden', 'true');
        this.overlayRow.append(overlayLabel, overlaySwitch);
        this.overlayRow.addEventListener('click', () => {
            this.app.ui.toggleOverlay();
            // The menu stays open: a switch answers in place, and the result
            // is visible on the video right behind it.
            this.render();
        });
        page.appendChild(this.overlayRow);

        this.panelRow = row('vtt-ytp-menu-panel');
        this.panelLabel = document.createElement('span');
        this.panelLabel.className = 'vtt-ytp-row-label';
        this.panelRow.appendChild(this.panelLabel);
        this.panelRow.addEventListener('click', () => {
            this.app.ui.toggleCollapsed();
            this.close();
        });
        page.appendChild(this.panelRow);

        // Downloading the transcript is an action on THIS video, so it sits with
        // the other video actions rather than under Settings — and it is one
        // click deep, so it is a row, not a submenu. Main track only, matching
        // the sidebar's header button: the translation half is the crutch, not
        // the thing anyone takes away to study.
        this.downloadRow = row('vtt-ytp-menu-download');
        const downloadLabel = document.createElement('span');
        downloadLabel.className = 'vtt-ytp-row-label';
        downloadLabel.textContent = t('ytDownloadSubs', 'Download subtitles');
        this.downloadRow.appendChild(downloadLabel);
        this.downloadRow.addEventListener('click', () => {
            if (this.downloadRow.disabled) return;
            this.app.ui.downloadTrack();
            // Closes, unlike the switches above: the result of this row is a
            // file in the downloads bar, not something visible behind the menu.
            this.close();
        });
        page.appendChild(this.downloadRow);

        this.settingsRow = row('vtt-ytp-menu-settings');
        const settingsLabel = document.createElement('span');
        settingsLabel.className = 'vtt-ytp-row-label';
        settingsLabel.textContent = t('ytMenuSettings', 'Settings');
        this.settingsRow.appendChild(settingsLabel);
        this.settingsRow.addEventListener('click', () => {
            this.app.ui.openSettings();
            this.close();
        });
        page.appendChild(this.settingsRow);

        return page;
    }

    private buildModesPage(): { page: HTMLDivElement; buttons: Record<ModeKey, HTMLButtonElement> } {
        const page = document.createElement('div');
        page.className = 'vtt-ytp-page';
        page.dataset.page = 'modes';

        const back = row('vtt-ytp-mm-back', 'vtt-ytp-row--back');
        back.insertAdjacentHTML('afterbegin', BACK_ARROW);
        const backLabel = document.createElement('span');
        backLabel.className = 'vtt-ytp-row-label';
        backLabel.textContent = t('ytMenuModes', 'Mode');
        back.appendChild(backLabel);
        back.setAttribute('aria-label', t('ytMenuBack', 'Back'));
        back.addEventListener('click', () => this.showPage('root'));
        page.appendChild(back);

        // "group", not "radiogroup": the rows are menuitemradio now, and a
        // radiogroup may only contain plain radios. group is the role that
        // legally gathers menuitemradios inside a menu and still gives the set
        // a name.
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', t('ytMenuModes', 'Mode'));

        const make = (key: ModeKey, label: string, shortcut?: string): HTMLButtonElement => {
            // menuitemradio, not radio: inside a menu the radio role is invalid
            // (it wants a radiogroup parent that is not itself in a menu), and
            // it costs nothing — aria-checked works identically on both.
            const btn = row(`vtt-ytp-mm-${key}`, 'vtt-ytp-row--radio', 'menuitemradio');
            btn.setAttribute('aria-checked', 'false');
            btn.insertAdjacentHTML('afterbegin', CHECK);
            const text = document.createElement('span');
            text.className = 'vtt-ytp-row-label';
            text.textContent = label;
            btn.appendChild(text);
            if (shortcut) {
                const key_ = document.createElement('span');
                key_.className = 'vtt-ytp-row-key';
                key_.textContent = shortcut;
                btn.appendChild(key_);
            }
            btn.addEventListener('click', () => this.pickMode(key));
            group.appendChild(btn);
            return btn;
        };

        const buttons: Record<ModeKey, HTMLButtonElement> = {
            single: make('single', t('ytMenuModeSingle', 'Original only')),
            dual: make('dual', t('ytMenuModeDual', 'Both languages'), 'Shift+D'),
            guess: make('guess', t('ytMenuModeGuess', 'Guess the word'), 'Shift+G'),
        };
        page.appendChild(group);
        return { page, buttons };
    }

    private currentMode(): ModeKey {
        const mode = this.app.state.displayMode;
        return mode === 'dual' || mode === 'guess' ? mode : 'single';
    }

    private pickMode(key: ModeKey): void {
        this.app.ui.setMode(key);
        this.showPage('root');
        this.render();
    }

    private async onAccountClick(): Promise<void> {
        const signedIn = this.accountRow.dataset.signedIn === 'true';
        this.close();
        try {
            // `from` only rides along on the sign-in branch — it labels which
            // surface converted, and OPEN_LINGOGRAM isn't a sign-in.
            await sendMessage(
                signedIn
                    ? { action: 'OPEN_LINGOGRAM' }
                    : { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'player_menu' },
            );
        } catch (e) {
            console.warn('[Lingogram] menu account action failed', e);
        }
    }

    private showPage(page: 'root' | 'modes'): void {
        const from = this.menu.dataset.page;
        this.menu.dataset.page = page;
        // Follow the user across: the page they came from is gone, so leaving
        // focus on its row would strand it on a display:none node. Only when the
        // menu is already open and the page actually changed — open() calls this
        // to reset to root before the menu is on screen, and focusing then would
        // yank focus out of the video for a menu nobody opened yet.
        if (!this.menu.hidden && from !== page) this.focusItem(this.activeItems()[0]);
    }

    // The CC button lives in the bar, so unlike the menu it's on screen all the
    // time and must stay honest on its own. Disabled when there's nothing to
    // show — no languages picked, or no track for this video — because an
    // enabled switch that changes nothing visible is exactly the "I clicked and
    // nothing happened" the menu was built to fix.
    private renderCc(): void {
        const usable = this.app.langPrefs != null && this.app.state.tracks.length > 0;
        this.ccBtn.disabled = !usable;
        const on = usable && this.app.state.overlayEnabled;
        this.ccBtn.classList.toggle('vtt-ytp-cc-btn--on', on);
        this.ccBtn.setAttribute('aria-checked', String(on));
        // fill-opacity is CSS's job (keyed off --on / :disabled / :hover). Setting
        // the presentation attribute here too would fight those rules — a dimmed
        // button stuck at 0.3 through hover was exactly that bug.
    }

    private render(): void {
        this.renderCc();
        const mode = this.currentMode();
        const labels: Record<ModeKey, string> = {
            single: t('ytMenuModeSingle', 'Original only'),
            dual: t('ytMenuModeDual', 'Both languages'),
            guess: t('ytMenuModeGuess', 'Guess the word'),
        };
        this.modesValue.textContent = labels[mode];
        (Object.keys(this.modeBtns) as ModeKey[]).forEach((key) => {
            this.modeBtns[key].setAttribute('aria-checked', String(key === mode));
        });
        // Dual needs a second track to have anything to show.
        this.modeBtns.dual.disabled = !this.app.state.hasMultipleTracks();

        this.panelLabel.textContent = this.app.ui.isCollapsed()
            ? t('ytMenuOpenPanel', 'Show panel')
            : t('ytMenuHidePanel', 'Hide panel');

        // Without languages nothing renders at all, so a mode picker would be a
        // lever attached to nothing — hide it and offer the one action that
        // helps. Subtitle health isn't the problem yet at that point.
        const noLangs = this.app.langPrefs == null;
        const noSubs = !noLangs && this.app.state.tracks.length === 0;

        this.onboardRow.hidden = !noLangs;
        this.modesRow.hidden = noLangs;
        this.overlayRow.hidden = noLangs;
        this.panelRow.hidden = noLangs;
        this.downloadRow.hidden = noLangs;
        this.settingsRow.hidden = noLangs;

        // With no track, the modes are levers attached to nothing too — but the
        // row still says which mode is armed for when one arrives.
        this.modesRow.disabled = noSubs;
        // Same predicate as the CC button in renderCc: with nothing to show,
        // an enabled switch that changes nothing visible is a lie.
        this.overlayRow.disabled = noSubs;
        this.overlayRow.setAttribute(
            'aria-checked',
            String(!noLangs && !noSubs && this.app.state.overlayEnabled),
        );

        // Nothing loaded yet: the row stays put and goes quiet rather than
        // vanishing, so the menu's shape doesn't shift as tracks arrive.
        this.downloadRow.disabled = !this.app.ui.canDownload();

        this.renderStatus(noLangs, noSubs);
    }

    // Three outcomes worth distinguishing, and the reason the old blanket "No
    // subtitles" was wrong: finding one language but not the other is a NORMAL
    // result (plenty of videos caption the spoken language only), not a failure
    // to retry. Saying "no subtitles" while subtitles are visibly playing reads
    // as broken.
    private renderStatus(noLangs: boolean, noSubs: boolean): void {
        if (noLangs) {
            this.statusEl.hidden = true;
            return;
        }
        const { state } = this.app;
        const missingNative = state.hasLearningTrack() && !state.hasNativeTrack();

        if (noSubs) {
            this.statusEl.hidden = false;
            this.statusEl.disabled = false;
            this.statusLabel.textContent = t('ytMenuNoSubtitles', 'No subtitles for this video');
            this.statusAction.hidden = false;
            this.statusEl.classList.remove('vtt-ytp-row--status-info');
            // Retrying is the normal recovery path (the sidebar banner offers
            // the same); the whole row is the button, so no extra row.
            this.statusEl.title = t('ytSearchAgain', 'Search again');
            return;
        }

        // Throttled rather than absent: the translation exists, YouTube just
        // refused to serve it. Retrying can work, so unlike the branch below
        // this row is actionable — but it stays a quiet info row, because the
        // other track is playing fine and this must not interrupt watching.
        // 'not-offered' keeps the original "no translation exists" wording
        // below; everything else here is a load failure the user can retry.
        // Shared predicate, not a hand-listed set — this line used to omit
        // no-pot and network, so those states claimed no translation existed
        // while the sidebar offered a retry for the very same failure.
        if (missingNative && this.app.isRecoverableFailure()) {
            const remaining = this.app.cooldownRemainingMs();
            this.statusEl.hidden = false;
            this.statusEl.classList.add('vtt-ytp-row--status-info');
            if (remaining > 0) {
                this.statusEl.disabled = true;
                this.statusLabel.textContent = t(
                    'ytMenuThrottledWait',
                    'Translation limited by YouTube — retry in {s}s',
                ).replace('{s}', String(Math.ceil(remaining / 1000)));
                this.statusAction.hidden = true;
                this.statusEl.removeAttribute('title');
            } else {
                this.statusEl.disabled = false;
                this.statusLabel.textContent = t(
                    'ytMenuThrottled',
                    'Translation limited by YouTube — tap to retry',
                );
                this.statusAction.hidden = false;
                this.statusEl.title = t('ytSearchAgain', 'Search again');
            }
            return;
        }

        if (missingNative) {
            this.statusEl.hidden = false;
            // Nothing to retry: the track genuinely doesn't exist. Stating it is
            // the point — the user should know why the translation half is
            // blank, and that it isn't a bug.
            this.statusEl.disabled = true;
            this.statusLabel.textContent = t('ytMenuNoTranslation', 'No subtitles in your language — original only');
            this.statusAction.hidden = true;
            this.statusEl.classList.add('vtt-ytp-row--status-info');
            this.statusEl.removeAttribute('title');
            return;
        }

        this.statusEl.hidden = true;
    }

    private async renderAccount(): Promise<void> {
        // AUTH_STATUS is a round-trip to the service worker, which may be
        // asleep. Show the sign-in prompt meanwhile rather than a blank row —
        // it's the honest default, and the common case for anyone who'd care.
        if (!this.accountRow.dataset.signedIn) {
            this.accountLabel.textContent = t('ytSignInToSave', 'Sign in to save words');
        }
        try {
            const status = await sendMessage<AuthStatus>({ action: 'AUTH_STATUS' });
            const signedIn = !!status?.signedIn;
            this.accountRow.dataset.signedIn = String(signedIn);
            const words = t('ytWordsSaved', '{count} words saved').replace('{count}', String(status.inboxCount ?? 0));
            this.accountLabel.textContent = signedIn
                ? `${status.email ?? ''} · ${words}`
                : t('ytSignInToSave', 'Sign in to save words');
        } catch {
            // Service worker unreachable — leave the sign-in prompt showing.
        }
    }

    private toggle(): void {
        if (this.menu.hidden) this.open();
        else this.close();
    }

    private open(): void {
        // A submenu is transient state, not a place to come back to.
        this.showPage('root');
        this.menu.hidden = false;
        this.btn.setAttribute('aria-expanded', 'true');
        this.anchor.classList.add('vtt-ytp-menu-open');
        this.render();
        // After render(): it decides which rows exist this open (status and
        // onboard come and go), so the first row isn't known until it has run.
        // Focus goes INTO the menu — an opened menu the keyboard can't reach is
        // the half that was missing; onEscape already hands focus back.
        this.focusItem(this.activeItems()[0]);
        void this.renderAccount();
        const wake = (): void => window.postMessage({ type: 'YT_WAKE_CONTROLS' }, '*');
        wake();
        this.wakeTimer = window.setInterval(wake, WAKE_MS);
        // Tick the rate-limit countdown in the status row. Only while the menu
        // is open — nobody can read a countdown they can't see.
        this.cooldownTimer = window.setInterval(() => {
            if (this.app.cooldownRemainingMs() > 0) this.render();
        }, 1000);
    }

    close(): void {
        if (this.menu.hidden) return;
        this.menu.hidden = true;
        this.btn.setAttribute('aria-expanded', 'false');
        this.anchor.classList.remove('vtt-ytp-menu-open');
        if (this.wakeTimer !== null) {
            clearInterval(this.wakeTimer);
            this.wakeTimer = null;
        }
        if (this.cooldownTimer !== null) {
            clearInterval(this.cooldownTimer);
            this.cooldownTimer = null;
        }
    }

    /** The rows a keyboard can reach on the page that's showing. */
    private activeItems(): HTMLButtonElement[] {
        const page = this.menu.querySelector<HTMLDivElement>(
            `.vtt-ytp-page[data-page="${this.menu.dataset.page}"]`);
        if (!page) return [];
        return [...page.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')]
            // hidden rows are real here (the status/onboard rows come and go),
            // and a disabled row is skipped like YouTube skips its own.
            .filter((el) => !el.hidden && !el.disabled);
    }

    // Roving tabindex: exactly one row is tabbable at a time, and it's the one
    // with focus. Tab then leaves the menu instead of walking it — arrows walk.
    private focusItem(item: HTMLButtonElement | undefined): void {
        if (!item) return;
        for (const el of this.activeItems()) el.tabIndex = el === item ? 0 : -1;
        item.focus();
    }

    private moveFocus(delta: 1 | -1): void {
        const items = this.activeItems();
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        // Wrap, and treat "focus isn't in the menu yet" as starting before the
        // first row, so ArrowDown enters at the top and ArrowUp at the bottom.
        const next = i === -1
            ? (delta === 1 ? 0 : items.length - 1)
            : (i + delta + items.length) % items.length;
        this.focusItem(items[next]);
    }

    private onKeyDown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'Escape':
                this.onEscape();
                return;
            case 'ArrowDown':
                e.preventDefault();
                this.moveFocus(1);
                return;
            case 'ArrowUp':
                e.preventDefault();
                this.moveFocus(-1);
                return;
            case 'Home':
                e.preventDefault();
                this.focusItem(this.activeItems()[0]);
                return;
            case 'End': {
                e.preventDefault();
                const items = this.activeItems();
                this.focusItem(items[items.length - 1]);
                return;
            }
            // Left closes a submenu the way Escape does — the arrow that opened
            // the way in (Right, on the Mode row) is the arrow that backs out.
            case 'ArrowLeft':
                if (this.menu.dataset.page === 'modes') {
                    e.preventDefault();
                    this.onEscape();
                }
                return;
            case 'ArrowRight':
                if (document.activeElement === this.modesRow) {
                    e.preventDefault();
                    this.showPage('modes');
                }
                return;
        }
    }

    // Stepwise: a submenu returns to the root, the root closes. Collapsing
    // everything at once would lose the way back.
    private onEscape(): void {
        if (this.menu.dataset.page === 'modes') {
            this.showPage('root');
            this.modesRow.focus();
            return;
        }
        this.close();
        this.btn.focus();
    }

    handleOutsideClick(target: Node): void {
        // Both must be checked: the menu no longer lives inside the anchor, so
        // an anchor-only test would close it the moment you clicked a row.
        if (!this.anchor.contains(target) && !this.menu.contains(target)) this.close();
    }
}

let current: PlayerMenu | null = null;
let retryTimer: number | null = null;

// Injects the mascot button + its menu into YouTube's own control bar
// (.ytp-right-controls, alongside CC/settings/fullscreen). Idempotent and
// self-healing: safe to call repeatedly, re-inserts if YouTube tears down and
// rebuilds the control bar (SPA navigation), no-ops once present.
export function installPlayerMenu(app: BaseVttApp): void {
    // A control bar that's gone (SPA navigation to a player-less page) orphans
    // the previous instance just as surely as a rebuilt one does — and unlike a
    // rebuild there's no re-insert to carry the teardown, so it has to happen
    // here or the subscription paints a detached button forever.
    if (current && !document.getElementById(BTN_ID)) {
        current.destroy();
        current = null;
    }

    const tryInsert = (): boolean => {
        if (document.getElementById(BTN_ID)) return true;
        // Not ours to draw (a second copy owns the UI) — but ownership can
        // resolve later, so this is "not yet", not "done". Reporting success
        // here would retire the retry and the button would never appear.
        if (!app.uiOwned) return false;

        const controls = document.querySelector('.ytp-right-controls');
        if (!controls) return false;

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        // Deliberately NOT YouTube's own ytp-button class — this custom class
        // is self-sufficient (size/hover/active all defined in styles.css)
        // and avoids any chance of inheriting YouTube's own delegated
        // tooltip/hover JS meant for its own buttons.
        btn.className = 'vtt-ytp-overlay-btn';
        btn.type = 'button';
        // Name the brand in the tooltip: among YouTube's own controls, an
        // unlabeled glyph gives no clue whose it is or what it does.
        btn.title = t('ytMenuLabel', 'Lingogram menu');
        // The mascot itself, not a generic glyph — it's the same mark the user
        // already knows from the Chrome toolbar, so the button reads as "this
        // is that extension" at a glance. Colour = overlay on, greyscale = off
        // (CSS), which updateControls() keeps in sync.
        const img = document.createElement('img');
        img.src = chrome.runtime.getURL('src/assets/icons/player-btn.png');
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);

        // Insert as a sibling of the CC button specifically — YouTube nests the
        // control row a level deeper in some layouts (e.g. an
        // .ytp-right-controls-left wrapper), so .ytp-right-controls itself
        // isn't always the CC button's direct parent.
        const ccBtn = controls.querySelector('.ytp-subtitles-button');
        if (ccBtn?.parentElement) ccBtn.parentElement.insertBefore(btn, ccBtn);
        else controls.appendChild(btn); // fallback if CC button is absent this session

        // YouTube rebuilds its control bar on SPA navigation, orphaning the
        // previous instance's DOM. Drop its state subscription or every
        // navigation leaks one more listener painting a detached button.
        current?.destroy();
        const menu = new PlayerMenu(app, btn);
        menu.mount();
        current = menu;

        return true;
    };

    // Re-arming replaces the pending attempt rather than racing it: this runs on
    // every yt-navigate-finish, including the home/search/channel pages where
    // the player never appears, so an un-cleared timer per navigation would pile
    // up (same store-and-clear shape as controlsFloor.watchControlsFloor).
    if (retryTimer !== null) {
        clearInterval(retryTimer);
        retryTimer = null;
    }

    if (!tryInsert()) {
        // .ytp-right-controls may not exist yet on first script run (player
        // still mounting) — retry briefly, then give up rather than polling
        // forever on a page where it never appears.
        let attempts = 0;
        retryTimer = window.setInterval(() => {
            attempts++;
            if (tryInsert() || attempts >= 150) { // ~30s cap
                clearInterval(retryTimer!);
                retryTimer = null;
            }
        }, 200);
    }

    // Page-level listeners: registered once, they address whichever menu is
    // current, so a control-bar rebuild doesn't strand them on a dead node.
    if (!listenersInstalled) {
        listenersInstalled = true;
        document.addEventListener('mousedown', (e) => {
            if (e.target instanceof Node) current?.handleOutsideClick(e.target);
        });
        // Mirror the sidebar's transient collapse on fullscreen (SidebarUI
        // .setupFullscreenHandling): close, and persist nothing.
        document.addEventListener('fullscreenchange', () => current?.close());
        // Leaving the tab or the window drops the menu — coming back to a page
        // you left minutes ago with a menu still hanging open is a leftover,
        // not a continuation. (Idle mouse deliberately does NOT close it: the
        // menu keeps the bar awake instead, like YouTube's own menus.)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) current?.close();
        });
        window.addEventListener('blur', () => current?.close());
    }
}

let listenersInstalled = false;
