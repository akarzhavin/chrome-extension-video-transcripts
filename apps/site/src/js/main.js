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

  // /welcome2/ (English-only experiment): name the sites the install actually
  // covers, and lead with the one the visitor came from. `slug` is a URL
  // parameter, so it is only ever used to look up a key in the build-time
  // __W2.copy map — an unknown value falls through to the generic page rather
  // than reaching the DOM.
  var w2Opens = document.getElementById('w2-opens');
  if (w2Opens && window.__W2 && window.__W2.copy[extSlug]) {
    var w2 = window.__W2.copy[extSlug];

    // "Thanks for installing Lingogram" -> "... for YouTube and Netflix".
    if (extName) extName.textContent = 'Lingogram for ' + w2.sites;

    var lede = document.querySelector('.w2-lede');
    if (lede) {
      lede.innerHTML = 'Now just watch ' + w2.sites.replace(/&/g, '&amp;') +
        ' the way you always do — <b>subtitles turn dual on their own</b>, ' +
        'and any word in them is one tap from your dictionary.';
    }

    // Reorder the buttons so the visitor's own site comes first, and drop the
    // ones this install doesn't cover.
    // Keyed off the badge class. Matching must be exact: the element carries
    // `mark mark-sm mark-yt`, so a greedy /.*mark-(\w+)/ would capture "sm".
    var order = { yt: 'youtube', nf: 'netflix', hd: 'rezka' };
    var cards = {};
    [].slice.call(w2Opens.children).forEach(function (a) {
      var m = a.querySelector('.mark');
      if (!m) return;
      for (var k in order) {
        if (m.classList.contains('mark-' + k)) cards[order[k]] = a;
      }
    });
    var wanted = w2.order.map(function (s) { return cards[s]; }).filter(Boolean);

    if (wanted.length) {
      w2Opens.replaceChildren.apply(w2Opens, wanted);
      wanted.forEach(function (a, i) {
        a.classList.toggle('w2-open-primary', i === 0);
      });
    }

    // Rezka installs almost always happen from an open film tab, so the page
    // leads with "go back and reload" — repeating it below would nag.
    if (extSlug === 'rezka') {
      var h = document.getElementById('w2-cta-h');
      var s = document.getElementById('w2-cta-s');
      if (h) h.textContent = 'Your film is probably already open?';
      if (s) s.textContent = 'Go back to that tab and reload it — then just press play.';
      var refresh = document.getElementById('w2-refresh');
      if (refresh) refresh.hidden = true;
    }
  }

  // Click-to-play: the poster is a plain image until someone asks for the
  // video, so YouTube's player (and its cookies) never load on a page most
  // people only glance at.
  var w2Facade = document.getElementById('w2-facade');
  if (w2Facade && window.__W2) {
    w2Facade.addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.className = 'w2-frame';
      frame.src = 'https://www.youtube-nocookie.com/embed/' + window.__W2.video +
        '?autoplay=1&rel=0&modestbranding=1';
      frame.title = 'How Lingogram works';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.setAttribute('allowfullscreen', '');
      document.getElementById('w2-video').replaceChildren(frame);
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
