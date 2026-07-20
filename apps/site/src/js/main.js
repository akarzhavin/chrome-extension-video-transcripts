// Progressive enhancement for the Lingogram site. Every block is guarded by an
// element check so one bundle serves all pages.
(function () {
  'use strict';

  // Mobile nav: close the dropdown after a link is tapped.
  var mnav = document.querySelector('.mnav');
  if (mnav) {
    mnav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') mnav.removeAttribute('open');
    });
  }

  // Welcome / uninstall pages: tailor copy to the edition from ?ext=<slug>.
  var extName = document.querySelector('[data-ext-name]');
  if (extName && window.__EDITIONS) {
    var slug = new URLSearchParams(location.search).get('ext');
    var ed = window.__EDITIONS[slug];
    if (ed) extName.textContent = ed;
  }

  // Uninstall page: send feedback via mailto (no backend yet).
  var fb = document.getElementById('feedback-form');
  if (fb) {
    fb.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = document.getElementById('feedback-text').value.trim();
      var addr = fb.getAttribute('data-mailto');
      location.href = 'mailto:' + addr +
        '?subject=' + encodeURIComponent('Lingogram uninstall feedback') +
        '&body=' + encodeURIComponent(text);
    });
  }
})();
