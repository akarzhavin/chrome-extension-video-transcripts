// Identify if we are in the top window or an iframe
const isTopWindow = window === window.top;

(() => {
    // 1. Убеждаемся, что мы на сайте rezka (или фрейм встроен в rezka)
    let isRezka = false;
    
    if (isTopWindow) {
        if (window.location.hostname.includes('rezka.ag') || window.location.hostname.includes('hdrezka')) {
            isRezka = true;
        }
    } else {
        // Проверяем родителей фрейма (Chrome-specific API, идеально для расширений)
        if (window.location.ancestorOrigins) {
            for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
                if (window.location.ancestorOrigins[i].includes('rezka.ag') || window.location.ancestorOrigins[i].includes('hdrezka')) {
                    isRezka = true;
                    break;
                }
            }
        }
    }

    if (!isRezka) {
        return; // Полностью отключаем скрипт на других сайтах
    }
    // =========================================================================
    // 1. STATE MANAGEMENT
    // =========================================================================
    class AppState {
        constructor() {
            this.tracks = []; // [{ name: "eng", data: [...] }]
            this.activeTrackIndex = 0;
            this.secondaryTrackIndex = 0;
            this.displayMode = 'single'; // 'single' | 'dual'
            this.overlayEnabled = false;
            this.currentIndex = -1;
            this.isHovering = false;
        }

        addTrack(name, data) {
            this.tracks.push({ name, data });
            if (this.tracks.length === 1) {
                this.activeTrackIndex = 0;
            } else {
                this.secondaryTrackIndex = this.activeTrackIndex;
                this.activeTrackIndex = this.tracks.length - 1;
            }
        }

        isDuplicate(newSubs) {
            return this.tracks.some(track => 
                track.data.length > 0 && 
                track.data[0].text === newSubs[0].text && 
                track.data[Math.floor(track.data.length/2)]?.text === newSubs[Math.floor(newSubs.length/2)]?.text
            );
        }

        hasMultipleTracks() {
            return this.tracks.length > 1;
        }

        swapTracks() {
            if (this.hasMultipleTracks()) {
                [this.activeTrackIndex, this.secondaryTrackIndex] = [this.secondaryTrackIndex, this.activeTrackIndex];
                return true;
            }
            return false;
        }

        toggleDualMode() {
            if (this.hasMultipleTracks()) {
                this.displayMode = this.displayMode === 'single' ? 'dual' : 'single';
                return true;
            }
            return false;
        }

        getMainTrack() {
            return this.tracks[this.activeTrackIndex]?.data || null;
        }

        getSecondaryTrack() {
            return this.hasMultipleTracks() ? this.tracks[this.secondaryTrackIndex]?.data : null;
        }
    }

    // =========================================================================
    // 2. UTILS
    // =========================================================================
    const LanguageUtils = {
        guessLanguage(subs) {
            if (!subs || subs.length === 0) return "Unknown";
            
            const sampleText = subs.slice(0, 20).map(s => s.text).join(' ');
            const cyrillicCount = (sampleText.match(/[а-яА-ЯёЁіІїЇєЄґҐ]/g) || []).length;
            const latinCount = (sampleText.match(/[a-zA-Z]/g) || []).length;
            
            if (cyrillicCount > latinCount) {
                const ukrainianCount = (sampleText.match(/[іІїЇєЄ]/g) || []).length;
                return ukrainianCount > 0 ? "Ukrainian" : "Russian";
            }
            if (latinCount > cyrillicCount && latinCount > 0) return "English";
            return "Track";
        },

        generateTrackName(subs, existingTracks) {
            const lang = this.guessLanguage(subs);
            const count = existingTracks.filter(t => t.name.startsWith(lang)).length;
            return count > 0 ? `${lang} ${count + 1}` : lang;
        }
    };

    // =========================================================================
    // 3. UI LAYER
    // =========================================================================
    class SidebarUI {
        constructor(state, app) {
            this.state = state;
            this.app = app;
            this.elements = {};
        }

        init() {
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
                this.state.activeTrackIndex = parseInt(e.target.value);
                this.refresh();
            });

            const subSelect = document.createElement('select');
            subSelect.id = 'vtt-sub-select';
            subSelect.title = 'Secondary Track';
            subSelect.className = 'vtt-select';
            subSelect.addEventListener('change', (e) => {
                this.state.secondaryTrackIndex = parseInt(e.target.value);
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

            if (isTopWindow) {
                document.body.classList.add('vtt-sidebar-active');
            } else {
                sidebar.style.display = 'none';
            }

            this.setupFullscreenHandling();
            return true;
        }

        setupFullscreenHandling() {
            document.addEventListener('fullscreenchange', () => {
                if (document.fullscreenElement) {
                    this.elements.sidebar.style.display = 'flex';
                    this.elements.sidebar.classList.add('fullscreen');
                    // Автоматически сворачиваем сайдбар, чтобы не перекрывать видео при переходе
                    this.elements.sidebar.classList.add('collapsed');
                    document.fullscreenElement.appendChild(this.elements.sidebar);
                } else {
                    document.body.appendChild(this.elements.sidebar);
                    this.elements.sidebar.classList.remove('fullscreen');
                    if (!isTopWindow) {
                        this.elements.sidebar.style.display = 'none';
                    } else {
                        this.elements.sidebar.classList.remove('collapsed');
                    }
                }
            });
        }

        refresh() {
            this.updateControls();
            this.renderSubtitles();
            this.app.updateHighlight();
        }

        updateControls() {
            if (!this.elements.settingsBtn) return;
            
            // Always show the settings button so the user can see what track is currently loaded
            this.elements.settingsBtn.style.display = 'flex';
            
            const hasMultiple = this.state.hasMultipleTracks();
            this.elements.dualBtn.classList.toggle('active', this.state.displayMode === 'dual');
            this.elements.overlayBtn.classList.toggle('active', this.state.overlayEnabled);

            const activeId = document.activeElement?.id;
            this.elements.mainSelect.innerHTML = '';
            this.elements.subSelect.innerHTML = '';

            this.state.tracks.forEach((track, i) => {
                this.elements.mainSelect.appendChild(new Option('Main: ' + track.name, i, false, i === this.state.activeTrackIndex));
                this.elements.subSelect.appendChild(new Option('Sub: ' + track.name, i, false, i === this.state.secondaryTrackIndex));
            });

            // If there's only one track, disable the swap and dual buttons to indicate they require a second track
            this.elements.dualBtn.disabled = !hasMultiple;
            const swapBtn = document.getElementById('vtt-swap-btn');
            if (swapBtn) swapBtn.disabled = !hasMultiple;

            if (activeId) document.getElementById(activeId)?.focus();
        }

        renderSubtitles() {
            if (!this.elements.list) return;
            this.elements.list.innerHTML = '';
            this.state.currentIndex = -1;

            const mainTrack = this.state.getMainTrack();
            if (!mainTrack) return;

            const secondaryTrack = this.state.getSecondaryTrack();
            const df = document.createDocumentFragment();

            mainTrack.forEach((sub, index) => {
                const item = document.createElement('div');
                item.className = 'vtt-item';
                item.dataset.index = index;

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
                df.appendChild(item);
            });

            this.elements.list.appendChild(df);
        }

        highlightSubtitle(currentTime) {
            const mainTrack = this.state.getMainTrack();
            if (!mainTrack) return;

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

                const newActive = this.elements.list.querySelector(`.vtt-item[data-index="${activeIndex}"]`);
                if (newActive) {
                    newActive.classList.add('active-sub');
                    if (!this.state.isHovering) {
                        newActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
                this.state.currentIndex = activeIndex;
                this.updateOverlay(activeIndex);
            } else if (activeIndex === -1 && this.state.currentIndex !== -1) {
                // Clear overlay when no subtitle is active
                this.state.currentIndex = -1;
                this.updateOverlay(-1);
            } else if (activeIndex !== -1 && activeIndex === this.state.currentIndex) {
                // Keep overlay updated if we just toggled the mode
                this.updateOverlay(activeIndex);
            }
        }

        updateOverlay(index) {
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
                    return; // Can't find video container
                }
            }

            overlay.style.display = 'flex';

            if (index === -1) {
                overlay.innerHTML = '';
                return;
            }

            const mainTrack = this.state.getMainTrack();
            const sub = mainTrack[index];
            if (!sub) return;

            overlay.innerHTML = '';

            const mainDiv = document.createElement('div');
            mainDiv.className = 'vtt-overlay-main';
            mainDiv.textContent = sub.text;
            overlay.appendChild(mainDiv);

            if (this.state.displayMode === 'dual') {
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

    // =========================================================================
    // 4. MAIN APP ORCHESTRATOR
    // =========================================================================
    class VttApp {
        constructor() {
            this.state = new AppState();
            this.ui = new SidebarUI(this.state, this);
            
            console.log("VTT Sidebar: Running in " + (isTopWindow ? "top window." : "iframe."));
            this.ui.init();
            this.setupListeners();
            this.startVideoPolling();
        }

        startVideoPolling() {
            setInterval(() => {
                document.querySelectorAll('video').forEach(video => {
                    if (!video.dataset.vttAttached) {
                        video.dataset.vttAttached = "true";
                        console.log("VTT Sidebar: Attached timeupdate to a video element.");
                        
                        video.addEventListener('timeupdate', () => {
                            try {
                                chrome.runtime.sendMessage({ action: "TIME_UPDATE", time: video.currentTime });
                            } catch (e) {
                                if (!e.message.includes("Extension context invalidated")) console.error(e);
                            }
                        });
                    }
                });
            }, 1000);
        }

        setupListeners() {
            // Background script messages
            chrome.runtime.onMessage.addListener((request) => {
                if (request.action === "VTT_LOADED") {
                    this.handleNewSubtitles(request.payload);
                } else if (request.action === "TIME_UPDATE") {
                    this.ui.highlightSubtitle(request.time);
                } else if (request.action === "SEEK_VIDEO") {
                    this.seekVideoLocal(request.time);
                }
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.shiftKey && e.code === 'KeyS') {
                    if (this.state.swapTracks()) this.ui.refresh();
                }
                if (e.shiftKey && e.code === 'KeyD') {
                    if (this.state.toggleDualMode()) this.ui.refresh();
                }
                if (e.shiftKey && e.code === 'KeyO') {
                    this.state.overlayEnabled = !this.state.overlayEnabled;
                    this.ui.refresh();
                }
            });
        }

        handleNewSubtitles(vttText) {
            if (typeof parseVTT !== 'function') return; // Wait for parser.js
            
            const newSubs = parseVTT(vttText);
            if (newSubs.length === 0) return;

            if (!this.state.isDuplicate(newSubs)) {
                const name = LanguageUtils.generateTrackName(newSubs, this.state.tracks);
                this.state.addTrack(name, newSubs);
            }
            this.ui.refresh();
        }

        seekVideo(time) {
            try {
                chrome.runtime.sendMessage({ action: "SEEK_VIDEO", time });
            } catch (e) {
                if (!e.message.includes("Extension context invalidated")) console.error(e);
            }
            this.seekVideoLocal(time);
        }

        seekVideoLocal(time) {
            document.querySelectorAll('video').forEach(video => {
                video.currentTime = time;
                video.play().catch(() => {});
            });
        }

        updateHighlight() {
            const video = document.querySelector('video');
            if (video) this.ui.highlightSubtitle(video.currentTime);
        }
    }

    // Bootstrap
    new VttApp();
})();
