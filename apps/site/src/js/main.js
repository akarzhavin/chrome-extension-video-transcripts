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
  // Reason chips -> Firestore `feedback` docs, the same collection (and the
  // same global daily quota) the extension's rating card writes. Signed out
  // and unauthenticated: the rules allow that path with uid === "", which is
  // the whole point — the people worth hearing from at this moment are mostly
  // the ones who never made an account.
  //
  // THE TAP IS THE ANSWER, and it commits immediately. Waiting for a Send
  // press lost the very group the chips exist for: someone taps a chip (which
  // ticks and fills, i.e. reads as done), sees a textarea, decides they have
  // nothing to type, and closes the tab — and a selection held only in a JS
  // variable dies with the page. Not just on cache-clear: a plain reload was
  // enough. The copy already promised "one tap … that's the whole ask" in all
  // 41 locales; this makes the promise true rather than aspirational.
  //
  // Prose, if any, is a SECOND doc carrying a constant "[more]" marker, not an
  // edit of the first: the rules close read and update on this collection, and
  // pin each doc id to {day}_{count} — that pin is what stops N docs riding
  // one counter bump, so handing the client a stable id would dismantle the
  // anti-abuse argument to buy back only the reload case. Two docs from one
  // visitor are two ordinary creates, indistinguishable from two people, which
  // the model already assumes. [more] exists so aggregation counts a person
  // once: skip the marked docs when tallying reasons.
  //
  // Mirrors addFeedback() in packages/shared/src/auth/firestoreRest.ts. It is
  // reimplemented rather than imported because this file is copied verbatim
  // into build/ with no bundler, and pulling the shared module in would drag
  // the whole auth stack onto a page that never signs anyone in.
  var fb = document.getElementById('feedback-form');
  if (fb && window.__UNINSTALL) {
    var UN = window.__UNINSTALL;
    var T = UN.i18n || {};
    var chipBox = fb.querySelector('.uni-chips');
    var more = fb.querySelector('.uni-more');
    var status = fb.querySelector('[data-status]');
    var submit = fb.querySelector('button[type=submit]');
    var textEl = document.getElementById('feedback-text');
    var reason = '';
    var sent = false;
    // The tap's outcome as a PROMISE, not a boolean: Send can be pressed while
    // the tap is still in flight, and a flag would read false there and send a
    // duplicate. null means no tap has been sent yet.
    var tapPromise = null;

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

    // Picking a chip IS the answer: it commits on the spot and then reveals
    // the optional prose. Radio semantics on buttons: aria-pressed carries the
    // state a native radio group would, and now it means "recorded" rather
    // than "pending", which is what the tick already looked like it meant.
    chipBox.addEventListener('click', function (e) {
      var btn = e.target.closest('.uni-chip');
      if (!btn) return;
      if (sent) return;
      // The selection always follows the last tap, even when the send below is
      // skipped — the UI must never show a chip the visitor did not pick.
      reason = btn.getAttribute('data-reason');
      [].slice.call(chipBox.querySelectorAll('.uni-chip')).forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      if (more.hidden) {
        more.hidden = false;
        // Only steal focus once, and never on the first paint: moving the
        // caret into a textarea the visitor did not ask for is how a one-tap
        // form turns back into an essay prompt — and doubly wrong now that
        // the answer is already in.
        more.classList.add('uni-more-in');
      }

      // Only the FIRST tap writes. A double-click or a change of mind must not
      // spend a second slot of the day's global quota: the switch is kept in
      // `reason` and rides out with the prose doc if one is sent. Debouncing
      // the send to absorb switches would reopen the very window this change
      // closes, so the first tap wins.
      if (tapPromise) return;

      // Not optimistic: announcing "thank you" and then replacing it with
      // "couldn't send" is worse for a screen reader than a brief "Sending…".
      setStatus(T.sending || '');
      var text = composeTag();
      tapPromise = send(text);
      tapPromise.then(function (ok) {
        if (sent) return;
        if (ok) setStatus(T.sent || '', 'ok');
        // The chips stay open on success: the visitor may still add prose.
        else showFailure(text);
      });
    });

    // Prefix, not a field: the rules pin the doc to a fixed key set, so the
    // reason rides in `text` where it stays greppable without a rules deploy.
    // Prepended for the same reason the reply address is — a message clamped
    // at the ceiling must not lose the one part that is always machine-read.
    function composeTag() {
      return reason ? '[reason:' + reason + ']' : '';
    }

    // The prose doc. `marked` adds [more] so a tally can skip it and count the
    // visitor once; it is left off when this doc is the ONLY one (the tap
    // never landed), because then there is nothing to double-count.
    function composeFull(marked) {
      var body = (textEl.value || '').trim();
      var tag = composeTag() + (marked ? ' [more]' : '');
      return clampToBytes((tag && body) ? tag + ' ' + body : (tag || body), UN.maxBytes);
    }

    function mailtoHref(text) {
      return 'mailto:' + fb.getAttribute('data-mailto') +
        '?subject=' + encodeURIComponent('Lingogram uninstall feedback') +
        '&body=' + encodeURIComponent(text);
    }

    // Quota burned, offline, or a lost race. An error with no way forward
    // wastes the one moment this visitor was willing to talk, so the old
    // mailto path becomes the fallback rather than the primary ask. Shared by
    // the tap and the submit, and carries the fullest text either one had.
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
    // turns the loss into the mailto offer below.
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

    // Collapse to the bare thank-you. Leaving a live Send button under it
    // invites a second submission the day counter would reject anyway, and
    // reads as though the first one did not land.
    function finish() {
      sent = true;
      more.hidden = true;
      chipBox.hidden = true;
      setStatus(T.sent || '', 'ok');
    }

    fb.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sent) return;
      submit.disabled = true;
      // Chained off the tap rather than a flag: Send can be pressed while the
      // tap is still in flight, and both orderings must reach the same branch.
      // A tap that never happened resolves false, i.e. "nothing is recorded".
      (tapPromise || Promise.resolve(false)).then(function (tapOk) {
        // Order matters: the tap's outcome is checked BEFORE the box is found
        // empty. The other way round, an empty Send after a FAILED tap would
        // collapse to a thank-you having written nothing at all.
        if (!tapOk) {
          // Nothing landed, so this Send is a retry of the whole thing — one
          // doc, unmarked, since there is no sibling to disambiguate it from.
          var retry = composeFull(false);
          if (!retry) { submit.disabled = false; return; }
          setStatus(T.sending || '');
          return send(retry).then(function (ok) {
            submit.disabled = false;
            if (ok) finish(); else showFailure(retry);
          });
        }
        var full = composeFull(true);
        // The answer is already in, so an empty box means "I'm done" — not a
        // second doc duplicating what the tap already said.
        if (!(textEl.value || '').trim()) { submit.disabled = false; finish(); return; }
        setStatus(T.sending || '');
        return send(full).then(function (ok) {
          submit.disabled = false;
          if (ok) finish(); else showFailure(full);
        });
      });
    });
  }
})();
