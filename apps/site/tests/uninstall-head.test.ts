/**
 * @jest-environment jsdom
 *
 * The uninstall page's first head script (english repo spec 039), run as the
 * REAL src/js/uninstall-head.js the build inlines ahead of gtag. The extension
 * puts the removed installation's ID in the fragment; this script keeps it for
 * main.js and drops it from the address before analytics reads page_location,
 * which carries the analytics client ID.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HEAD_JS = readFileSync(resolve(__dirname, '../src/js/uninstall-head.js'), 'utf8');
const ID = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';

const taken = () => (window as unknown as { __REMOVED_INSTALLATION?: string }).__REMOVED_INSTALLATION;

function open(address: string): void {
  delete (window as unknown as { __REMOVED_INSTALLATION?: string }).__REMOVED_INSTALLATION;
  window.history.replaceState(null, '', address);
  // eslint-disable-next-line no-new-func
  new Function(HEAD_JS)();
}

it('keeps the ID and leaves the address without it, the query untouched', () => {
  open(`/uninstall/?ext=rezka&cid=cid-abc#i=${ID}`);
  expect(taken()).toBe(ID);
  expect(window.location.href).not.toContain(ID);
  expect(window.location.hash).toBe('');
  expect(window.location.search).toBe('?ext=rezka&cid=cid-abc');
});

it('takes nothing from an address without an ID, or with anything but one', () => {
  for (const address of ['/uninstall/?ext=rezka', '/uninstall/#i=not-an-id', '/uninstall/#x=1']) {
    open(address);
    expect(taken()).toBeUndefined();
  }
});
