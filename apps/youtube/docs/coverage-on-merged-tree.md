# Coverage on the merged tree — measured

Task T205. Four independent auditors read the behaviour map
(`apps/youtube/docs/behaviour-map.md`) across non-overlapping ranges of sections
and judged every claim by a single question: **would the named check go red if
this specific behaviour broke?** None of them saw the others' work before
returning their verdicts.

Tree: `test/coverage-tails` (three commits on top of `test/claim-level-coverage`).

## The count

| audit | sections | marked lines | claims | covered | partial | not covered | unverifiable |
|---|---|---|---|---|---|---|---|
| 1 | 1–9 | 72 | 140 | 96 | 20 | 19 | 5 |
| 2 | 10–19 | 85 | 136 | 97 | 24 | 8 | 7 |
| 3 | 20–37 | 42 | 91 | 63 | 9 | 13 | 6 |
| 4 | 38–52 + tail | 55 | 78 | 60 | 10 | 4 | 4 |
| **total** | | **254** | **445** | **316** | **63** | **44** | **22** |

## The denominator, and why this one

**445 claims — everything the map asserts.** The ratio: **316/445 = 71.0%**
before the re-check, **314/445 = 70.6%** after it (see the T206 section below).

The denominator was chosen this way and not another for one reason: any
narrowing makes the number prettier while changing nothing in the product. Three
variants that suggested themselves and were rejected:

- **excluding the unverifiable ones (423)** gives 74.7%. Tempting and
  defensible — 22 claims genuinely cannot be checked (a historical statement,
  third-party behaviour, a negation across the whole interface). But
  "unverifiable" is an auditor's judgement, and making it a lever that raises the
  percentage means rewarding the expansion of that category.
- **covered + partial (379/445)** gives 85.2%. That is fitting to the answer:
  "partial" means precisely that the claim **survives** its own break. Counting
  it as covered is asserting the opposite of what was measured.
- **Jest's line percentage** does not answer the question asked at all. A line
  can be executed by every test and never once be asserted.

## Against the goals

**SC-001 (82%): not reached.** 71.0% against 82% — a gap of 11 points,
49 claims.

**Phase 6's goal (88%): not reached.** A gap of 17 points, 76 claims.

Neither figure can be declared reached by swapping the denominator, and that was
checked: even the most generous honest variant (excluding the unverifiable ones)
gives 74.7%, which is below 82%.

## Why the earlier numbers were different

Three numbers have travelled through the reports, and all three are correct for
what they measured:

- **69.8%** (Phase 5) — on a branch that did not have the work of Phases 2, 3
  and 4. Its author called it a lower bound, and a lower bound is what it was.
- **84.6%** (Phase 6) — on a denominator of 273, inherited from the first
  partition of the map, and crediting claims that phase did not check.
- **71.0%** (here) — for the first time on a tree that holds all the work, and
  on a denominator obtained by re-reading the map from scratch.

The denominator was re-marked twice over the course of the work: 273 → 321 →
445. The same 254 marked lines yielded different claim counts, because a "claim"
is a unit of judgement, not a line of a file. **Only the ratio is comparable**,
and comparing 71.0% with 82% is legitimate only because 82% is a ratio too.

## Where it falls short

44 uncovered claims, by section:

| section | count |
|---|---|
| §1 first turn-on and the language pair | 9 |
| §25 saved-word counter | 4 |
| §2 signing in | 3 |
| §7 export | 3 |
| §15 dictionary | 3 |
| the rest (§6, §9, §13, §16, §23, §35 and others) | 22 |

§1 is the most expensive: nine uncovered claims in behaviour every new user
sees.

## The sampled re-check (T206)

The plan requires re-reading at least 10% of the "covered" verdicts — 32 of 316.
What was taken instead: all 49 "generous calls" the auditors named themselves,
plus a check that every named file actually ran.

**Three discrepancies found. Two change a verdict, one changes the run count.**

**1. §50.1 "being offline" — the verdict is wrong, the check was empty.**
`/offline/i.test(el?.textContent ?? '')` yields `false` when the element is
absent entirely: an empty string does not match the regex. The check went green
on a page where the panel had not rendered, including on a completely broken
build. Fixed: first it asserts the status exists, then that it does not name a
missing network. Redness was seen (substituting the id fails it with "the panel
must still render its status area while offline").

**2. §40.2 — the verdict is wrong, the check skips.**
`word-lookup.spec.ts:99` skips when the video has a single track. On the fixture
video that is exactly what happens: the run gave 3 green and 1 skip. This check
does not cover the claim.

**3. Four checks were not running at all.** `word-lookup.spec.ts` is assigned to
the first half of the run (`e2e/README.md`), but it was not in the command: the
log says "Running 36 tests", not 40. Run separately — 3 green, 1 skip. This is
exactly what the README warns about: a file that lands in neither half's command
silently stops running.

**Confirmed correct** among those checked: §39.1 (the `lines < 30` guard does
not fire — the fixture video has 286 lines) and §12.4 (reparenting the panel is
covered by a unit, and the live check honestly skips).

**What this does to the number.** Two of the checked verdicts move from
"covered" to "not covered": **314 of 445 = 70.6%** instead of 71.0%. The
direction is expected: re-checking a sample can only lower it, because the lines
checked were precisely the ones the auditor doubted.

**What the re-check does not give.** 49 of the 316 "covered" were checked — the
ones the auditors themselves marked as doubtful. It says nothing about the other
267. The two cases found came from a sample selected on the basis of doubt, so
their proportion cannot be carried over to the whole set.

## A caveat about the method

Every auditor listed their own "generous calls" — the lines where they wavered
between "covered" and "partial". Those are worth re-checking first: if some of
them turn out to be "partial", 71.0% moves down, not up.

## Verification by product mutations (T416)

Re-checking redness in its most expensive form: break not the test but the
**product**, rebuild, put the build where Chrome loads it from, and see whether
the check fails. Mutating the test shows that the check is capable of failing at
all; mutating the product shows that it catches what it names.

| mutation in the product | check | result |
|---|---|---|
| `scrollActiveIntoView`: delta without centring (align to the top) | `accessibility` › the active line sits near the middle | **red**, "never came within 25% of the list's middle" |
| `applyCollapsed`: `aria-expanded` always `'true'` | `reading-modes` › collapsing changes both what is seen and what is announced | **red** |
| `STALLED_REQUEST_MS` 30 000 → 3 000 (restoring the old defect) | `throttling` › no false "no subtitles" while retries are still running | **red** |
| `setupFullscreenHandling`: reparenting into the fullscreen element removed | `SidebarUI` › the panel moves across and comes back | **red** |

Four of four. Not one required an edit to the check — they already caught what
they should.

**A trap that fired along the way.** The first rebuild ran without
`EXT_API_BASE_URL`, and the check failed — but for an entirely different reason:
the fixture's guard refused to work with a build that has no dictionary address.
Red was obtained, the conclusion "the mutation was caught" suggested itself, and
it would have been wrong. Judge a failure by its message, not by its colour.

**Restoring the build.** The original was taken before the mutations (sha256
`6b017a5b…`, `8ebb8d3e…`, `516c3275…`), restored afterwards and checked against
all three files and against the config block: `env: "dev"`,
`projectId: "demo-lingogram"`, emulators on localhost. A byte-for-byte match.
