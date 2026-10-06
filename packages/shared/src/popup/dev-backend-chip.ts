// Dev builds only: the pill in the popup header that names the live backend and
// advances the ring on click (the same DEV_GET_ENV / DEV_SET_ENV the video
// sidebar's badge uses). English, no i18n: nobody but a developer sees it.
//
// Never reachable from a release bundle: the only caller sits behind an
// `__EXT_ENV__ === 'dev'` literal in popup.ts, and every style here is inline —
// popup.css is copied into the bundle verbatim with no literal to fold it, so a
// rule naming this chip would ship to every user as dead CSS.

import { el, send } from './shared';

interface EnvInfo {
    label: string;
    canSwitch: boolean;
    isProd?: boolean;
    next?: string;
}

export async function mountDevBackendChip(header: HTMLElement, onSwitched: () => void): Promise<void> {
    let info: EnvInfo | undefined;
    try {
        info = await send<EnvInfo>({ action: 'DEV_GET_ENV' });
    } catch {
        return;
    }
    if (!info?.canSwitch) return;

    const chip = el('button', undefined, info.label);
    chip.type = 'button';
    chip.dataset.env = info.isProd ? 'live' : 'safe';
    chip.setAttribute('aria-label', `Backend: ${info.label}. Switch to ${info.next}`);
    chip.title = info.isProd ? 'REAL user data. Click to switch (signs you out).' : 'Click to switch backend (signs you out).';
    const color = info.isProd ? 'var(--lg-danger)' : 'var(--lg-text-dim)';
    chip.style.cssText =
        `margin-left:auto;padding:1px 8px;border-radius:999px;background:none;cursor:pointer;`
        + `font:inherit;font-size:11px;font-weight:${info.isProd ? 600 : 500};line-height:1.5;`
        + `color:${color};border:1px solid ${info.isProd ? 'var(--lg-danger)' : 'var(--lg-border)'};`;
    chip.addEventListener('click', async () => {
        chip.disabled = true;
        try {
            // No side named: the worker advances the ring.
            await send({ action: 'DEV_SET_ENV' });
        } catch (err) {
            console.warn('[Lingogram] dev env switch failed:', err);
        }
        onSwitched();
    });
    header.appendChild(chip);
}
