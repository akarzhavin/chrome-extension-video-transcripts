// Watching the MV3 service worker's network from the browser endpoint.
//
// Зачем отдельно от playwright: у MV3-воркера нет постоянной жизни. Он
// просыпается на событие, шлёт запрос и умирает. playwright отдаёт
// ctx.serviceWorkers() пустым (проверено: 0 для нашего расширения, при том что
// /json/list таргет показывает), а таргет успевает исчезнуть между двумя
// вызовами. Перецепление в цикле каждые 5 с ловило ноль запросов.
//
// Рабочий способ — браузерный CDP-эндпоинт: Target.setAutoAttach с flatten
// подключает нас к воркеру В МОМЕНТ рождения, до того как он успеет что-то
// отправить, и Network.enable в этой сессии отдаёт его запросы вместе с телами.

import WebSocket from 'ws';

/**
 * Слушает запросы всех service worker'ов расширения `extensionId`.
 * `onRequest({url, method, postData})` — на каждый исходящий запрос.
 * `onResponse({url, status})` — на ответ; статус нужен, чтобы отличить принятую
 * запись от отклонённой (вызывающий код глотает ошибку по устройству).
 * Возвращает функцию остановки.
 */
export async function watchWorkerNetwork(port, extensionId, onRequest, onResponse) {
    const inflight = new Map();
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
    const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
    let id = 0;
    const send = (method, params, sessionId) =>
        ws.send(JSON.stringify({ id: ++id, method, params, sessionId }));

    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });

    // flatten: сессии приезжают в этом же сокете с sessionId, отдельного
    // соединения на воркер не нужно. waitForDebuggerOnStart даёт время включить
    // Network до первого запроса — без него ранние хиты теряются.
    send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: 'service_worker' }, { type: 'worker' }],
    });

    ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }

        if (m.method === 'Target.attachedToTarget') {
            const { sessionId, targetInfo } = m.params;
            if (targetInfo.url?.includes(extensionId)) {
                send('Network.enable', {}, sessionId);
            }
            send('Runtime.runIfWaitingForDebugger', {}, sessionId);
            return;
        }

        if (m.method === 'Network.requestWillBeSent' && m.sessionId) {
            const r = m.params.request;
            inflight.set(m.params.requestId, r.url);
            onRequest({ url: r.url, method: r.method, postData: r.postData ?? null });
            return;
        }

        // The status matters as much as the payload here: a rejected write is
        // indistinguishable from a successful one at the request end, and the
        // caller swallows the error by design.
        if (m.method === 'Network.responseReceived' && m.sessionId) {
            const url = inflight.get(m.params.requestId);
            if (url) onResponse?.({ url, status: m.params.response.status });
            return;
        }
    });

    return () => ws.close();
}
