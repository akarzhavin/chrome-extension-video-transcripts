// Identify if we are in the top window or an iframe
const isTopWindow = window === window.top;

let subtitles = [];
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
        subtitles = parseVTT(vttText);
        renderSubtitles(subtitles);
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

    const title = document.createElement('h2');
    title.textContent = 'Subtitles';
    sidebar.appendChild(title);

    const list = document.createElement('div');
    list.id = 'vtt-list';
    sidebar.appendChild(list);

    document.body.appendChild(sidebar);
    
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

function renderSubtitles(subs) {
    const list = document.getElementById('vtt-list');
    if (!list) return;
    
    list.innerHTML = ''; // clear existing
    currentIndex = -1; // reset index

    subs.forEach((sub, index) => {
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = index;
        item.dataset.start = sub.startTime;
        item.dataset.end = sub.endTime;
        item.textContent = sub.text;

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
    if (!subtitles || subtitles.length === 0) return;

    let activeIndex = -1;
    for (let i = 0; i < subtitles.length; i++) {
        if (currentTime >= subtitles[i].startTime && currentTime <= subtitles[i].endTime) {
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
