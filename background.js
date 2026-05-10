// Кеш для запоминания уже загруженных URL, чтобы не качать дубликаты
const processedUrls = new Set();

// Функция для скачивания файла с автоматическим повтором при ошибке (retry)
async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.text();
    } catch (err) {
      console.warn(`Попытка загрузки ${i + 1} не удалась для ${url}:`, err.message);
      if (i < retries - 1) {
        // Ждем перед следующей попыткой
        await new Promise(res => setTimeout(res, delay));
      } else {
        // Если все попытки исчерпаны, пробрасываем ошибку дальше
        throw err;
      }
    }
  }
}

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // 1. Игнорируем запросы от самого расширения (у них tabId === -1)
    if (details.tabId === -1) return;

    // 2. Убеждаемся, что это успешный GET-запрос (200 OK или 206 Partial Content)
    if (details.method !== 'GET' || details.statusCode < 200 || details.statusCode >= 300) {
        return;
    }

    // 3. Убеждаемся, что мы еще не обрабатывали этот конкретный URL
    if (processedUrls.has(details.url)) {
        return;
    }

    // Убеждаемся, что это файл субтитров
    if (details.url.includes('.vtt')) {
      chrome.tabs.get(details.tabId, async (tab) => {
        if (!tab || !tab.url) return;
        // Проверяем, что вкладка открыта на сайте rezka
        if (!tab.url.includes('rezka.ag') && !tab.url.includes('hdrezka')) return;

        console.log("VTT file detected on Rezka:", details.url);
        
        // Помечаем URL как обрабатываемый
        processedUrls.add(details.url);
        // Очищаем кеш, чтобы он не разрастался бесконечно
        if (processedUrls.size > 100) processedUrls.clear();

        try {
          // Скачиваем сам файл с механизмом retry (3 попытки, 1 сек пауза)
          const vttText = await fetchWithRetry(details.url, 3, 1000);
          
          // Отправляем текст во вкладку
          chrome.tabs.sendMessage(details.tabId, {
            action: "VTT_LOADED",
            payload: vttText,
            url: details.url
          });
          
          console.log("VTT успешно скачан и отправлен на страницу", details.url);
        } catch (err) {
          console.error("Критическая ошибка загрузки VTT после всех попыток:", err);
          // Если совсем не удалось скачать, удаляем из кеша, чтобы можно было попробовать снова при обновлении
          processedUrls.delete(details.url);
        }
      });
    }
  },
  { urls: ["*://*/*.vtt*"] } // Фильтр запросов
);

// Ретранслятор сообщений (Relay) для обмена данными между фреймами
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TIME_UPDATE" || request.action === "SEEK_VIDEO") {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, request);
        }
    }
});
