// /uninstall/ only, inlined by build.mjs ahead of the analytics block (english repo spec 039).
// The extension puts the removed installation's ID in the fragment, which no server receives:
// keep it for main.js's report, then drop it from the address before gtag reads page_location.
(function () {
  var m = /(?:^#|&)i=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:&|$)/.exec(location.hash);
  if (!m) return;
  window.__REMOVED_INSTALLATION = m[1];
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
    location.hash = '';
  }
})();
