# A worktree whose build is not its own

Measured 2026-09-04, in `lingogram-e2e-research`. One of six checkouts on this
machine is built differently from the other five, and nothing about it is
visible from inside.

## What happens

A `vite build` run in that worktree does **not** compile that worktree's
`packages/shared`. It compiles the main checkout's. Verified by exporting a
marker constant from `packages/shared/src/languages.ts` there, rebuilding, and
finding no trace of it in `build/src/background/background.js`. Repeated with
`onboarding.ts`, same result.

So in that tree:

- `npx jest` and `npm run type-check` read the worktree's own `shared`
- `vite build` compiles the main checkout's `shared`

While the two trees agree, nothing looks wrong. When they diverge, the tests
pass against one body of code and the artefact contains another — silently, and
with no error anywhere.

## Why

`node_modules` in that worktree is itself a symlink to the main checkout's
`node_modules`. The workspace link inside it is relative:

```
node_modules/@video-transcripts/shared -> ../../packages/shared
```

A relative symlink resolves from where it **points**, not from where it sits.
Following it lands in the main checkout.

**Read it with `readlink` and it looks correct** — `../../packages/shared` is
exactly what a healthy workspace link says. The difference only appears when
the path is resolved:

```sh
# what it claims
readlink node_modules/@video-transcripts/shared

# where it actually goes — use this one
(cd node_modules/@video-transcripts/shared && pwd -P)
```

## Which checkouts are affected

Only the one. Checked by resolution, not by reading:

| Checkout | `node_modules` | `shared` resolves to |
|---|---|---|
| `lingogram` (main) | real | its own |
| `lingogram-e2e-research` | **symlink** | **the main checkout's** |
| `lingogram-phase3` | real | its own |
| `lingogram-phase4` | real | its own |
| `lingogram-phase5` | real | its own |
| `lingogram-phase6` | real | its own |

A worktree created with `npm install` run inside it gets a real
`node_modules` and builds its own code. The affected one predates that.

## What to do about it

Any change to `packages/shared` made in an affected worktree is covered by its
tests and **not** by its build. Before a build of such a change is used for
anything — a live run, a copy into the main checkout, a bundle inspection —
either build from the main checkout, or give the worktree a real
`node_modules` of its own (`rm node_modules && npm install` from its root).

This is also how a production build appeared in that worktree on 2026-09-04:
`npm run build` compiled the main checkout's `shared` along with its
environment. It was deleted; the general point stands.

## The wider lesson

This was found only after the quick check gave a confident wrong answer twice —
first "the path in the bundle is a property of worktrees" (it is a property of
this one), then "the symlink is relative, so it points inward" (it is relative,
and it points outward). Both readings were of a *representation*: a path string
in a bundle, and the text of a symlink. Neither was of the *result*.

When a check about the filesystem matters, resolve it and look at what you get.
