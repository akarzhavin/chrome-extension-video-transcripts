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
  var extSlug = new URLSearchParams(location.search).get('ext');
  if (extName && window.__EDITIONS) {
    var ed = window.__EDITIONS[extSlug];
    if (ed) extName.textContent = ed;
  }

  // /welcome/: name the sites this install actually covers, and lead with the
  // one the visitor came from. extSlug is a URL parameter, so it is only ever
  // used to look up a key in the build-time __WELCOME.copy map — an unknown
  // value fails the guard and leaves the generic page standing, and never
  // reaches the DOM.
  // hasOwnProperty, not a plain lookup: `?ext=constructor` would otherwise
  // find a prototype member, pass the guard, and print garbage into the
  // headline instead of falling through to the generic page.
  var wlOpens = document.getElementById('wl-opens');
  var wlCopy = window.__WELCOME && window.__WELCOME.copy;
  if (wlOpens && wlCopy && Object.prototype.hasOwnProperty.call(wlCopy, extSlug)) {
    var wl = wlCopy[extSlug];

    // Every string comes from window.__WELCOME.i18n, already translated by
    // build.mjs — this file ships one copy for all 42 locales and so must
    // never hold English of its own (same rule as the /languages/ filter).
    // `sites` is a list of brand names, so it is the one part not translated.
    var wlT = window.__WELCOME.i18n || {};
    // Two forms of the same list: raw for the textContent sink below, and
    // &-escaped for the innerHTML one. Escaping the textContent copy would
    // print a literal "&amp;".
    var sites = wl.sites.replace(/&/g, '&amp;');

    // "Thanks for installing Lingogram" -> "... for YouTube and Netflix".
    if (extName && wlT.h1) extName.textContent = wlT.h1.replace('{sites}', wl.sites);

    var lede = document.querySelector('.wl-lede');
    if (lede && wlT.lede) lede.innerHTML = wlT.lede.replace('{sites}', sites);

    // Reorder the buttons so the visitor's own site comes first, and drop the
    // ones this install doesn't cover.
    // Keyed off the badge class. Matching must be exact: the element carries
    // `mark mark-sm mark-yt`, so a greedy /.*mark-(\w+)/ would capture "sm".
    var order = { yt: 'youtube', nf: 'netflix', hd: 'rezka' };
    var cards = {};
    [].slice.call(wlOpens.children).forEach(function (a) {
      var m = a.querySelector('.mark');
      if (!m) return;
      for (var k in order) {
        if (m.classList.contains('mark-' + k)) cards[order[k]] = a;
      }
    });
    var wanted = wl.order.map(function (s) { return cards[s]; }).filter(Boolean);

    if (wanted.length) {
      wlOpens.replaceChildren.apply(wlOpens, wanted);
      wanted.forEach(function (a, i) {
        a.classList.toggle('wl-open-primary', i === 0);
      });
    }

    // Rezka installs almost always happen from an open film tab, so the page
    // leads with "go back and reload" — repeating it below would nag.
    if (extSlug === 'rezka') {
      var h = document.getElementById('wl-cta-h');
      var s = document.getElementById('wl-cta-s');
      if (h && wlT.rezkaCtaH) h.textContent = wlT.rezkaCtaH;
      if (s && wlT.rezkaCtaS) s.textContent = wlT.rezkaCtaS;
      var refresh = document.getElementById('wl-refresh');
      if (refresh) refresh.hidden = true;
    }
  }

  // Click-to-play: the poster is a plain image until someone asks for the
  // video, so YouTube's player (and its cookies) never load on a page most
  // people only glance at.
  var wlFacade = document.getElementById('wl-facade');
  if (wlFacade && window.__WELCOME) {
    wlFacade.addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.className = 'wl-frame';
      frame.src = 'https://www.youtube-nocookie.com/embed/' + window.__WELCOME.video +
        '?autoplay=1&rel=0&modestbranding=1';
      // Falls back to the facade's own localized aria-label.
      frame.title = wlFacade.getAttribute('aria-label') || 'Lingogram';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.setAttribute('allowfullscreen', '');
      document.getElementById('wl-video').replaceChildren(frame);
    });
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
