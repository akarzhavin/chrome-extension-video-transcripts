import { AppState } from './AppState';
import { SidebarElements, AppInterface } from '../common/types';

export class SidebarUI {
    state: AppState;
    app: AppInterface;
    elements: SidebarElements;

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
        toggleBtn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
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
        dualBtn.addEventListener('click', () => {
            if (this.state.toggleDualMode()) this.refresh();
        });
        controls.appendChild(dualBtn);

        const guessBtn = document.createElement('button');
        guessBtn.id = 'vtt-guess-btn';
        guessBtn.title = 'Toggle Guess Mode (Shift+G)';
        guessBtn.textContent = '🧩 Guess';
        guessBtn.addEventListener('click', () => {
            if (this.state.toggleGuessMode()) this.refresh();
        });
        controls.appendChild(guessBtn);

        const overlayBtn = document.createElement('button');
        overlayBtn.id = 'vtt-overlay-btn';
        overlayBtn.title = 'Toggle On-Screen Overlay (Shift+O)';
        overlayBtn.textContent = '📺 Overlay';
        overlayBtn.addEventListener('click', () => {
            this.state.overlayEnabled = !this.state.overlayEnabled;
            this.refresh();
        });
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

        // Hover interactions
        sidebar.addEventListener('mouseenter', () => this.state.isHovering = true);
        sidebar.addEventListener('mouseleave', () => {
            this.state.isHovering = false;
            const active = document.querySelector('.vtt-item.active-sub');
            if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        const isTopWindow = window === window.top;
        if (isTopWindow) {
            document.body.classList.add('vtt-sidebar-active');
        } else {
            sidebar.style.display = 'none';
        }

        this.setupFullscreenHandling();
        return true;
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
                    sidebar.classList.remove('collapsed');
                }
            }
        });
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
        const words = text.split(/\s+/);

        words.forEach((word, i) => {
            if (i > 0) container.appendChild(document.createTextNode(' '));
            const span = document.createElement('span');
            if (i < revealedCount) {
                span.className = 'vtt-revealed-word';
                span.textContent = word;
            } else {
                span.className = 'vtt-masked-word';
                span.textContent = '***';
            }
            container.appendChild(span);
        });

        return container;
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

        // Replace main text
        const oldMain = item.querySelector('.vtt-main-text');
        const revealedCount = this.state.getRevealedCount(index);
        const newMain = this.buildMaskedContent(mainTrack[index].text, revealedCount);
        if (oldMain) {
            item.replaceChild(newMain, oldMain);
        }

        // Add translation if fully revealed
        if (this.state.isFullyRevealed(index)) {
            item.classList.add('fully-revealed');
            if (!item.querySelector('.vtt-sub-text')) {
                const secondaryTrack = this.state.getSecondaryTrack();
                if (secondaryTrack) {
                    const sub = mainTrack[index];
                    const overlap = secondaryTrack.filter(s => s.startTime < sub.endTime && s.endTime > sub.startTime);
                    if (overlap.length > 0) {
                        const subText = document.createElement('div');
                        subText.className = 'vtt-sub-text';
                        subText.textContent = overlap.map(s => s.text).join(' | ');
                        item.appendChild(subText);
                    }
                }
            }
        }
    }

    renderSubtitles(): void {
        if (!this.elements.list) return;
        this.elements.list.innerHTML = '';
        this.state.currentIndex = -1;

        const mainTrack = this.state.getMainTrack();
        if (!mainTrack) return;

        const secondaryTrack = this.state.getSecondaryTrack();
        const df = document.createDocumentFragment();
        const isGuessMode = this.state.displayMode === 'guess';

        mainTrack.forEach((sub, index) => {
            const item = document.createElement('div');
            item.className = 'vtt-item';
            item.dataset.index = index.toString();

            if (isGuessMode) {
                const revealedCount = this.state.getRevealedCount(index);
                const mainText = this.buildMaskedContent(sub.text, revealedCount);
                item.appendChild(mainText);

                if (this.state.isFullyRevealed(index)) {
                    item.classList.add('fully-revealed');
                    if (secondaryTrack) {
                        const overlap = secondaryTrack.filter(s => s.startTime < sub.endTime && s.endTime > sub.startTime);
                        if (overlap.length > 0) {
                            const subText = document.createElement('div');
                            subText.className = 'vtt-sub-text';
                            subText.textContent = overlap.map(s => s.text).join(' | ');
                            item.appendChild(subText);
                        }
                    }
                }

                item.addEventListener('click', () => {
                    this.state.revealNextWord(index);
                    this.updateGuessItem(index);
                    this.app.seekVideo(sub.startTime);
                });
            } else {
                const mainText = document.createElement('div');
                mainText.className = 'vtt-main-text';
                mainText.textContent = sub.text;
                item.appendChild(mainText);

                if (this.state.displayMode === 'dual' && secondaryTrack) {
                    const overlap = secondaryTrack.filter(s => s.startTime < sub.endTime && s.endTime > sub.startTime);
                    if (overlap.length > 0) {
                        const subText = document.createElement('div');
                        subText.className = 'vtt-sub-text';
                        subText.textContent = overlap.map(s => s.text).join(' | ');
                        item.appendChild(subText);
                    }
                }

                item.addEventListener('click', () => this.app.seekVideo(sub.startTime));
            }

            df.appendChild(item);
        });

        this.elements.list.appendChild(df);
    }

    highlightSubtitle(currentTime: number): void {
        const mainTrack = this.state.getMainTrack();
        if (!mainTrack || !this.elements.list) return;

        let activeIndex = -1;
        for (let i = 0; i < mainTrack.length; i++) {
            if (currentTime >= mainTrack[i].startTime && currentTime <= mainTrack[i].endTime) {
                activeIndex = i;
                break;
            }
        }

        if (activeIndex !== -1 && activeIndex !== this.state.currentIndex) {
            const oldActive = this.elements.list.querySelector('.vtt-item.active-sub');
            if (oldActive) oldActive.classList.remove('active-sub');

            const newActive = this.elements.list.querySelector(`.vtt-item[data-index="${activeIndex}"]`) as HTMLDivElement | null;
            if (newActive) {
                newActive.classList.add('active-sub');
                if (!this.state.isHovering) {
                    newActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
            this.state.currentIndex = activeIndex;
            this.updateOverlay(activeIndex);
        } else if (activeIndex === -1 && this.state.currentIndex !== -1) {
            this.state.currentIndex = -1;
            this.updateOverlay(-1);
        } else if (activeIndex !== -1 && activeIndex === this.state.currentIndex) {
            this.updateOverlay(activeIndex);
        }
    }

    updateOverlay(index: number): void {
        let overlay = document.getElementById('vtt-video-overlay');
        
        if (!this.state.overlayEnabled) {
            if (overlay) overlay.style.display = 'none';
            return;
        }

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'vtt-video-overlay';
            const video = document.querySelector('video');
            if (video && video.parentElement) {
                video.parentElement.appendChild(overlay);
            } else {
                return;
            }
        }

        overlay.style.display = 'flex';

        if (index === -1) {
            overlay.innerHTML = '';
            return;
        }

        const mainTrack = this.state.getMainTrack();
        if (!mainTrack) return;
        
        const sub = mainTrack[index];
        if (!sub) return;

        overlay.innerHTML = '';

        const mainDiv = document.createElement('div');
        mainDiv.className = 'vtt-overlay-main';

        if (this.state.displayMode === 'guess') {
            const revealedCount = this.state.getRevealedCount(index);
            mainDiv.textContent = this.getMaskedText(sub.text, revealedCount);
        } else {
            mainDiv.textContent = sub.text;
        }
        overlay.appendChild(mainDiv);

        const showTranslation = this.state.displayMode === 'dual' || 
            (this.state.displayMode === 'guess' && this.state.isFullyRevealed(index));

        if (showTranslation) {
            const secondaryTrack = this.state.getSecondaryTrack();
            if (secondaryTrack) {
                const overlap = secondaryTrack.filter(s => s.startTime < sub.endTime && s.endTime > sub.startTime);
                if (overlap.length > 0) {
                    const subDiv = document.createElement('div');
                    subDiv.className = 'vtt-overlay-sub';
                    subDiv.textContent = overlap.map(s => s.text).join(' | ');
                    overlay.appendChild(subDiv);
                }
            }
        }
    }
}
