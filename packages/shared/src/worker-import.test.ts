/** @jest-environment node */
// The service worker imports this whole package and has no window or document:
// a module that touches either at load time kills the worker on start.

test('the shared package loads where there is no window, as in the service worker', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    await expect(import('./index')).resolves.toBeDefined();
});
