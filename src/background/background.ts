// Функция для скачивания файла с автоматическим повтором при ошибке (retry)
async function fetchWithRetry(url: string, retries: number = 3, delay: number = 1000): Promise<string> {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.text();
        } catch (err: any) {
            console.warn(`Попытка загрузки ${i + 1} не удалась для ${url}:`, err.message);
            if (i < retries - 1) {
                await new Promise(res => setTimeout(res, delay));
            } else {
                throw err;
            }
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

// Ретранслятор сообщений (Relay) для обмена данными между фреймами
// А также обработчик запросов на скачивание VTT
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TIME_UPDATE" || request.action === "SEEK_VIDEO" || request.action === "VTT_LOADED") {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, request);
        }
    } else if (request.action === "FETCH_VTT") {
        fetchWithRetry(request.url)
            .then(text => {
                // Отправляем результат обратно во вкладку
                if (sender.tab && sender.tab.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        action: "VTT_LOADED",
                        payload: text,
                        url: request.url
                    });
                }
            })
            .catch(err => {
                console.error("Background: Failed to fetch VTT:", err);
            });
    }
    return true; // Держим канал открытым для асинхронных ответов если нужно
});
