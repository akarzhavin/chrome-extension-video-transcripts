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

  // /languages/: filter the region lists down as you type.
  //
  // The field is BUILT HERE rather than in the page markup: with JS off the
  // grouped list is still complete and usable, and no dead input is left
  // promising a filter that cannot run. Every string comes off the host's
  // data-* attributes, already translated by build.mjs — this file ships one
  // copy for all 42 locales and so must never hold English of its own.
  var langHost = document.getElementById('lang-search-host');
  var langRegions = document.getElementById('lang-regions');
  if (langHost && langRegions) {
    var pluralRules = new Intl.PluralRules(document.documentElement.lang || 'en');
    var entries = [].slice.call(langRegions.querySelectorAll('.lang-entry'));
    var regions = [].slice.call(langRegions.querySelectorAll('[data-region]'));

    var wrap = document.createElement('div');
    wrap.className = 'lang-search-wrap';
    var field = document.createElement('input');
    field.type = 'text';
    field.className = 'lang-search-field';
    field.autocomplete = 'off';
    field.placeholder = langHost.getAttribute('data-search-label');
    field.setAttribute('aria-label', langHost.getAttribute('data-search-label'));
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'lang-search-clear';
    clearBtn.setAttribute('aria-label', langHost.getAttribute('data-clear-label'));
    clearBtn.textContent = '×';
    wrap.appendChild(field);
    wrap.appendChild(clearBtn);
    langHost.appendChild(wrap);

    // Result count and empty state sit between the field and the list.
    var count = document.createElement('p');
    count.className = 'lang-count';
    count.hidden = true;
    var empty = document.createElement('div');
    empty.className = 'lang-no-match';
    empty.hidden = true;
    var emptyTitle = document.createElement('b');
    emptyTitle.textContent = langHost.getAttribute('data-empty');
    empty.appendChild(emptyTitle);
    empty.appendChild(document.createTextNode(langHost.getAttribute('data-empty-hint')));
    langRegions.parentNode.insertBefore(count, langRegions);
    langRegions.parentNode.insertBefore(empty, langRegions);

    var apply = function () {
      var q = field.value.trim().toLowerCase();
      wrap.classList.toggle('has-query', q !== '');

      if (!q) {
        entries.forEach(function (a) { a.hidden = false; });
        regions.forEach(function (r) { r.hidden = false; });
        count.hidden = true;
        empty.hidden = true;
        return;
      }

      var hits = 0;
      entries.forEach(function (a) {
        var match = a.getAttribute('data-search').indexOf(q) !== -1;
        a.hidden = !match;
        if (match) hits += 1;
      });
      // A region with nothing left hides its heading too, so the page never
      // shows a rule and a title over empty space.
      regions.forEach(function (r) {
        r.hidden = !r.querySelector('.lang-entry:not([hidden])');
      });

      empty.hidden = hits > 0;
      count.hidden = hits === 0;
      // CLDR plural categories, not a one/many binary — Slavic and Arabic
      // need "few"/"many" as distinct from "other" or the count sentence
      // reads with wrong agreement (e.g. Russian "2 языка" vs "5 языков").
      // data-count-<category> attributes are rendered per locale by
      // build.mjs; data-count-other is the mandatory fallback every locale
      // provides, so a category this locale didn't bother declaring still
      // degrades to a grammatically-safe string instead of `undefined`.
      var category = pluralRules.select(hits);
      var template = langHost.getAttribute('data-count-' + category) ||
        langHost.getAttribute('data-count-other');
      // toLocaleString, not the raw number: locales with their own digit
      // script (fa, bn, ar, hi keep Latin digits by choice) render {n} in
      // that script instead of mixing Latin digits into native-script copy.
      count.textContent = template.replace('{n}', hits.toLocaleString(document.documentElement.lang));
    };

    field.addEventListener('input', apply);
    clearBtn.addEventListener('click', function () {
      field.value = '';
      apply();
      field.focus();
    });
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && field.value) {
        field.value = '';
        apply();
      }
    });
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
