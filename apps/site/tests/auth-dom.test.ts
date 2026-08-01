/**
 * @jest-environment jsdom
 *
 * DOM field helpers: blur validation, password show/hide, Caps-Lock hint, and
 * the strength meter. Rendered against the same markup build.mjs emits.
 */
import {
  markField,
  validateEmailField,
  validatePasswordField,
  wirePasswordToggle,
  wireCapsHint,
  wireStrengthMeter,
} from '../src/auth/dom';

// Minimal password-field markup mirroring build.mjs's passwordField().
function passwordFieldHTML(withStrength: boolean): string {
  return `
    <label class="auth-field auth-pw">
      <span>Password</span>
      <span class="auth-pw-wrap">
        <input name="password" type="password">
        <button type="button" class="auth-pw-toggle" data-pw-toggle aria-label="Show password" aria-pressed="false">
          <svg><path class="eye-open"></path><path class="eye-off" style="display:none"></path></svg>
        </button>
      </span>
      <p class="auth-caps" data-caps-hint hidden>Caps Lock is on</p>
      ${withStrength ? `<span class="auth-strength" data-strength hidden><span data-strength-fill></span><span class="auth-strength-label" data-strength-label></span></span>` : ''}
      <p class="auth-field-error" data-field-error="password"></p>
    </label>`;
}

function emailFieldHTML(): string {
  return `
    <label class="auth-field">
      <span>Email</span>
      <input name="email" type="email">
      <p class="auth-field-error" data-field-error="email"></p>
    </label>`;
}

function mount(html: string): void {
  document.body.innerHTML = `<form>${html}</form>`;
}

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

describe('markField / validateEmailField', () => {
  beforeEach(() => mount(emailFieldHTML()));

  it('flags an invalid email on blur', () => {
    const input = $<HTMLInputElement>('input[name="email"]');
    input.value = 'not-an-email';
    validateEmailField(input);
    expect($('.auth-field').classList.contains('is-invalid')).toBe(true);
    expect($('[data-field-error="email"]').textContent).toMatch(/invalid/i);
  });

  it('clears the error for a valid email', () => {
    const input = $<HTMLInputElement>('input[name="email"]');
    input.value = 'jane@example.com';
    validateEmailField(input);
    expect($('.auth-field').classList.contains('is-invalid')).toBe(false);
    expect($('[data-field-error="email"]').textContent).toBe('');
  });

  it('does not nag on an empty field', () => {
    const input = $<HTMLInputElement>('input[name="email"]');
    input.value = '';
    validateEmailField(input);
    expect($('.auth-field').classList.contains('is-invalid')).toBe(false);
  });
});

describe('validatePasswordField', () => {
  beforeEach(() => mount(passwordFieldHTML(false)));

  it('flags a too-short password', () => {
    const input = $<HTMLInputElement>('input[name="password"]');
    input.value = 'short';
    validatePasswordField(input, 8);
    expect($('.auth-field').classList.contains('is-invalid')).toBe(true);
    expect($('[data-field-error="password"]').textContent).toMatch(/at least 8/i);
  });

  it('accepts a long-enough password', () => {
    const input = $<HTMLInputElement>('input[name="password"]');
    input.value = 'longenough';
    validatePasswordField(input, 8);
    expect($('.auth-field').classList.contains('is-invalid')).toBe(false);
  });
});

describe('wirePasswordToggle', () => {
  beforeEach(() => mount(passwordFieldHTML(false)));

  it('toggles the input type and aria-pressed', () => {
    const input = $<HTMLInputElement>('input[name="password"]');
    const btn = $<HTMLButtonElement>('[data-pw-toggle]');
    wirePasswordToggle(input);
    expect(input.type).toBe('password');
    btn.click();
    expect(input.type).toBe('text');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toMatch(/hide/i);
    btn.click();
    expect(input.type).toBe('password');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('wireCapsHint', () => {
  beforeEach(() => mount(passwordFieldHTML(false)));

  it('shows the hint when Caps Lock is reported on, hides otherwise', () => {
    const input = $<HTMLInputElement>('input[name="password"]');
    const hint = $<HTMLElement>('[data-caps-hint]');
    wireCapsHint(input);
    expect(hint.hidden).toBe(true);

    const withCaps = new KeyboardEvent('keydown', { key: 'a' });
    (withCaps as any).getModifierState = (k: string) => k === 'CapsLock';
    input.dispatchEvent(withCaps);
    expect(hint.hidden).toBe(false);

    const noCaps = new KeyboardEvent('keyup', { key: 'a' });
    (noCaps as any).getModifierState = () => false;
    input.dispatchEvent(noCaps);
    expect(hint.hidden).toBe(true);
  });
});

describe('wireStrengthMeter', () => {
  beforeEach(() => mount(passwordFieldHTML(true)));

  it('reveals the meter and sets data-level as the password strengthens', () => {
    const input = $<HTMLInputElement>('input[name="password"]');
    const meter = $<HTMLElement>('[data-strength]');
    const label = $<HTMLElement>('[data-strength-label]');
    wireStrengthMeter(input);
    expect(meter.hidden).toBe(true);

    const type = (v: string) => { input.value = v; input.dispatchEvent(new Event('input')); };

    type('testpass1');
    expect(meter.hidden).toBe(false);
    expect(meter.getAttribute('data-level')).toBe('2');
    expect(label.textContent).toBe('Okay');

    type('Testpass123!xy');
    expect(meter.getAttribute('data-level')).toBe('3');
    expect(label.textContent).toBe('Strong');

    type('');
    expect(meter.hidden).toBe(true);
  });
});
