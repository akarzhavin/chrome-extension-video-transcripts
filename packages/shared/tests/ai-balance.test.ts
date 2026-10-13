/**
 * The AI wallet on the client (english repo, spec 024): parsing the server's
 * balance, keeping it in storage for every view, the sidebar badge, the card
 * notice and the once-per-window warning.
 */

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners = new Set<Listener>();
const store: Record<string, unknown> = {};
const local = {
    get: jest.fn(async (key: string | string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of Array.isArray(key) ? key : [key]) if (k in store) out[k] = store[k];
        return out;
    }),
    set: jest.fn(async (obj: Record<string, unknown>) => {
        Object.assign(store, obj);
        const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]));
        listeners.forEach((l) => l(changes, 'local'));
    }),
    remove: jest.fn(async (key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        keys.forEach((k) => delete store[k]);
        listeners.forEach((l) => l(Object.fromEntries(keys.map((k) => [k, { newValue: undefined }])), 'local'));
    }),
};
const sendMessage = jest.fn();
(global as any).chrome = {
    runtime: { id: 'test', sendMessage, lastError: undefined, getManifest: () => ({ version: '0.0.0' }) },
    storage: {
        local,
        onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
    i18n: { getMessage: () => '' },
};

import { parseBalance, parseAIStatus, type AIBalance } from '../src/ai-balance/types';
import { formatTokens, limitText, percentUsed, statusText, tokensLeft } from '../src/ai-balance/format';
import { clearAccountAI, loadBalance, onBalance, saveBalance, saveDefaults } from '../src/ai-balance/store';
import { takeWarning } from '../src/ai-balance/warn';
import { renderBars } from '../src/ai-balance/bars';
import { aiNoticeHtml, wireAINotice } from '../src/ai-balance/notice';
import { emptyNoticeHtml } from '../src/lookup/empty-notice';
import { mountAIBadge } from '../src/ai-balance/badge';
import { keepBalance, refreshBalance } from '../src/ai-balance/fetch';

const BALANCE_KEY = 'ai.balance';
const localTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const localDate = (ms: number) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
const DAY_RESET = Date.UTC(2026, 9, 12);
const MONTH_RESET = Date.UTC(2026, 10, 1);
const wire = (dayUsed: number, monthUsed = dayUsed, exhausted: string | null = null) => ({
    day: { used: dayUsed, limit: 500_000, resets_at: DAY_RESET },
    month: { used: monthUsed, limit: 10_000_000, resets_at: MONTH_RESET },
    exhausted,
    warn_ratio: 0.8,
});
const balance = (dayUsed: number, monthUsed = dayUsed, exhausted: string | null = null): AIBalance =>
    parseBalance(wire(dayUsed, monthUsed, exhausted), 1)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const signIn = () => Object.assign(store, { 'auth.idToken': 'tok', 'auth.uid': 'u1' });

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    listeners.clear();
    sendMessage.mockReset();
    document.body.innerHTML = '';
});

describe('parseBalance', () => {
    test('reads the wire shape and a stored one alike', () => {
        const b = balance(310_000);
        expect(b.day).toEqual({ used: 310_000, limit: 500_000, resetsAt: DAY_RESET });
        expect(b.warnRatio).toBe(0.8);
        expect(parseBalance(b)).toEqual(b);
    });

    test('refuses anything that is not a balance', () => {
        expect(parseBalance(null)).toBeNull();
        expect(parseBalance({ day: { used: 1 } })).toBeNull();
        expect(parseBalance({ ...wire(1), warn_ratio: 7 })?.warnRatio).toBe(0.8);
        expect(parseAIStatus('limit_month')).toBe('limit_month');
        expect(parseAIStatus('nope')).toBeUndefined();
    });
});

describe('format', () => {
    test('percent rounds down and reaches 100 only when the window is spent', () => {
        const w = (used: number) => ({ used, limit: 1000, resetsAt: 0 });
        expect(percentUsed(w(999))).toBe(99);
        expect(percentUsed(w(996))).toBe(99);
        expect(percentUsed(w(1000))).toBe(100);
        expect(percentUsed(w(1200))).toBe(100);
    });

    test('percent caps at 100 and tokens left read compactly', () => {
        expect(percentUsed(balance(310_000).day)).toBe(62);
        expect(percentUsed(balance(600_000).day)).toBe(100);
        expect(formatTokens(190_400)).toBe('190k');
        expect(formatTokens(1_250_000)).toBe('1.2M');
        expect(formatTokens(-3)).toBe('0');
    });

    test('the limit message names the window', () => {
        expect(limitText('day', null)).toBe('AI limit for today reached');
        expect(limitText('month', null)).toBe('AI limit for this month reached');
        expect(limitText('month', balance(1))).toMatch(/^AI limit for this month reached, resets on /);
        expect(statusText('sign_in_required', null)).toBe('Sign in so AI can complete the card');
        expect(statusText('ai_paused', null)).toMatch(/^AI is paused for today for everyone/);
        expect(parseAIStatus('ai_paused')).toBe('ai_paused');
    });
});

describe('store', () => {
    test('a saved balance reaches every listener and is gone on clear', async () => {
        const seen: (AIBalance | null)[] = [];
        const off = onBalance((b) => seen.push(b));
        await saveBalance(balance(5));
        expect((await loadBalance())?.day.used).toBe(5);
        await clearAccountAI();
        expect(await loadBalance()).toBeNull();
        off();
        await saveBalance(balance(6));
        expect(seen.map((b) => b?.day.used ?? null)).toEqual([5, null]);
    });

    test('keepBalance ignores what is not a balance', async () => {
        signIn();
        await keepBalance({ nope: 1 });
        expect(store[BALANCE_KEY]).toBeUndefined();
        await keepBalance(wire(9));
        expect((await loadBalance())?.day.used).toBe(9);
    });
});

describe('clearAccountAI', () => {
    test('drops the balance and the warned marks, so the next account is warned again', async () => {
        await saveBalance(balance(450_000));
        expect(await takeWarning(balance(450_000))).toBe('day');
        await clearAccountAI();
        expect(await loadBalance()).toBeNull();
        expect(await takeWarning(balance(450_000))).toBe('day');
    });
});

describe('takeWarning', () => {
    test('warns once per window, the month first, never an exhausted one', async () => {
        expect(await takeWarning(balance(100_000))).toBeNull();
        expect(await takeWarning(balance(400_000, 8_000_000))).toBe('month');
        expect(await takeWarning(balance(400_000, 8_000_000))).toBe('day');
        expect(await takeWarning(balance(450_000, 8_100_000))).toBeNull();
        expect(await takeWarning(balance(500_000, 8_100_000, 'day'))).toBeNull();
    });

    test('a window is remembered by the UTC day or month before its reset', async () => {
        await takeWarning(balance(400_000, 8_000_000));
        await takeWarning(balance(400_000, 8_000_000));
        expect(store['ai.warned.month']).toBe('202610');
        expect(store['ai.warned.day']).toBe('20261011');
    });
});

// The dropdown, variant B of the badge canvas (owner, 2026-10-12): it speaks in
// "left", like the badge, and closes with the demo-mode line.
describe('renderBars', () => {
    const rows = (el: HTMLElement) =>
        [...el.querySelectorAll('.lg-ai-row')].map((r) => ({
            label: r.querySelector('.lg-ai-label')!.textContent,
            value: r.querySelector('.lg-ai-value')!.textContent,
            bar: r.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow'),
            amount: r.querySelector('.lg-ai-amount')!.textContent,
            reset: r.querySelector('.lg-ai-reset')!.textContent,
        }));

    test('each window shows the share left, the tokens left of the limit, and its reset', () => {
        const el = renderBars(balance(310_000, 1_800_000));
        expect(rows(el)).toEqual([
            { label: 'Today', value: '38% left', bar: '38', amount: '190k of 500k', reset: `Resets at ${localTime(DAY_RESET)}` },
            { label: 'This month', value: '82% left', bar: '82', amount: '8.2M of 10M', reset: `Resets on ${localDate(MONTH_RESET)}` },
        ]);
    });

    test('the share left rounds down, so a sliver used never reads as 100%', () => {
        expect(rows(renderBars(balance(1)))[0].value).toBe('99% left');
    });

    test('a spent window says so in its own row; no separate note line', () => {
        const el = renderBars(balance(500_000, 1, 'day'));
        const [day] = rows(el);
        expect(day).toMatchObject({ value: '0% left', bar: '0', amount: 'AI limit for today reached' });
        expect(el.querySelector('.lg-ai-row')!.classList.contains('lg-ai-spent')).toBe(true);
        expect(el.querySelector('.lg-ai-note')).toBeNull();
    });

    test('the demo-mode line closes the dropdown', () => {
        const el = renderBars(balance(1));
        expect(el.lastElementChild!.className).toBe('lg-ai-demo');
        expect(el.lastElementChild!.textContent).toBe('Demo mode · AI is free within these limits');
    });
});

describe('card notice', () => {
    test('signed out: the line and a sign-in button that starts the sign-in', () => {
        const box = document.createElement('div');
        box.innerHTML = aiNoticeHtml('sign_in_required');
        wireAINotice(box);
        expect(box.textContent).toContain('Sign in so AI can complete the card');
        box.querySelector<HTMLButtonElement>('[data-ai-signin]')!.click();
        expect(sendMessage).toHaveBeenCalledWith({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'lookup' }, expect.any(Function));
    });

    test('a limit fills its reset from the stored balance', async () => {
        await saveBalance(balance(500_000, 1, 'day'));
        const box = document.createElement('div');
        box.innerHTML = aiNoticeHtml('limit_day');
        wireAINotice(box);
        await flush();
        expect(box.querySelector('[data-ai-signin]')).toBeNull();
        expect(box.textContent).toMatch(/AI limit for today reached, resets at \d/);
    });
});

describe('card notice edges', () => {
    test('a status the dataset should not carry is left alone', async () => {
        await saveBalance(balance(500_000, 1, 'day'));
        const box = document.createElement('div');
        box.innerHTML = '<span class="lg-ai-notice" data-ai-status="bogus">as rendered</span>';
        wireAINotice(box);
        await flush();
        expect(box.textContent).toBe('as rendered');
    });
});

describe('sidebar badge', () => {
    function header(): HTMLElement {
        document.body.innerHTML = '<div id="vtt-header-top"></div>';
        return document.getElementById('vtt-header-top')!;
    }

    const button = (top: HTMLElement) => top.querySelector<HTMLButtonElement>('#vtt-ai-badge button')!;

    test('signed out it is the badge switched off: the server default allowance, and a panel with a quiet sign-in link', async () => {
        await saveDefaults({ day: 300_000, month: 6_000_000, at: 1 });
        const top = header();
        mountAIBadge(top);
        await flush();
        expect(top.classList.contains('vtt-ai-off')).toBe(true);
        expect(top.classList.contains('vtt-ai-on')).toBe(false);
        expect(button(top).textContent).toBe('AI 300k');
        expect(button(top).hasAttribute('data-tip')).toBe(false); // hover opens the panel, not a bubble
        expect(button(top).getAttribute('aria-label')).toBe('Sign in, and AI will translate phrases from the subtitles and complete word cards');
        expect(button(top).getAttribute('aria-haspopup')).toBe('true');
        // The ring is full: the whole allowance is on offer.
        expect(top.querySelector('.vtt-ai-arc')!.getAttribute('stroke-dasharray')!.split(' ')[0]).toBe(
            top.querySelector('.vtt-ai-arc')!.getAttribute('stroke-dasharray')!.split(' ')[1],
        );

        sendMessage.mockClear();
        button(top).click();
        // A click opens the panel, it does not start the sign-in by itself.
        expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM' }), expect.any(Function));
        const panel = top.querySelector('#vtt-ai-panel')!;
        expect(panel.querySelector('.lg-ai-off-text')!.textContent).toBe('Sign in, and AI will translate phrases from the subtitles and complete word cards');
        expect(panel.querySelector('.lg-ai-off-free')!.textContent).toBe('300k free tokens a day');
        expect(panel.querySelectorAll('[role=progressbar]')).toHaveLength(0);
        const link = panel.querySelector<HTMLButtonElement>('.lg-ai-signin')!;
        expect(link.textContent).toBe('Sign in');
        link.click();
        expect(sendMessage).toHaveBeenCalledWith({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'ai_badge' }, expect.any(Function));
        document.body.click();
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
    });

    test('signed out with no default windows read yet: "AI" with no number, and no tokens line', async () => {
        const top = header();
        mountAIBadge(top);
        await flush();
        expect(button(top).textContent).toBe('AI');
        button(top).click();
        expect(top.querySelector('#vtt-ai-panel .lg-ai-off-text')).not.toBeNull();
        expect(top.querySelector('#vtt-ai-panel .lg-ai-off-free')).toBeNull();
        // The worker's answer lands in storage: the badge and the open panel pick it up.
        await saveDefaults({ day: 250_000, month: 5_000_000, at: 2 });
        expect(button(top).textContent).toBe('AI 250k');
        expect(top.querySelector('#vtt-ai-panel .lg-ai-off-free')!.textContent).toBe('250k free tokens a day');
    });

    test('signed out, hover opens the same panel and leaving closes it; a click pins it', async () => {
        jest.useFakeTimers();
        try {
            const top = header();
            mountAIBadge(top);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            const badge = top.querySelector<HTMLElement>('#vtt-ai-badge')!;
            badge.dispatchEvent(new MouseEvent('mouseenter'));
            expect(top.querySelector('#vtt-ai-panel .lg-ai-signin')).not.toBeNull();
            badge.dispatchEvent(new MouseEvent('mouseleave'));
            expect(top.querySelector('#vtt-ai-panel')).not.toBeNull(); // grace for crossing the gap
            jest.advanceTimersByTime(200);
            expect(top.querySelector('#vtt-ai-panel')).toBeNull();

            badge.dispatchEvent(new MouseEvent('mouseenter'));
            button(top).click(); // pins
            badge.dispatchEvent(new MouseEvent('mouseleave'));
            jest.advanceTimersByTime(200);
            expect(top.querySelector('#vtt-ai-panel')).not.toBeNull();
            button(top).click(); // unpins and closes
            expect(top.querySelector('#vtt-ai-panel')).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    test('signed in, hover does not open the bars', async () => {
        const top = header();
        await saveBalance(balance(100_000));
        mountAIBadge(top);
        await flush();
        top.querySelector<HTMLElement>('#vtt-ai-badge')!.dispatchEvent(new MouseEvent('mouseenter'));
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
        expect(button(top).getAttribute('data-tip')).toContain('AI tokens left today');
    });

    test('signing in swaps the off badge for the balance; signing out switches it off again', async () => {
        const top = header();
        const unmount = mountAIBadge(top);
        await flush();
        expect(sendMessage).toHaveBeenCalledWith({ action: 'AI_BALANCE_REFRESH' }, expect.any(Function));
        expect(top.classList.contains('vtt-ai-off')).toBe(true);
        button(top).click();
        expect(top.querySelector('#vtt-ai-panel .lg-ai-off-text')).not.toBeNull();

        sendMessage.mockClear();
        await local.set({ 'auth.uid': 'u1', 'auth.idToken': 'tok' });
        // Signed in, no balance yet: not off, the signed-out panel is gone, and the balance is asked for now.
        expect(top.classList.contains('vtt-ai-off')).toBe(false);
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
        expect(sendMessage).toHaveBeenCalledWith({ action: 'AI_BALANCE_REFRESH' }, expect.any(Function));

        await saveBalance(balance(310_000));
        expect(top.classList.contains('vtt-ai-on')).toBe(true);
        expect(button(top).textContent).toBe('AI 190k');

        await clearAccountAI();
        await local.remove(['auth.uid', 'auth.idToken']);
        expect(top.classList.contains('vtt-ai-on')).toBe(false);
        expect(top.classList.contains('vtt-ai-off')).toBe(true);
        expect(button(top).textContent).toBe('AI'); // no defaults read: no number

        unmount();
        expect(top.querySelector('#vtt-ai-badge')).toBeNull();
        expect(top.classList.contains('vtt-ai-off')).toBe(false);
    });

    test('signed in without a balance yet it shows nothing, never the off badge', async () => {
        signIn();
        const top = header();
        mountAIBadge(top);
        await flush();
        expect(top.classList.contains('vtt-ai-off')).toBe(false);
        expect(top.classList.contains('vtt-ai-on')).toBe(false);
        button(top).click();
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
    });

    test('the badge ships its CSS in styles.css, not as an injected style', () => {
        const css = require('fs').readFileSync(require('path').join(__dirname, '../../../apps/rezka/src/assets/styles.css'), 'utf8') as string;
        mountAIBadge(header());
        expect(document.querySelector('style')).toBeNull();
        expect(css).toContain('#vtt-ai-badge');
        expect(css).toContain('#vtt-ai-panel');
        expect(css).toContain('#vtt-ai-warn');
        expect(css).not.toMatch(/#vtt-ai-badge\s*\{[^}]*!important/);
        expect(css).not.toMatch(/vtt-lookup-open #vtt-ai-badge\s*\{[^}]*!important/);
    });

    test('a warning still being decided when the badge unmounts shows nothing', async () => {
        jest.useFakeTimers();
        try {
            const top = header();
            const unmount = mountAIBadge(top);
            await saveBalance(balance(450_000));
            unmount(); // takeWarning is still awaiting storage
            for (let i = 0; i < 10; i++) await Promise.resolve();
            expect(document.getElementById('vtt-ai-warn')).toBeNull();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test('unmounting cancels the pending warning timer', async () => {
        jest.useFakeTimers();
        try {
            const top = header();
            const unmount = mountAIBadge(top);
            await saveBalance(balance(450_000));
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            expect(document.getElementById('vtt-ai-warn')).not.toBeNull();
            unmount();
            expect(jest.getTimerCount()).toBe(0);
            expect(document.getElementById('vtt-ai-warn')).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    test('a click opens the two bars and nothing else', async () => {
        const top = header();
        await saveBalance(balance(100_000));
        mountAIBadge(top);
        await flush();
        top.querySelector<HTMLButtonElement>('#vtt-ai-badge button')!.click();
        const panel = top.querySelector('#vtt-ai-panel')!;
        expect(panel.querySelectorAll('[role=progressbar]')).toHaveLength(2);
        expect(panel.querySelectorAll('button')).toHaveLength(0);
        expect(panel.textContent).not.toMatch(/Swap|Shift\+S/);
        document.body.click();
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
    });

    test('crossing the warn ratio says so once', async () => {
        const top = header();
        mountAIBadge(top);
        await flush();
        await saveBalance(balance(420_000));
        await flush();
        expect(document.getElementById('vtt-ai-warn')?.textContent).toBe('AI is almost used up for today');
        document.getElementById('vtt-ai-warn')!.remove();
        await saveBalance(balance(430_000));
        await flush();
        expect(document.getElementById('vtt-ai-warn')).toBeNull();
    });
});

describe('refreshBalance', () => {
    test('retries a 401 with a fresh token and keeps the answer', async () => {
        signIn();
        const fetch = jest
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 401 })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => wire(42) });
        const token = jest.fn(async (refresh: boolean) => ({ idToken: refresh ? 'fresh' : 'stale' }));
        const b = await refreshBalance('https://api.example', { fetch, token });
        expect(b?.day.used).toBe(42);
        expect(fetch.mock.calls[1][0]).toBe('https://api.example/dictionary/ai/balance');
        expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
        expect((await loadBalance())?.day.used).toBe(42);
    });

    test('signed out or unreachable is null, nothing stored', async () => {
        const token = jest.fn(async () => {
            throw new Error('Not signed in');
        });
        expect(await refreshBalance('https://api.example', { fetch: jest.fn(), token })).toBeNull();
        expect(await refreshBalance('', { fetch: jest.fn(), token })).toBeNull();
        expect(store[BALANCE_KEY]).toBeUndefined();
    });
});

describe('badge edges', () => {
    function header(): HTMLElement {
        document.body.innerHTML = '<div id="vtt-header-top"></div>';
        return document.getElementById('vtt-header-top')!;
    }

    test('an open panel re-renders with the new numbers', async () => {
        const top = header();
        await saveBalance(balance(100_000));
        mountAIBadge(top);
        await flush();
        top.querySelector<HTMLButtonElement>('#vtt-ai-badge button')!.click();
        const now = () => [...top.querySelectorAll('#vtt-ai-panel [role=progressbar]')].map((b) => b.getAttribute('aria-valuenow'));
        expect(now()[0]).toBe('80'); // share left
        await saveBalance(balance(300_000));
        expect(top.querySelectorAll('#vtt-ai-panel')).toHaveLength(1);
        expect(now()[0]).toBe('40');
        expect(top.querySelector('#vtt-ai-badge button')!.getAttribute('aria-expanded')).toBe('true');
    });

    test('a spent window turns the badge red and titles it with the limit', async () => {
        const top = header();
        mountAIBadge(top);
        await flush();
        await saveBalance(balance(500_000, 1, 'day'));
        const badge = top.querySelector('#vtt-ai-badge')!;
        expect(badge.classList.contains('vtt-ai-out')).toBe(true);
        expect(badge.querySelector('button')!.getAttribute('data-tip')).toMatch(/^AI limit for today reached/);
        await saveBalance(balance(1));
        expect(badge.classList.contains('vtt-ai-out')).toBe(false);
        expect(badge.querySelector('button')!.getAttribute('data-tip')).toMatch(/^AI tokens left today\n/);
    });

    // The ring (owner, 2026-10-12): its arc is today's share left; spent, it is a closed red ring.
    describe('the ring', () => {
        const C = 2 * Math.PI * 7;
        const mounted = async (b: AIBalance) => {
            const top = header();
            await saveBalance(b);
            mountAIBadge(top);
            await flush();
            const badge = top.querySelector<HTMLElement>('#vtt-ai-badge')!;
            const arc = badge.querySelector<SVGCircleElement>('svg.vtt-ai-ring circle.vtt-ai-arc')!;
            const share = () => Number(arc.getAttribute('stroke-dasharray')!.split(' ')[0]) / C;
            return { badge, arc, share, label: () => badge.querySelector('button')!.textContent!.trim() };
        };

        test('the arc is the share left today, next to the tokens left', async () => {
            const r = await mounted(balance(100_000));
            expect(r.share()).toBeCloseTo(0.8, 2);
            expect(r.label()).toBe('AI 400k');
            expect(r.badge.className).toBe('');
        });

        test('past the warn ratio the badge turns amber', async () => {
            const r = await mounted(balance(420_000));
            expect(r.share()).toBeCloseTo(0.16, 2);
            expect(r.badge.classList.contains('vtt-ai-high')).toBe(true);
            expect(r.badge.classList.contains('vtt-ai-out')).toBe(false);
        });

        test('spent today: a closed red ring, no cross, and the reset time instead of zero', async () => {
            const r = await mounted(balance(500_000, 1, 'day'));
            expect(r.share()).toBeCloseTo(1, 3);
            expect(r.badge.classList.contains('vtt-ai-out')).toBe(true);
            expect(r.badge.classList.contains('vtt-ai-high')).toBe(false);
            expect(r.badge.querySelectorAll('svg.vtt-ai-ring path, svg.vtt-ai-ring line')).toHaveLength(0);
            expect(r.label()).toBe(`AI ${localTime(DAY_RESET)}`);
        });

        test('spent this month: the same closed ring, and the reset date', async () => {
            const r = await mounted(balance(10_000, 10_000_000, 'month'));
            expect(r.share()).toBeCloseTo(1, 3);
            expect(r.badge.classList.contains('vtt-ai-out')).toBe(true);
            expect(r.label()).toBe(`AI ${localDate(MONTH_RESET)}`);
        });

        test('the ring follows a new balance in place', async () => {
            const r = await mounted(balance(100_000));
            await saveBalance(balance(250_000));
            expect(r.share()).toBeCloseTo(0.5, 2);
            expect(r.badge.querySelectorAll('svg.vtt-ai-ring')).toHaveLength(1);
        });
    });

    // Hovering explains the number and that AI runs in demo mode, spent or not.
    test('the hover text says what the number is and that this is demo mode', async () => {
        const top = header();
        mountAIBadge(top);
        await flush();
        await saveBalance(balance(1));
        const demo = 'Demo mode: AI is free within a daily and a monthly limit';
        const button = top.querySelector<HTMLButtonElement>('#vtt-ai-badge button')!;
        // The panel's own instant bubble ([data-tip]), not the native title that waits ~1s.
        expect(button.getAttribute('data-tip')).toBe(`AI tokens left today\n${demo}`);
        expect(button.hasAttribute('title')).toBe(false);
        expect(button.getAttribute('aria-label')).toBe(button.getAttribute('data-tip'));
        await saveBalance(balance(500_000, 1, 'day'));
        expect(button.getAttribute('data-tip')).toMatch(/^AI limit for today reached.*\nDemo mode: /s);
    });

    test('the month warning, Escape closes, a second click closes', async () => {
        signIn(); // signed in, balance not read yet: nothing to open
        const top = header();
        mountAIBadge(top);
        await flush();
        const button = top.querySelector<HTMLButtonElement>('#vtt-ai-badge button')!;
        button.click();
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
        await saveBalance(balance(100_000, 8_500_000));
        await flush();
        expect(document.getElementById('vtt-ai-warn')?.textContent).toBe('AI is almost used up for this month');
        button.click();
        expect(top.querySelector('#vtt-ai-panel')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(top.querySelector('#vtt-ai-panel')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
        button.click();
        top.querySelector<HTMLElement>('#vtt-ai-panel')!.click(); // inside: stays
        expect(top.querySelector('#vtt-ai-panel')).not.toBeNull();
        button.click();
        expect(top.querySelector('#vtt-ai-panel')).toBeNull();
    });

    test('the warning note goes away by itself', async () => {
        jest.useFakeTimers();
        try {
            const top = header();
            mountAIBadge(top);
            await saveBalance(balance(420_000));
            await jest.advanceTimersByTimeAsync(0);
            expect(document.getElementById('vtt-ai-warn')).not.toBeNull();
            await jest.advanceTimersByTimeAsync(8000);
            expect(document.getElementById('vtt-ai-warn')).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    test('an orphaned context: the refresh ask throwing does not break the mount', () => {
        sendMessage.mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });
        const top = header();
        expect(() => mountAIBadge(top)).not.toThrow();
        expect(top.querySelector('#vtt-ai-badge')).not.toBeNull();
    });

    test('the refresh callback reads lastError without throwing', () => {
        sendMessage.mockImplementation((_m: unknown, cb: () => void) => cb());
        expect(() => mountAIBadge(header())).not.toThrow();
    });
});

describe('store and fetch edges', () => {
    test('loadBalance is null when storage throws', async () => {
        local.get.mockImplementationOnce(async () => {
            throw new Error('gone');
        });
        expect(await loadBalance()).toBeNull();
    });

    test('onBalance is a no-op unsubscribe when the listener cannot be added', () => {
        const onChanged = (global as any).chrome.storage.onChanged;
        const add = onChanged.addListener;
        onChanged.addListener = () => {
            throw new Error('gone');
        };
        try {
            const off = onBalance(() => undefined);
            expect(() => off()).not.toThrow();
        } finally {
            onChanged.addListener = add;
        }
    });

    test('unsubscribing in an orphaned context does not throw', () => {
        const onChanged = (global as any).chrome.storage.onChanged;
        const remove = onChanged.removeListener;
        const off = onBalance(() => undefined);
        onChanged.removeListener = () => {
            throw new Error('gone');
        };
        try {
            expect(() => off()).not.toThrow();
        } finally {
            onChanged.removeListener = remove;
        }
    });

    test('onBalance ignores other areas and other keys', () => {
        const seen = jest.fn();
        onBalance(seen);
        listeners.forEach((l) => l({ [BALANCE_KEY]: { newValue: wire(1) } }, 'sync'));
        listeners.forEach((l) => l({ other: { newValue: 1 } }, 'local'));
        expect(seen).not.toHaveBeenCalled();
    });

    test('a non-ok answer is null and stores nothing', async () => {
        const fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
        const token = jest.fn(async () => ({ idToken: 't' }));
        expect(await refreshBalance('https://api.example/', { fetch, token })).toBeNull();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe('https://api.example/dictionary/ai/balance');
        expect(store[BALANCE_KEY]).toBeUndefined();
    });

    test('a malformed ok answer is null and stores nothing', async () => {
        const fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: 1 }) });
        expect(await refreshBalance('https://api.example', { fetch, token: async () => ({ idToken: 't' }) })).toBeNull();
        expect(store[BALANCE_KEY]).toBeUndefined();
    });
});

describe('the notice on an empty phrase card', () => {
    const phrase = { term: 'give it a shot', lemma: 'give it a shot', translations: [], parts_of_speech: [], source: '' };
    const text = (html: string) => {
        const d = document.createElement('div');
        d.innerHTML = html;
        return d.textContent;
    };

    test('signed out: AI will translate, with a sign-in button', () => {
        const html = emptyNoticeHtml({ ...phrase, ai_status: 'sign_in_required' });
        expect(text(html)).toContain('Sign in \u2014 AI will translate');
        expect(html).toContain('data-ai-signin');
    });

    test('Google failed and nothing else answered: try again', () => {
        expect(text(emptyNoticeHtml({ ...phrase, googleFailed: true }))).toBe('Google did not answer, try again');
    });

    test('the AI status wins over a Google failure', () => {
        expect(text(emptyNoticeHtml({ ...phrase, googleFailed: true, ai_status: 'limit_day' }))).toMatch(/^AI limit for today/);
    });

    test('a word keeps the card wording, and a plain empty answer has no notice', () => {
        expect(text(emptyNoticeHtml({ ...phrase, lemma: 'shot', ai_status: 'sign_in_required' }))).toContain('Sign in so AI can complete the card');
        expect(emptyNoticeHtml(phrase)).toBe('');
    });
});

describe('card notice edges', () => {
    test('the sign-in click survives an orphaned context', () => {
        sendMessage.mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });
        const box = document.createElement('div');
        box.innerHTML = aiNoticeHtml('sign_in_required');
        wireAINotice(box);
        expect(() => box.querySelector<HTMLButtonElement>('[data-ai-signin]')!.click()).not.toThrow();
    });

    test('the sign-in callback reads lastError; a limit with nothing stored keeps the plain text', async () => {
        sendMessage.mockImplementation((_m: unknown, cb: () => void) => cb());
        const box = document.createElement('div');
        box.innerHTML = aiNoticeHtml('sign_in_required');
        wireAINotice(box);
        box.querySelector<HTMLButtonElement>('[data-ai-signin]')!.click();
        expect(sendMessage).toHaveBeenCalledTimes(1);

        const lim = document.createElement('div');
        lim.innerHTML = aiNoticeHtml('limit_month');
        wireAINotice(lim);
        await flush();
        expect(lim.textContent).toMatch(/^AI limit for this month reached/);
        expect(percentUsed({ used: 0, limit: 0, resetsAt: 0 })).toBe(100);
    });

    test('a root without a notice is left alone', () => {
        expect(() => wireAINotice(document.createElement('div'))).not.toThrow();
    });
});

describe('rules a broken line would slip past', () => {
    test('a spent window gets the limit message, not the 80% warning', async () => {
        expect(await takeWarning(balance(500_000, 100_000, 'day'))).toBeNull();
        expect(await takeWarning(balance(1, 10_000_000, 'month'))).toBeNull();
    });

    test('tokens left never go below zero', () => {
        expect(tokensLeft(balance(600_000).day)).toBe(0);
        expect(tokensLeft(balance(400_000).day)).toBe(100_000);
    });

    test('the month limit names the month reset, the day limit the day reset', () => {
        const b = balance(1);
        expect(limitText('month', b)).toBe(`AI limit for this month reached, resets on ${localDate(MONTH_RESET)}`);
        expect(limitText('day', b)).toBe(`AI limit for today reached, resets at ${localTime(DAY_RESET)}`);
    });

    test('a full window is red, 80% amber', () => {
        const fill = (used: number) => renderBars(balance(used, 1)).querySelector('.lg-ai-fill')!.className;
        expect(fill(500_000)).toContain('lg-ai-full');
        expect(fill(400_000)).toContain('lg-ai-high');
        expect(fill(100_000)).toBe('lg-ai-fill');
    });

    test('amber follows the balance warnRatio, as the warning does', async () => {
        const b = { ...balance(300_000, 1), warnRatio: 0.5 };
        expect(renderBars(b).querySelector('.lg-ai-fill')!.className).toContain('lg-ai-high');
        expect(await takeWarning(b)).toBe('day');
    });

    test('a sign-out during the call keeps the balance gone', async () => {
        // Signed out while the answer was on its way: clearAuthState already ran.
        await keepBalance(wire(9));
        const fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => wire(42) }));
        await refreshBalance('https://api.example', { fetch, token: async () => ({ idToken: 't' }) } as never);
        expect(store[BALANCE_KEY]).toBeUndefined();
    });

    test('an unknown exhausted value reads as not exhausted', () => {
        expect(parseBalance({ ...wire(1), exhausted: 'week' })?.exhausted).toBeNull();
    });
});
