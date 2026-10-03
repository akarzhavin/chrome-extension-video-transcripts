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

  // /welcome/: only the HDrezka install gets the coverage notice. It ships
  // inside an inert <template>, so the other editions' variants of this page
  // never have it in the DOM at all — stamping it out here is what creates it.
  // extSlug is a URL parameter and is only ever compared, never printed.
  if (extSlug === 'rezka') {
    var coverTpl = document.getElementById('wl-cover-tpl');
    if (coverTpl && coverTpl.content && coverTpl.content.firstElementChild) {
      coverTpl.parentNode.replaceChild(coverTpl.content.firstElementChild, coverTpl);
    }
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
      // so a rezka re-install is not reported as a click on the default
      // listing. Static builds and unknown slugs keep the rendered default.
      //
      // ?ext= names the edition that was UNINSTALLED, which is exactly what
      // this event is about — a netflix uninstall stays `netflix` even though
      // its re-install link is the shared YouTube listing.
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
  // Analytics and the consent banner used to live here. They now ship as
  // analytics.js, built from src/analytics/ and loaded by a <script defer>
  // ahead of this file.
  //
  // They moved out for two reasons this file cannot satisfy. They are the one
  // part of it with a cross-bundle API — window.lgTrack, which the demo and
  // auth bundles call — and the consent key and signal set have to be shared
  // with build.mjs's inline <head> block, which an unbundled file has no way
  // to import.

})();
