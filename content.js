// Identify if we are in the top window or an iframe
const isTopWindow = window === window.top;

let subtitleTracks = []; // [{ name: "eng", data: [...] }]
let activeTrackIndex = 0;
let secondaryTrackIndex = 0;
let displayMode = 'single'; // 'single' или 'dual'

function guessLanguage(subs) {
    if (!subs || subs.length === 0) return "Unknown";
    
    // Берем первые 20 фраз для анализа
    const sampleText = subs.slice(0, 20).map(s => s.text).join(' ');
    
    const cyrillicCount = (sampleText.match(/[а-яА-ЯёЁіІїЇєЄґҐ]/g) || []).length;
    const latinCount = (sampleText.match(/[a-zA-Z]/g) || []).length;
    
    if (cyrillicCount > latinCount) {
        const ukrainianCount = (sampleText.match(/[іІїЇєЄ]/g) || []).length;
        if (ukrainianCount > 0) return "Ukrainian";
        return "Russian";
    } else if (latinCount > cyrillicCount && latinCount > 0) {
        return "English";
    }
    
    return "Track";
}

function generateTrackName(subs) {
    const lang = guessLanguage(subs);
    // Ищем, сколько уже таких языков добавлено, чтобы сделать "English 2"
    let count = 0;
    subtitleTracks.forEach(t => {
        if (t.name.startsWith(lang)) count++;
    });
    return count > 0 ? `${lang} ${count + 1}` : lang;
}

let currentIndex = -1;
let isHovering = false; // Флаг для остановки автоскролла

console.log("VTT Sidebar: Running in " + (isTopWindow ? "top window." : "iframe."));

// Инициализируем сайдбар ВО ВСЕХ окнах (в iframe он будет скрыт до перехода в fullscreen)
initSidebar();

// Polling to find the video element since it might be added dynamically
const videoInterval = setInterval(() => {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (!video.dataset.vttAttached) {
            video.dataset.vttAttached = "true";
            console.log("VTT Sidebar: Attached timeupdate to a video element.");
            
            video.addEventListener('timeupdate', () => {
                try {
                    // Отправляем время через background.js во все окна
                    chrome.runtime.sendMessage({
                        action: "TIME_UPDATE",
                        time: video.currentTime
                    });
                } catch (e) {
                    // Игнорируем ошибку "Extension context invalidated", которая возникает 
                    // при перезагрузке расширения до обновления вкладки
                    if (!e.message.includes("Extension context invalidated")) {
                        console.error(e);
                    }
                }
            });
        }
    });
}, 1000);

// Единый слушатель сообщений от background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Получение субтитров (обрабатываем во ВСЕХ окнах, чтобы при fullscreen сайдбар был готов)
    if (request.action === "VTT_LOADED") {
        console.log("VTT Sidebar: Received subtitles in " + (isTopWindow ? "top window." : "iframe."));
        const vttText = request.payload;
        const newSubs = parseVTT(vttText);
        
        if (newSubs.length > 0) {
            const isDuplicate = subtitleTracks.some(track => 
                track.data.length > 0 && 
                track.data[0].text === newSubs[0].text && 
                track.data[Math.floor(track.data.length/2)]?.text === newSubs[Math.floor(newSubs.length/2)]?.text
            );

            if (!isDuplicate) {
                const name = generateTrackName(newSubs);
                subtitleTracks.push({ name, data: newSubs });
                
                if (subtitleTracks.length === 1) {
                    activeTrackIndex = 0;
                } else {
                    secondaryTrackIndex = activeTrackIndex; // Предыдущий главный становится вторичным
                    activeTrackIndex = subtitleTracks.length - 1; // Новый становится главным
                }
            }
            
            updateSidebarControls();
            renderSubtitles();
        }
    }
    
    // 2. Обновление времени (обрабатываем во ВСЕХ окнах)
    if (request.action === "TIME_UPDATE") {
        highlightSubtitle(request.time);
    }

    // 3. Перемотка видео (ищем видео в любом окне и перематываем)
    if (request.action === "SEEK_VIDEO") {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            video.currentTime = request.time;
            video.play().catch(e => console.log("Auto-play prevented", e));
        });
    }
});

function initSidebar() {
    if (document.getElementById('vtt-sidebar')) return;

    const sidebar = document.createElement('div');
    sidebar.id = 'vtt-sidebar';
    
    // Кнопка для скрытия/показа сайдбара
    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'vtt-toggle-btn';
    toggleBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    sidebar.appendChild(toggleBtn);

    const header = document.createElement('div');
    header.id = 'vtt-header';

    const title = document.createElement('h2');
    title.textContent = 'Subtitles';
    header.appendChild(title);

    // Контейнер для селекторов дорожек
    const selectorsDiv = document.createElement('div');
    selectorsDiv.id = 'vtt-track-selectors';
    selectorsDiv.style.display = 'none';

    const mainSelect = document.createElement('select');
    mainSelect.id = 'vtt-main-select';
    mainSelect.title = 'Main Track';
    mainSelect.className = 'vtt-select';
    mainSelect.addEventListener('change', (e) => {
        activeTrackIndex = parseInt(e.target.value);
        updateSidebarControls();
        renderSubtitles();
        updateHighlight();
    });
    
    const subSelect = document.createElement('select');
    subSelect.id = 'vtt-sub-select';
    subSelect.title = 'Secondary Track';
    subSelect.className = 'vtt-select';
    subSelect.addEventListener('change', (e) => {
        secondaryTrackIndex = parseInt(e.target.value);
        updateSidebarControls();
        renderSubtitles();
    });

    selectorsDiv.appendChild(mainSelect);
    selectorsDiv.appendChild(subSelect);
    header.appendChild(selectorsDiv);

    // Контейнер для кнопок управления (по умолчанию скрыт, пока нет 2 дорожек)
    const controls = document.createElement('div');
    controls.id = 'vtt-controls';
    controls.style.display = 'none';

    const swapBtn = document.createElement('button');
    swapBtn.id = 'vtt-swap-btn';
    swapBtn.title = 'Swap Language (Shift+S)';
    swapBtn.textContent = '🔄 Swap';
    swapBtn.addEventListener('click', () => {
        if (subtitleTracks.length > 1) {
            const temp = activeTrackIndex;
            activeTrackIndex = secondaryTrackIndex;
            secondaryTrackIndex = temp;
            updateSidebarControls();
            renderSubtitles();
            updateHighlight();
        }
    });
    controls.appendChild(swapBtn);

    const dualBtn = document.createElement('button');
    dualBtn.id = 'vtt-dual-btn';
    dualBtn.title = 'Toggle Dual Mode (Shift+D)';
    dualBtn.textContent = '📖 Dual';
    dualBtn.addEventListener('click', () => {
        if (subtitleTracks.length > 1) {
            displayMode = displayMode === 'single' ? 'dual' : 'single';
            dualBtn.classList.toggle('active', displayMode === 'dual');
            renderSubtitles();
            updateHighlight();
        }
    });
    controls.appendChild(dualBtn);

    header.appendChild(controls);
    sidebar.appendChild(header);

    const list = document.createElement('div');
    list.id = 'vtt-list';
    sidebar.appendChild(list);

    document.body.appendChild(sidebar);
    
    // Глобальные горячие клавиши для переключения (Shift+S и Shift+D)
    document.addEventListener('keydown', (e) => {
        if (e.shiftKey && e.code === 'KeyS') {
            if (subtitleTracks.length > 1) {
                const temp = activeTrackIndex;
                activeTrackIndex = secondaryTrackIndex;
                secondaryTrackIndex = temp;
                updateSidebarControls();
                renderSubtitles();
                updateHighlight();
            }
        }
        if (e.shiftKey && e.code === 'KeyD') {
            if (subtitleTracks.length > 1) {
                displayMode = displayMode === 'single' ? 'dual' : 'single';
                const dualBtn = document.getElementById('vtt-dual-btn');
                if (dualBtn) dualBtn.classList.toggle('active', displayMode === 'dual');
                renderSubtitles();
                updateHighlight();
            }
        }
    });
    
    // Останавливаем автоскролл, если пользователь навел мышку на панель
    sidebar.addEventListener('mouseenter', () => { isHovering = true; });
    sidebar.addEventListener('mouseleave', () => { 
        isHovering = false; 
        // Возвращаем скролл к текущей фразе, когда мышка уходит
        const active = document.querySelector('.vtt-item.active-sub');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    if (isTopWindow) {
        document.body.classList.add('vtt-sidebar-active');
    } else {
        // В iframe прячем сайдбар по умолчанию
        sidebar.style.display = 'none';
    }

    // Обработка перехода в полноэкранный режим
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            // Переносим сайдбар внутрь fullscreen-контейнера
            sidebar.style.display = 'flex';
            // Автоматически сворачиваем сайдбар, чтобы не перекрывать видео при переходе
            sidebar.classList.add('collapsed');
            document.fullscreenElement.appendChild(sidebar);
        } else {
            // Возвращаем сайдбар в body
            document.body.appendChild(sidebar);
            if (!isTopWindow) {
                sidebar.style.display = 'none'; // Снова прячем в iframe
            } else {
                sidebar.classList.remove('collapsed'); // Разворачиваем в нормальном режиме
            }
        }
    });
}

function updateSidebarControls() {
    const controls = document.getElementById('vtt-controls');
    const selectors = document.getElementById('vtt-track-selectors');
    if (controls && selectors) {
        const hasMultiple = subtitleTracks.length > 1;
        controls.style.display = hasMultiple ? 'flex' : 'none';
        selectors.style.display = hasMultiple ? 'flex' : 'none';

        if (hasMultiple) {
            const mainSelect = document.getElementById('vtt-main-select');
            const subSelect = document.getElementById('vtt-sub-select');
            
            // Сохраняем фокус если он был на одном из селектов
            const activeId = document.activeElement?.id;
            
            mainSelect.innerHTML = '';
            subSelect.innerHTML = '';
            
            subtitleTracks.forEach((track, i) => {
                const optMain = document.createElement('option');
                optMain.value = i;
                optMain.textContent = 'Main: ' + track.name;
                optMain.selected = i === activeTrackIndex;
                mainSelect.appendChild(optMain);
                
                const optSub = document.createElement('option');
                optSub.value = i;
                optSub.textContent = 'Sub: ' + track.name;
                optSub.selected = i === secondaryTrackIndex;
                subSelect.appendChild(optSub);
            });

            if (activeId) document.getElementById(activeId)?.focus();
        }
    }
}

function updateHighlight() {
    const video = document.querySelector('video');
    if (video) highlightSubtitle(video.currentTime);
}

function renderSubtitles() {
    const list = document.getElementById('vtt-list');
    if (!list) return;
    
    list.innerHTML = ''; // clear existing
    currentIndex = -1; // reset index

    if (subtitleTracks.length === 0) return;

    const mainTrack = subtitleTracks[activeTrackIndex]?.data;
    const secondaryTrack = subtitleTracks.length > 1 ? subtitleTracks[secondaryTrackIndex]?.data : null;

    if (!mainTrack) return;

    mainTrack.forEach((sub, index) => {
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = index;
        item.dataset.start = sub.startTime;
        item.dataset.end = sub.endTime;

        const mainTextDiv = document.createElement('div');
        mainTextDiv.className = 'vtt-main-text';
        mainTextDiv.textContent = sub.text;
        item.appendChild(mainTextDiv);

        if (displayMode === 'dual' && secondaryTrack) {
            // Ищем пересекающиеся по времени субтитры во второй дорожке
            const overlap = secondaryTrack.filter(s => s.startTime < sub.endTime && s.endTime > sub.startTime);
            if (overlap.length > 0) {
                const subTextDiv = document.createElement('div');
                subTextDiv.className = 'vtt-sub-text';
                subTextDiv.textContent = overlap.map(s => s.text).join(' | ');
                item.appendChild(subTextDiv);
            }
        }

        item.addEventListener('click', () => {
            try {
                // Отправляем команду перемотки через background.js (для всех фреймов)
                chrome.runtime.sendMessage({
                    action: "SEEK_VIDEO",
                    time: sub.startTime
                });
            } catch (e) {
                if (!e.message.includes("Extension context invalidated")) console.error(e);
            }
            
            // Также перематываем локально (если видео в текущем окне)
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
                video.currentTime = sub.startTime;
                video.play().catch(e => {});
            });
        });

        list.appendChild(item);
    });
}

function highlightSubtitle(currentTime) {
    if (subtitleTracks.length === 0) return;
    const currentTrack = subtitleTracks[activeTrackIndex]?.data;
    if (!currentTrack || currentTrack.length === 0) return;

    let activeIndex = -1;
    for (let i = 0; i < currentTrack.length; i++) {
        if (currentTime >= currentTrack[i].startTime && currentTime <= currentTrack[i].endTime) {
            activeIndex = i;
            break;
        }
    }

    if (activeIndex !== -1 && activeIndex !== currentIndex) {
        const list = document.getElementById('vtt-list');
        if (!list) return;

        const oldActive = list.querySelector('.vtt-item.active-sub');
        if (oldActive) oldActive.classList.remove('active-sub');

        const newActive = list.querySelector(`.vtt-item[data-index="${activeIndex}"]`);
        if (newActive) {
            newActive.classList.add('active-sub');
            // Скроллим только если пользователь не читает сам (не навел мышку)
            if (!isHovering) {
                newActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        currentIndex = activeIndex;
    }
}
