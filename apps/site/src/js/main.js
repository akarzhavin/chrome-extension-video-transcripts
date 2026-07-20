// Progressive enhancement for the Lingogram site. Every block is guarded by an
// element check so one bundle serves all pages.
(function () {
  'use strict';

  // Hero demo: clickable subtitle words + translation toggle.
  var en = document.getElementById('enline');
  if (en) {
    var line = en.getAttribute('data-line') || '';
    en.innerHTML = line
      .split(' ')
      .map(function (w) { return '<span class="w" tabindex="0" role="button">' + w + '</span>'; })
      .join(' ');
    var counter = document.getElementById('count');
    var count = counter ? parseInt(counter.textContent, 10) || 0 : 0;
    var toast = document.getElementById('toast');
    var toastTimer;
    en.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.classList || !t.classList.contains('w') || t.classList.contains('saved')) return;
      t.classList.add('saved');
      count++;
      if (counter) counter.textContent = count;
      if (toast) {
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1600);
      }
    });
    en.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); }
    });
    var demo = document.getElementById('demo');
    var btn = document.getElementById('toggle-trans');
    if (demo && btn) {
      btn.addEventListener('click', function () {
        demo.classList.toggle('hide-trans');
        btn.textContent = demo.classList.contains('hide-trans') ? 'Show translation' : 'Hide translation';
      });
    }
  }

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
