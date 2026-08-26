// Открытие вкладок в фоне и глушение звука для прогонов по CDP.
//
// Зачем: эти скрипты подключаются к Chrome, за которым в этот момент работает
// человек (иначе YouTube не отдаёт субтитры — см. docs/ops/live-debug-cdp.md).
// Значит, прогон обязан быть незаметным: ctx.newPage() создаёт вкладку активной,
// Chrome поднимает окно на передний план и на macOS отбирает фокус, а видео
// начинает играть со звуком поверх того, что человек слушает.
//
// Окно при этом НЕ прячется — оно остаётся видимым, просто не всплывает.

/**
 * Открывает вкладку, не забирая фокус и не поднимая окно браузера.
 * Возвращает playwright-Page.
 */
export async function openInBackground(ctx, url) {
    const anchor = ctx.pages()[0];
    if (!anchor) throw new Error('У браузера нет ни одной вкладки — открыто ли окно?');

    const browserCdp = await ctx.newCDPSession(anchor);
    const { targetId } = await browserCdp.send('Target.createTarget', { url, background: true });
    await browserCdp.detach().catch(() => {});

    // Сопоставляем строго по targetId, а не по URL: одинаковых вкладок в живом
    // браузере может быть несколько (в т.ч. от прошлых прогонов), и по URL легко
    // взять чужую — тогда в finally закроется не та, а своя останется висеть.
    for (let i = 0; i < 60; i++) {
        for (const page of ctx.pages()) {
            const session = await ctx.newCDPSession(page).catch(() => null);
            if (!session) continue;
            const info = await session.send('Target.getTargetInfo').catch(() => null);
            await session.detach().catch(() => {});
            if (info?.targetInfo?.targetId === targetId) return page;
        }
        await anchor.waitForTimeout(250);
    }
    throw new Error(`вкладка ${url} не появилась в контексте за 15 с`);
}

/**
 * Глушит видео на странице. Не бросает: прогон проверяет субтитры, а не звук.
 *
 * Через плеер площадки, а не video.muted: YouTube держит громкость в своём
 * состоянии и восстанавливает её поверх правки DOM — проверено, muted
 * откатывается обратно. Интервал добивает случаи, когда плеер сбрасывает mute
 * сам (смена качества, следующее видео в очереди).
 */
export async function mute(page) {
    try {
        await page.waitForLoadState('domcontentloaded');

        const hasYtPlayer = await page.evaluate(
            () => !!document.getElementById('movie_player')?.mute,
        ).catch(() => false);

        if (hasYtPlayer) {
            return await page.evaluate(() => {
                const p = document.getElementById('movie_player');
                p.mute();
                setInterval(() => { if (!p.isMuted?.()) p.mute(); }, 1000);
                return 'звук выключен';
            });
        }

        // Остальные площадки (rezka, netflix) — обычный <video>.
        await page.waitForFunction(() => document.querySelector('video'), null, { timeout: 15000 });
        return await page.evaluate(() => {
            const keep = () => document.querySelectorAll('video,audio')
                .forEach((v) => { v.muted = true; });
            keep();
            setInterval(keep, 1000);
            return 'звук выключен';
        });
    } catch {
        return 'звук выключить не удалось (плеер не появился) — проверка продолжается';
    }
}
