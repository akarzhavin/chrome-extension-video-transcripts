import { AppState } from './AppState';
import { loadPrefs, onPrefsChanged, savePrefs } from './prefs';
import { SidebarElements, AppInterface, Subtitle } from './types';

// Smooth-scroll budget. Jumps within this many subtitle indices animate;
// bigger jumps snap instantly so the user doesn't watch a full-list scroll.
const NEARBY_SUBTITLE_THRESHOLD = 20;

type ScrollMode = 'smooth' | 'instant';

function hasSelectionInside(el: Element): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return el.contains(sel.getRangeAt(0).commonAncestorContainer);
}

export class SidebarUI {
    state: AppState;
    app: AppInterface;
    elements: SidebarElements;
    hoverStartIndex: number = -1;

    constructor(state: AppState, app: AppInterface) {
        this.state = state;
        this.app = app;
        this.elements = {};
    }

    init(): boolean {
        if (document.getElementById('vtt-sidebar')) return false;

        const sidebar = document.createElement('div');
        sidebar.id = 'vtt-sidebar';

        // Toggle Button
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'vtt-toggle-btn';
        toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        toggleBtn.addEventListener('click', () => this.toggleCollapsed());
        sidebar.appendChild(toggleBtn);

        // Header Container
        const header = document.createElement('div');
        header.id = 'vtt-header';

        const headerTop = document.createElement('div');
        headerTop.id = 'vtt-header-top';
        headerTop.innerHTML = `<h2>Subtitles</h2>`;
        
        const settingsBtn = document.createElement('div');
        settingsBtn.id = 'vtt-settings-btn';
        settingsBtn.title = 'Settings';
        settingsBtn.style.display = 'flex'; // Always visible now
        settingsBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;
        settingsBtn.addEventListener('click', () => this.elements.settingsPanel?.classList.toggle('open'));
        headerTop.appendChild(settingsBtn);
        header.appendChild(headerTop);

        // Settings Panel
        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'vtt-settings-panel';

        const selectorsDiv = document.createElement('div');
        selectorsDiv.id = 'vtt-track-selectors';

        const mainSelect = document.createElement('select');
        mainSelect.id = 'vtt-main-select';
        mainSelect.title = 'Main Track';
        mainSelect.className = 'vtt-select';
        mainSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            this.state.activeTrackIndex = parseInt(target.value);
            this.refresh();
        });

        const subSelect = document.createElement('select');
        subSelect.id = 'vtt-sub-select';
        subSelect.title = 'Secondary Track';
        subSelect.className = 'vtt-select';
        subSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            this.state.secondaryTrackIndex = parseInt(target.value);
            this.refresh();
        });

        selectorsDiv.appendChild(mainSelect);
        selectorsDiv.appendChild(subSelect);
        settingsPanel.appendChild(selectorsDiv);

        // Controls
        const controls = document.createElement('div');
        controls.id = 'vtt-controls';

        const swapBtn = document.createElement('button');
        swapBtn.id = 'vtt-swap-btn';
        swapBtn.title = 'Swap Language (Shift+S)';
        swapBtn.textContent = '🔄 Swap';
        swapBtn.addEventListener('click', () => {
            if (this.state.swapTracks()) this.refresh();
        });
        controls.appendChild(swapBtn);

        const dualBtn = document.createElement('button');
        dualBtn.id = 'vtt-dual-btn';
        dualBtn.title = 'Toggle Dual Mode (Shift+D)';
        dualBtn.textContent = '📖 Dual';
        dualBtn.addEventListener('click', () => this.toggleDualMode());
        controls.appendChild(dualBtn);

        const guessBtn = document.createElement('button');
        guessBtn.id = 'vtt-guess-btn';
        guessBtn.title = 'Toggle Guess Mode (Shift+G)';
        guessBtn.textContent = '🧩 Guess';
        guessBtn.addEventListener('click', () => this.toggleGuessMode());
        controls.appendChild(guessBtn);

        const overlayBtn = document.createElement('button');
        overlayBtn.id = 'vtt-overlay-btn';
        overlayBtn.title = 'Toggle On-Screen Overlay (Shift+O)';
        overlayBtn.textContent = '📺 Overlay';
        overlayBtn.addEventListener('click', () => this.toggleOverlay());
        controls.appendChild(overlayBtn);

        settingsPanel.appendChild(controls);
        header.appendChild(settingsPanel);
        sidebar.appendChild(header);

        // Subtitles List
        const list = document.createElement('div');
        list.id = 'vtt-list';
        sidebar.appendChild(list);

        document.body.appendChild(sidebar);

        // Store DOM references
        this.elements = { sidebar, settingsBtn, settingsPanel, mainSelect, subSelect, dualBtn, overlayBtn, list };

        // Hover interactions. While hovering, highlightSubtitle skips scrolls
        // but still moves the active-sub class, so on mouseleave we may need to
        // catch up — compared against the snapshot taken on mouseenter.
        sidebar.addEventListener('mouseenter', () => {
            this.state.isHovering = true;
            this.hoverStartIndex = this.state.currentIndex;
        });
        sidebar.addEventListener('mouseleave', () => {
            this.state.isHovering = false;
            this.scrollActiveIntoView(this.pickScrollMode(this.state.currentIndex, this.hoverStartIndex));
        });

        const isTopWindow = window === window.top;
        if (isTopWindow) {
            document.body.classList.add('vtt-sidebar-active');
        } else {
            sidebar.style.display = 'none';
        }

        this.setupFullscreenHandling();
        this.hydrateFromPrefs();
        return true;
    }

    // Loads persisted prefs into AppState + DOM, then subscribes so cross-tab
    // changes (or popup-driven changes later) propagate in. Fire-and-forget —
    // the initial render uses defaults; the prefs swap re-renders if needed.
    private hydrateFromPrefs(): void {
        loadPrefs().then((prefs) => {
            this.state.displayMode = prefs.displayMode;
            this.state.overlayEnabled = prefs.overlayEnabled;
            this.elements.sidebar?.classList.toggle('collapsed', prefs.sidebarCollapsed);
            this.refresh();
        }).catch(() => {});

        onPrefsChanged((prefs) => {
            let changed = false;
            if (this.state.displayMode !== prefs.displayMode) {
                this.state.displayMode = prefs.displayMode;
                changed = true;
            }
            if (this.state.overlayEnabled !== prefs.overlayEnabled) {
                this.state.overlayEnabled = prefs.overlayEnabled;
                changed = true;
            }
            const sidebar = this.elements.sidebar;
            if (sidebar && sidebar.classList.contains('collapsed') !== prefs.sidebarCollapsed) {
                sidebar.classList.toggle('collapsed', prefs.sidebarCollapsed);
            }
            if (changed) this.refresh();
        });
    }

    toggleCollapsed(): void {
        const sidebar = this.elements.sidebar;
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
        savePrefs({ sidebarCollapsed: sidebar.classList.contains('collapsed') });
    }

    toggleDualMode(): void {
        if (!this.state.toggleDualMode()) return;
        this.refresh();
        savePrefs({ displayMode: this.state.displayMode });
    }

    toggleGuessMode(): void {
        if (!this.state.toggleGuessMode()) return;
        this.refresh();
        savePrefs({ displayMode: this.state.displayMode });
    }

    toggleOverlay(): void {
        this.state.overlayEnabled = !this.state.overlayEnabled;
        this.refresh();
        savePrefs({ overlayEnabled: this.state.overlayEnabled });
    }

    setupFullscreenHandling(): void {
        document.addEventListener('fullscreenchange', () => {
            const sidebar = this.elements.sidebar;
            if (!sidebar) return;

            if (document.fullscreenElement) {
                sidebar.style.display = 'flex';
                sidebar.classList.add('fullscreen');
                sidebar.classList.add('collapsed');
                document.fullscreenElement.appendChild(sidebar);
            } else {
                document.body.appendChild(sidebar);
                sidebar.classList.remove('fullscreen');
                const isTopWindow = window === window.top;
                if (!isTopWindow) {
                    sidebar.style.display = 'none';
                } else {
                    // Entering fullscreen collapses the sidebar transiently (not
                    // persisted), so the stored pref still reflects the user's
                    // last manual toggle. Restore it instead of force-opening —
                    // otherwise leaving fullscreen always re-expands a sidebar
                    // the user had deliberately collapsed.
                    loadPrefs().then((prefs) => {
                        sidebar.classList.toggle('collapsed', prefs.sidebarCollapsed);
                    }).catch(() => {});
                }
            }

            // Re-parenting resets list scroll to 0. state.currentIndex is unchanged,
            // so highlightSubtitle wouldn't re-scroll on its own — do it explicitly.
            this.scrollActiveIntoView('instant');
        });
    }

    private pickScrollMode(targetIndex: number, fromIndex: number): ScrollMode {
        if (fromIndex === -1) return 'instant';
        return Math.abs(targetIndex - fromIndex) <= NEARBY_SUBTITLE_THRESHOLD ? 'smooth' : 'instant';
    }

    private scrollActiveIntoView(mode: ScrollMode): void {
        const active = this.elements.list?.querySelector('.vtt-item.active-sub');
        active?.scrollIntoView({ behavior: mode as ScrollBehavior, block: 'center' });
    }

    private buildSecondaryTextElement(overlap: { text: string }[], className = 'vtt-sub-text'): HTMLDivElement | null {
        if (overlap.length === 0) return null;
        const div = document.createElement('div');
        div.className = className;
        div.textContent = overlap.map(s => s.text).join(' | ');
        return div;
    }

    refresh(): void {
        this.updateControls();
        this.renderSubtitles();
        this.app.updateHighlight();
    }

    updateControls(): void {
        if (!this.elements.settingsBtn || !this.elements.dualBtn || !this.elements.overlayBtn || !this.elements.mainSelect || !this.elements.subSelect) return;
        
        this.elements.settingsBtn.style.display = 'flex';
        
        const hasMultiple = this.state.hasMultipleTracks();
        this.elements.dualBtn.classList.toggle('active', this.state.displayMode === 'dual');
        this.elements.overlayBtn.classList.toggle('active', this.state.overlayEnabled);

        const guessBtn = document.getElementById('vtt-guess-btn') as HTMLButtonElement | null;
        if (guessBtn) guessBtn.classList.toggle('active', this.state.displayMode === 'guess');

        const activeId = document.activeElement?.id;
        this.elements.mainSelect.innerHTML = '';
        this.elements.subSelect.innerHTML = '';

        this.state.tracks.forEach((track, i) => {
            this.elements.mainSelect?.appendChild(new Option('Main: ' + track.name, i.toString(), false, i === this.state.activeTrackIndex));
            this.elements.subSelect?.appendChild(new Option('Sub: ' + track.name, i.toString(), false, i === this.state.secondaryTrackIndex));
        });

        this.elements.dualBtn.disabled = !hasMultiple;
        const swapBtn = document.getElementById('vtt-swap-btn') as HTMLButtonElement | null;
        if (swapBtn) swapBtn.disabled = !hasMultiple;

        if (activeId) {
            const activeEl = document.getElementById(activeId);
            if (activeEl) activeEl.focus();
        }
    }

    buildMaskedContent(text: string, revealedCount: number): HTMLElement {
        const container = document.createElement('div');
        container.className = 'vtt-main-text';
        this.fillMaskedWordsInto(container, text, revealedCount);
        return container;
    }

    // Both sidebar and on-screen overlay share this layout so the quick-add
    // selection extractor can recover the real word from data-word — even when
    // the visible glyphs are ***.
    private fillMaskedWordsInto(container: HTMLElement, text: string, revealedCount: number): void {
        const words = text.split(/\s+/);
        words.forEach((word, i) => {
            if (i > 0) container.appendChild(document.createTextNode(' '));
            container.appendChild(this.makeMaskedSpan(word, i < revealedCount));
        });
    }

    private makeMaskedSpan(word: string, revealed: boolean): HTMLSpanElement {
        const span = document.createElement('span');
        span.dataset.word = word;
        if (revealed) {
            span.className = 'vtt-revealed-word';
            span.textContent = word;
        } else {
            span.className = 'vtt-masked-word';
            span.textContent = '***';
        }
        return span;
    }

    // Non-guess subtitles still wrap each word in a span carrying data-word
    // so the quick-add selection can snap to whole-word boundaries. Inline
    // spans without a class read identically to the previous text node.
    private fillPlainWordsInto(container: HTMLElement, text: string): void {
        const words = text.split(/\s+/);
        words.forEach((word, i) => {
            if (i > 0) container.appendChild(document.createTextNode(' '));
            const span = document.createElement('span');
            span.dataset.word = word;
            span.textContent = word;
            container.appendChild(span);
        });
    }

    getMaskedText(text: string, revealedCount: number): string {
        const words = text.split(/\s+/);
        return words.map((w, i) => i < revealedCount ? w : '***').join(' ');
    }

    updateGuessItem(index: number): void {
        if (!this.elements.list) return;
        const item = this.elements.list.querySelector(`.vtt-item[data-index="${index}"]`) as HTMLDivElement | null;
        if (!item) return;

        const mainTrack = this.state.getMainTrack();
        if (!mainTrack || !mainTrack[index]) return;

        const main = item.querySelector('.vtt-main-text');
        if (!main) return;

        // Patch spans in place so an active selection inside the item survives
        // the reveal — replacing the parent would orphan the user's Range.
        const revealedCount = this.state.getRevealedCount(index);
        const spans = main.querySelectorAll<HTMLSpanElement>('span[data-word]');
        spans.forEach((span, i) => {
            const word = span.dataset.word ?? '';
            const shouldReveal = i < revealedCount;
            if (shouldReveal && !span.classList.contains('vtt-revealed-word')) {
                span.className = 'vtt-revealed-word';
                span.textContent = word;
            } else if (!shouldReveal && !span.classList.contains('vtt-masked-word')) {
                span.className = 'vtt-masked-word';
                span.textContent = '***';
            }
        });

        if (this.state.isFullyRevealed(index)) {
            item.classList.add('fully-revealed');
            if (!item.querySelector('.vtt-sub-text')) {
                const subText = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(mainTrack[index]));
                if (subText) item.appendChild(subText);
            }
        }
    }

    renderSubtitles(): void {
        if (!this.elements.list) return;
        this.elements.list.innerHTML = '';
        this.state.currentIndex = -1;

        const mainTrack = this.state.getMainTrack();
        if (!mainTrack) return;

        const isGuessMode = this.state.displayMode === 'guess';
        const df = document.createDocumentFragment();

        mainTrack.forEach((sub, index) => {
            df.appendChild(isGuessMode ? this.buildGuessItem(sub, index) : this.buildPlainItem(sub, index));
        });

        this.elements.list.appendChild(df);
    }

    private createSubtitleItem(index: number): HTMLDivElement {
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = index.toString();
        // Rapid replay-clicks would otherwise hit the browser's
        // double-click-selects-word / triple-click-selects-line behavior,
        // and the resulting selection then blocks our click→seek handler.
        // Drag-select still fires with detail === 1, so this only kills the
        // multi-click auto-selection.
        item.addEventListener('mousedown', (e) => {
            if (e.detail > 1) e.preventDefault();
        });
        return item;
    }

    private buildGuessItem(sub: Subtitle, index: number): HTMLDivElement {
        const item = this.createSubtitleItem(index);
        item.appendChild(this.buildMaskedContent(sub.text, this.state.getRevealedCount(index)));

        if (this.state.isFullyRevealed(index)) {
            item.classList.add('fully-revealed');
            const subText = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(sub));
            if (subText) item.appendChild(subText);
        }

        item.addEventListener('click', () => {
            // Drag-selecting inside the item fires this click; skip reveal/seek
            // so the quick-add pill (from selection) stays usable.
            if (hasSelectionInside(item)) return;
            this.state.revealNextWord(index);
            this.updateGuessItem(index);
            this.app.seekVideo(sub.startTime);
        });
        return item;
    }

    private buildPlainItem(sub: Subtitle, index: number): HTMLDivElement {
        const item = this.createSubtitleItem(index);

        const mainText = document.createElement('div');
        mainText.className = 'vtt-main-text';
        this.fillPlainWordsInto(mainText, sub.text);
        item.appendChild(mainText);

        if (this.state.displayMode === 'dual') {
            const subText = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(sub));
            if (subText) item.appendChild(subText);
        }

        item.addEventListener('click', () => {
            if (hasSelectionInside(item)) return;
            this.app.seekVideo(sub.startTime);
        });
        return item;
    }

    highlightSubtitle(currentTime: number): void {
        const mainTrack = this.state.getMainTrack();
        if (!mainTrack || !this.elements.list) return;

        const activeIndex = mainTrack.findIndex(s => currentTime >= s.startTime && currentTime <= s.endTime);

        if (activeIndex !== this.state.currentIndex) {
            this.moveActiveSubtitleClass(activeIndex);
            this.state.currentIndex = activeIndex;
        }
        this.updateOverlay(this.state.currentIndex);
    }

    private moveActiveSubtitleClass(newIndex: number): void {
        if (!this.elements.list) return;
        this.elements.list.querySelector('.vtt-item.active-sub')?.classList.remove('active-sub');
        if (newIndex === -1) return;

        const newActive = this.elements.list.querySelector(`.vtt-item[data-index="${newIndex}"]`) as HTMLDivElement | null;
        if (!newActive) return;

        newActive.classList.add('active-sub');
        if (!this.state.isHovering) {
            const mode = this.pickScrollMode(newIndex, this.state.currentIndex);
            newActive.scrollIntoView({ behavior: mode as ScrollBehavior, block: 'center' });
        }
    }

    updateOverlay(index: number): void {
        const existing = document.getElementById('vtt-video-overlay');

        if (!this.state.overlayEnabled) {
            if (existing) existing.style.display = 'none';
            return;
        }

        // Preserve an in-progress selection inside the overlay. timeupdate
        // ticks every ~250ms; rebuilding would destroy the user's Range.
        if (existing && hasSelectionInside(existing)) return;

        const desiredParent = this.app.getOverlayParent?.() ?? document.querySelector('video')?.parentElement ?? null;
        if (existing && desiredParent && existing.parentElement !== desiredParent) {
            existing.remove();
        }
        const overlay = document.getElementById('vtt-video-overlay') ?? this.createOverlayElement();
        if (!overlay) return; // No video to attach to yet.

        overlay.style.display = 'flex';
        overlay.innerHTML = '';

        const sub = index === -1 ? null : this.state.getMainTrack()?.[index];
        if (!sub) return;

        overlay.appendChild(this.buildOverlayMain(sub, index));
        if (this.shouldShowOverlayTranslation(index)) {
            const subDiv = this.buildSecondaryTextElement(this.state.getOverlappingSecondary(sub), 'vtt-overlay-sub');
            if (subDiv) overlay.appendChild(subDiv);
        }
    }

    private createOverlayElement(): HTMLDivElement | null {
        const parent = this.app.getOverlayParent?.() ?? document.querySelector('video')?.parentElement;
        if (!parent) return null;
        const overlay = document.createElement('div');
        overlay.id = 'vtt-video-overlay';
        parent.appendChild(overlay);
        return overlay;
    }

    private buildOverlayMain(sub: Subtitle, index: number): HTMLDivElement {
        const mainDiv = document.createElement('div');
        mainDiv.className = 'vtt-overlay-main';
        mainDiv.dataset.index = String(index);
        if (this.state.displayMode === 'guess') {
            this.fillMaskedWordsInto(mainDiv, sub.text, this.state.getRevealedCount(index));
        } else {
            this.fillPlainWordsInto(mainDiv, sub.text);
        }
        return mainDiv;
    }

    private shouldShowOverlayTranslation(index: number): boolean {
        if (this.state.displayMode === 'dual') return true;
        if (this.state.displayMode === 'guess') return this.state.isFullyRevealed(index);
        return false;
    }
}
