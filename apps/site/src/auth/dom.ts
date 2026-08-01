// DOM-level field helpers for the landing auth forms. Kept apart from entry.ts
// so they can be unit-tested in jsdom (tests/auth-dom.test.ts) without the
// window.LINGOGRAM_* runtime config the entry needs.
import { EMAIL_RE, scorePassword } from './core';

// Mark a field valid/invalid and show the inline message (blur validation).
export function markField(input: HTMLInputElement, msg: string): void {
  const wrap = input.closest('.auth-field');
  if (!wrap) return;
  const slot = wrap.querySelector('[data-field-error]');
  if (msg) {
    wrap.classList.add('is-invalid');
    if (slot) slot.textContent = msg;
  } else {
    wrap.classList.remove('is-invalid');
    if (slot) slot.textContent = '';
  }
}

export function validateEmailField(input: HTMLInputElement): void {
  const v = input.value.trim();
  if (!v) return markField(input, ''); // don't nag on empty until submit
  markField(input, EMAIL_RE.test(v) ? '' : 'That email address looks invalid.');
}

export function validatePasswordField(input: HTMLInputElement, minLen: number): void {
  const v = input.value;
  if (!v) return markField(input, '');
  markField(input, v.length < minLen ? 'Use at least ' + minLen + ' characters.' : '');
}

// Show/hide toggle for a password input.
export function wirePasswordToggle(input: HTMLInputElement): void {
  const wrap = input.closest('.auth-pw');
  const btn = wrap && wrap.querySelector<HTMLButtonElement>('[data-pw-toggle]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.querySelectorAll<HTMLElement>('.eye-open').forEach((e) => (e.style.display = show ? 'none' : ''));
    btn.querySelectorAll<HTMLElement>('.eye-off').forEach((e) => (e.style.display = show ? '' : 'none'));
    try { input.focus(); } catch (e) {}
  });
}

// Caps-Lock hint: shown while typing in a password with Caps Lock on.
export function wireCapsHint(input: HTMLInputElement): void {
  const wrap = input.closest('.auth-pw');
  const hint = wrap && wrap.querySelector<HTMLElement>('[data-caps-hint]');
  if (!hint) return;
  const update = (e: KeyboardEvent) => {
    const on = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
    hint.hidden = !on;
  };
  input.addEventListener('keydown', update as EventListener);
  input.addEventListener('keyup', update as EventListener);
  input.addEventListener('blur', () => { hint.hidden = true; });
}

export function wireStrengthMeter(input: HTMLInputElement): void {
  const wrap = input.closest('.auth-pw');
  const meter = wrap && wrap.querySelector<HTMLElement>('[data-strength]');
  if (!meter) return;
  const label = meter.querySelector<HTMLElement>('[data-strength-label]');
  const LABELS = ['', 'Weak', 'Okay', 'Strong'];
  input.addEventListener('input', () => {
    const v = input.value;
    if (!v) { meter.hidden = true; return; }
    const s = scorePassword(v);
    meter.hidden = false;
    meter.setAttribute('data-level', String(s));
    if (label) label.textContent = LABELS[s];
  });
}
