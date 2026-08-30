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
      // Only this edition gets the coverage notice. It ships inside an
      // inert <template>, so the other editions' variants of this page never
      // have it in the DOM at all — stamping it out here is what creates it.
      var coverTpl = document.getElementById('wl-cover-tpl');
      if (coverTpl && coverTpl.content && coverTpl.content.firstElementChild) {
        coverTpl.parentNode.replaceChild(coverTpl.content.firstElementChild, coverTpl);
      }
    }
  }

  // The one button whose address this site does not store joined. The pair is
  // chosen at build time (REZKA_MATCH in build.mjs — the single source, also
  // printed by the coverage notice) and shipped as two fields; they are joined
  // only here, at click time. Nothing in the served HTML or JSON is a usable
  // address on its own.
  //
  // Assembled on click rather than on load so the page never carries a live
  // outbound link it did not need: a visitor who does not press it never has
  // one in their DOM. It is a real <button>, so focus and Enter/Space come
  // from the browser, not from shims here.
  var openRezka = document.querySelector('[data-open-rezka]');
  if (openRezka && window.__WELCOME && window.__WELCOME.rezka) {
    openRezka.addEventListener('click', function () {
      var pair = window.__WELCOME.rezka;
      if (!pair.name || !pair.zone) return;
      window.open('https://' + pair.name + '.' + pair.zone + '/', '_blank', 'noopener');
    });
  }


  // "Back" on doc pages: prefer real history when the visitor came from
  // this site, so it returns to the exact page (query string included);
  // anyone who landed here directly follows the link's own href instead.
  var docBack = document.querySelector('[data-back]');
  if (docBack) {
    docBack.addEventListener('click', function (e) {
      // Modified clicks keep their browser meaning (new tab, new window);
      // this handler only claims a plain left click. The referrer check is
      // against the origin BOUNDARY — a bare prefix test would also match
      // origins that merely start with ours.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (history.length > 1 && document.referrer.indexOf(location.origin + '/') === 0) {
        e.preventDefault();
        history.back();
      }
    });
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
      // The click destroyed the focused button. Without this, focus falls back
      // to <body> and the next Tab restarts from the top of the document
      // instead of carrying on past the video — so a keyboard visitor who
      // pressed Enter to play loses their place. tabIndex lets the iframe take
      // focus programmatically without adding a second tab stop of its own.
      frame.tabIndex = -1;
      frame.focus();
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

  // ---------------------------------------------------------- /uninstall/
  //
  // A plain form: tick the reasons that apply, optionally add a note, press
  // the button. NOTHING is sent before that press — the visitor is never
  // recorded behind their own back, and a page they abandon leaves no trace.
  //
  // The answer goes into the Firestore `feedback` collection, the same one
  // (and the same global daily quota) the extension's rating card writes.
  // Signed out and unauthenticated: the rules allow that path with uid === "",
  // which is the whole point — the people worth hearing from at this moment
  // are mostly the ones who never made an account.
  //
  // Mirrors addFeedback() in packages/shared/src/auth/firestoreRest.ts. It is
  // reimplemented rather than imported because this file is copied verbatim
  // into build/ with no bundler, and pulling the shared module in would drag
  // the whole auth stack onto a page that never signs anyone in.
  var fb = document.getElementById('feedback-form');
  // The payload is an inline script; this file is `defer` and separately
  // cached, so the two can come apart — a CSP that drops inline scripts, or a
  // cached main.js meeting a rebuilt page. Guarding the whole block on the
  // payload used to leave the browser to submit `action="mailto:" method=post`
  // natively, which Chrome does not act on: Send did nothing at all, with no
  // status and no way forward. Bind the handler on the form alone and let the
  // missing payload take the mailto path the failure branch already uses.
  if (fb && !window.__UNINSTALL) {
    fb.addEventListener('submit', function (e) {
      e.preventDefault();
      var picked = [].slice.call(fb.querySelectorAll('input[name=reason]:checked'))
        .map(function (b) { return b.value; });
      var note = document.getElementById('feedback-text');
      var body = ((picked.length ? '[reason:' + picked.join(',') + ']' : '') +
        ' ' + ((note && note.value) || '')).trim();
      if (!body) return;
      // A synthesised anchor click rather than a location assignment: the
      // browser hands mailto: to the mail client without navigating away, so
      // a visitor with no mail client configured keeps the page they are on.
      var a = document.createElement('a');
      a.href = 'mailto:' + fb.getAttribute('data-mailto') +
        '?subject=' + encodeURIComponent('Lingogram uninstall feedback') +
        '&body=' + encodeURIComponent(body);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
  if (fb && window.__UNINSTALL) {
    var UN = window.__UNINSTALL;
    var T = UN.i18n || {};
    var opts = fb.querySelector('.uni-opts');
    var status = fb.querySelector('[data-status]');
    var submit = fb.querySelector('button[type=submit]');
    var textEl = document.getElementById('feedback-text');
    var boxes = [].slice.call(fb.querySelectorAll('input[name=reason]'));
    var sent = false;
    var busy = false;

    // Firestore counts UTF-8 BYTES while maxLength counts UTF-16 units, so a
    // Russian message would be silently halved on send. Same clamp as
    // packages/shared/src/feedback.ts, and the same reason it exists.
    var enc = new TextEncoder();
    function utf8Len(s) { return enc.encode(s).length; }
    function clampToBytes(s, max) {
      if (utf8Len(s) <= max) return s;
      var lo = 0, hi = s.length;
      while (lo < hi) {
        var mid = (lo + hi + 1) >>> 1;
        if (utf8Len(s.slice(0, mid)) <= max) lo = mid; else hi = mid - 1;
      }
      // Step back off a lone high surrogate: TextEncoder turns it into U+FFFD
      // (3 bytes), which the search above would have accepted as fitting.
      while (lo > 0) {
        var c = s.charCodeAt(lo - 1);
        if (c >= 0xd800 && c <= 0xdbff) lo--; else break;
      }
      return s.slice(0, lo);
    }

    function todayBucket() {
      var d = new Date();
      return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    }

    function setStatus(text, kind) {
      status.textContent = text || '';
      status.className = 'uni-status' + (kind ? ' uni-status-' + kind : '');
    }

    function checked() {
      return boxes.filter(function (b) { return b.checked; })
        .map(function (b) { return b.value; });
    }
    function prose() { return (textEl.value || '').trim(); }

    // Prefix, not a field: the rules pin the doc to a fixed key set, so the
    // reasons ride in `text` where they stay greppable without a rules deploy.
    // Prepended for the same reason the reply address is — a message clamped
    // at the ceiling must not lose the one part that is always machine-read.
    // Comma-joined in the order they appear on screen, not click order, so the
    // same pair of answers always produces the same string.
    function compose() {
      var picked = checked();
      var tag = picked.length ? '[reason:' + picked.join(',') + ']' : '';
      var body = prose();
      return clampToBytes((tag && body) ? tag + ' ' + body : (tag || body), UN.maxBytes);
    }

    // Nothing ticked and nothing typed is nothing to send. Disabling the
    // button says so before the click rather than after it, and it is the only
    // state in which the form is genuinely empty: reasons alone are a complete
    // answer, and so is a note with no boxes ticked.
    function syncSubmit() {
      if (sent || busy) return;
      submit.disabled = !checked().length && !prose();
    }
    opts.addEventListener('change', syncSubmit);
    textEl.addEventListener('input', syncSubmit);
    syncSubmit();

    // Point the reinstall button at the listing of the edition that was
    // actually removed. The static href (the primary listing) stays for
    // unknown slugs and for no JS at all. hasOwnProperty for the same reason
    // as the welcome copy lookup above: `?ext=constructor` must miss.
    var reinstall = document.querySelector('[data-reinstall]');
    if (reinstall && UN.stores &&
        Object.prototype.hasOwnProperty.call(UN.stores, extSlug)) {
      reinstall.href = UN.stores[extSlug];
      // Keep the analytics label in step with the href this just retargeted,
      // so a rezka re-install is not reported as a click on the primary
      // listing. Static builds and unknown slugs keep the rendered default.
      reinstall.setAttribute('data-store', extSlug);
    }

    function mailtoHref(text) {
      return 'mailto:' + fb.getAttribute('data-mailto') +
        '?subject=' + encodeURIComponent('Lingogram uninstall feedback') +
        '&body=' + encodeURIComponent(text);
    }

    // Quota burned, offline, or a lost race. An error with no way forward
    // wastes the one moment this visitor was willing to talk, so the old
    // mailto path becomes the fallback rather than the primary ask.
    function showFailure(text) {
      setStatus((T.failed || '') + ' ', 'err');
      var a = document.createElement('a');
      a.href = mailtoHref(text);
      a.textContent = T.mailtoFallback || '';
      status.appendChild(a);
    }

    // Read today's counter, then commit the doc and its +1 in ONE batch. The
    // read-then-write is racy by construction: two simultaneous senders
    // compute the same next count and one loses the rules' getAfter() check.
    // That is a dropped message, not a corrupted counter — and the caller
    // turns the loss into the mailto offer above.
    function send(text) {
      var cfg = window.LINGOGRAM_AUTH || {};
      var base = cfg.firestoreUrl, pid = cfg.projectId;
      if (!base || !pid) return Promise.resolve(false);
      var docs = base + '/v1/projects/' + pid + '/databases/(default)/documents';
      var day = String(todayBucket());
      var quotaName = 'projects/' + pid + '/databases/(default)/documents/feedbackQuota/' + day;

      return fetch(docs + '/feedbackQuota/' + day)
        .then(function (r) {
          if (r.ok) return r.json().then(function (d) {
            var n = Number((d.fields && d.fields.count && d.fields.count.integerValue) || 0);
            return (isFinite(n) ? n : 0) + 1;
          });
          if (r.status === 404) return 1; // nobody has written today yet
          throw new Error('quota ' + r.status);
        })
        .then(function (next) {
          return fetch(docs + ':commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ writes: [
              {
                update: {
                  // Id pinned to {day}_{count}: it is what stops N docs from
                  // riding a single counter bump (two would need one id).
                  name: 'projects/' + pid + '/databases/(default)/documents/feedback/' + day + '_' + next,
                  fields: {
                    text: { stringValue: text },
                    uid: { stringValue: '' },
                    site: { stringValue: location.hostname.slice(0, 100) },
                    version: { stringValue: '' },
                    locale: { stringValue: (document.documentElement.lang || '').slice(0, 16) },
                    source: { stringValue: UN.source }
                  }
                },
                currentDocument: { exists: false },
                updateTransforms: [{ fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' }]
              },
              {
                update: { name: quotaName, fields: { count: { integerValue: String(next) } } },
                updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
              }
            ] })
          });
        })
        .then(function (r) { return r.ok; })
        .catch(function () { return false; });
    }

    fb.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sent || busy) return;
      var text = compose();
      if (!text) return;
      busy = true;
      submit.disabled = true;
      setStatus(T.sending || '');
      send(text).then(function (ok) {
        busy = false;
        if (ok) {
          sent = true;
          // Collapse the form: leaving a live Send button under a thank-you
          // invites a second submission that the day counter would reject
          // anyway, and reads as though the first one did not land.
          opts.hidden = true;
          textEl.hidden = true;
          fb.querySelector('.uni-actions').hidden = true;
          setStatus(T.sent || '', 'ok');
          return;
        }
        submit.disabled = false;
        showFailure(text);
      });
    });
  }
  // ------------------------------------------------------------- analytics
  //
  // Consent banner + the site's own GA4 events. Both halves are no-ops unless
  // build.mjs emitted a tag (window.LG_GA4), so a local build with no
  // SITE_GA4_MEASUREMENT_ID runs this file unchanged and sends nothing.
  //
  // The consent contract, split across two files by necessity:
  //   - build.mjs (inline <head>) seeds analytics_storage:'denied' BEFORE
  //     gtag.js loads, and upgrades it from storage on a returning visit.
  //   - this file owns the banner UI and the click that updates consent.
  // The storage key and its two values are duplicated between them; changing
  // one without the other silently strands returning visitors at 'denied'.
  var CONSENT_KEY = 'lingogram_consent';

  function consentRead() {
    // Safari's "block all cookies" throws on localStorage access, not just on
    // write — so a bare read has to be guarded like a write.
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }
  function consentWrite(v) {
    try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {}
  }

  // Send an event, but only once consent is granted. GA4 itself would queue
  // and drop the hit under denied consent, so this guard is belt-and-braces;
  // what it really buys is that `track()` is safe to call from anywhere
  // without each call site restating the condition.
  function track(name, params) {
    if (!window.LG_GA4 || typeof window.gtag !== 'function') return;
    if (consentRead() !== 'granted') return;
    window.gtag('event', name, params || {});
  }
  // Exposed so the demo and auth bundles — separate builds, no shared module
  // with this file — can report without each reimplementing the guard.
  window.lgTrack = track;

  var consentEl = document.getElementById('consent');
  if (consentEl && window.LG_GA4) {
    var decided = consentRead();
    // Reveal only for a visitor who has not answered. `hidden` is the
    // server-rendered default precisely so a returning visitor never sees the
    // banner flash before this line runs.
    if (decided !== 'granted' && decided !== 'denied') consentEl.hidden = false;

    consentEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-consent]') : null;
      if (!btn) return;
      var choice = btn.getAttribute('data-consent');
      if (choice !== 'granted' && choice !== 'denied') return;
      consentWrite(choice);
      consentEl.hidden = true;
      if (typeof window.gtag === 'function') {
        window.gtag('consent', 'update', { analytics_storage: choice });
      }
      // The page_view for THIS page was swallowed by the denied default, so
      // an accepting visitor would otherwise be invisible until they clicked
      // through to a second page — and a single-page visit would never be
      // counted at all. Re-send it explicitly.
      if (choice === 'granted') track('page_view');
    });

    // Footer entry point, so a choice is reversible without clearing storage.
    var reopen = document.querySelector('[data-consent-reopen]');
    if (reopen) {
      reopen.addEventListener('click', function () { consentEl.hidden = false; });
    }
  }

  // Store clicks: the one conversion this site has. `edition` comes from the
  // listing URL rather than from the surrounding copy, so a card, a hero
  // button and the uninstall page's re-install banner all report the same
  // value for the same extension.
  //
  // Delegated on document so it covers every store link on every page,
  // including the ones main.js itself rewrites (welcome reordering).
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var url = a.getAttribute('href') || '';
    if (url.indexOf('chromewebstore.google.com') === -1
        && url.indexOf('chrome.google.com/webstore') === -1) return;
    track('store_click', {
      // Which edition, per build.mjs's data-store. Not derived from the URL:
      // the YouTube and Netflix cards share one listing id, so the URL cannot
      // tell them apart while the attribute can.
      edition: (a.getAttribute('data-store') || 'unknown').slice(0, 64),
      // Where on the site the click came from — hero, card, final CTA — so
      // the same listing's clicks can be attributed to a position.
      placement: (a.getAttribute('data-place') || 'other').slice(0, 64),
      page_locale: (document.documentElement.lang || '').slice(0, 16)
    });
  });

})();
