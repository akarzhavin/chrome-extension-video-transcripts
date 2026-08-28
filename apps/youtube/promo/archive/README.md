# Promo archive

Rendered promo generations that can no longer be reproduced from source.

`out/` and `shots/` are gitignored and every pipeline overwrites its own
subtree, so a generation not copied here is one render away from being gone.
Everything in this folder is a **build artifact kept on purpose** — never a
source. To bring one back, copy it into the matching `out/<pipeline>@<v>/`
folder; don't re-point a pipeline at it.

## 2026-08-10-dark-3slide

The localized store series as it shipped before the v5 restyle: near-black
backdrop, 3 screenshots per locale. Kept for **English only**: the set was
rendered in all 54 locales, but 54 x 3 PNGs is 64 MB that every clone would
carry forever, and what makes this generation worth keeping is the DESIGN —
one locale shows it. The other 53 were dropped on 2026-08-28 and are gone.

**Not reproducible, and the source is not in git.** Verified rather than
assumed:

- The backdrop is `rgb(17,15,26)`; today's `store-i18n@5` renders
  `rgb(251,251,249)`.
- `promo.css` has only three commits: v2 "premium" (`55a0a88`, June 22),
  v4 "daylight utility" (`9946e42`, July 16), and v5 (`dba00f2`, Aug 26).
  On Aug 10 the tree held **v4, which is light** — so these dark shots were
  rendered from an uncommitted working-tree state.
- Restoring v2 and re-rendering was tried: it produces a *purple*
  `rgb(69,34,134)` backdrop, not this one. v2 is not the source either.
- The 3-slide selection (the renderer emits 5) was likewise made by hand
  outside version control.

So these PNGs are the only copy. Keep them.

## 2026-08-26-v5-store-en

`promo-3.png` (+ `@2x`) from the v5 English series — the one slide of that set
that cannot currently be re-rendered.

Slide 3 shows guess mode, and it was built from a capture of
`live-demo-guess-en.png` that was **overwritten later the same day** (13:18
render vs 15:24 recapture). The current capture is not in guess state, so
re-running `store-en@5` yields a slide 3 with the words *unmasked* —
contradicting its own headline, "Listen first, then check yourself".

To make it renderable again, recapture guess mode:
`node apps/youtube/screenshots/capture-demo.mjs --mode guess`, then re-render.
Until then this file is the only correct copy — restore it into
`out/store-en@5/` after any `store-en@5` run.
