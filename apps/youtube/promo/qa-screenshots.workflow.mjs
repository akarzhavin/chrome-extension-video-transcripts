export const meta = {
  name: 'qa-localized-screenshots',
  description: 'Adversarially review localized promo screenshots per locale for defects',
  phases: [{ title: 'Review' }, { title: 'Synthesize' }],
}

// args: [{ loc, nativeName, learnName }]. Default = a diverse sample (RTL, CJK,
// Indic, Thai, Latin) to catch edge cases beyond the de/ru/ja/fr eval set.
const SPECS = Array.isArray(args) && args.length ? args : [
  { loc: 'ar', nativeName: 'Arabic (right-to-left)', learnName: 'French' },
  { loc: 'he', nativeName: 'Hebrew (right-to-left)', learnName: 'Arabic' },
  { loc: 'fa', nativeName: 'Persian (right-to-left)', learnName: 'Arabic' },
  { loc: 'pt_BR', nativeName: 'Brazilian Portuguese (chip flag must be Brazil 🇧🇷, not Portugal)', learnName: 'Spanish' },
  { loc: 'en_US', nativeName: 'US English (chip flag should be 🇺🇸)', learnName: 'French' },
  { loc: 'zh_TW', nativeName: 'Traditional Chinese (chip flag should be Taiwan 🇹🇼)', learnName: 'Japanese' },
  { loc: 'es_419', nativeName: 'Latin-American Spanish', learnName: 'French' },
]
const BASE = '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/lingogram/apps/youtube/promo/out'

const SCHEMA = {
  type: 'object',
  required: ['locale', 'slides', 'verdict'],
  properties: {
    locale: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        required: ['n', 'issues'],
        properties: {
          n: { type: 'integer' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              required: ['severity', 'desc'],
              properties: {
                severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
                desc: { type: 'string' },
              },
            },
          },
        },
      },
    },
    verdict: { type: 'string', enum: ['ship', 'fix-recommended', 'blocked'] },
    summary: { type: 'string' },
  },
}

const reviews = await parallel(SPECS.map((s) => () => {
  const paths = [1, 2, 3, 4, 5].map((n) => `${BASE}/${s.loc}/screenshot-${n}.png`)
  const prompt = `You are an exacting QA reviewer for Chrome Web Store promo screenshots (locale "${s.loc}").
Read these 5 images (use the Read tool on each absolute path):
${paths.join('\n')}

This is a language-learning extension. For locale ${s.loc} the screenshots MUST be coherent:
- Marketing copy (the big headline, the small ALL-CAPS eyebrow above it, and the sub-line) must be in ${s.nativeName}.
- The product sidebar UI must be localized to ${s.nativeName}: the panel header word ("Subtitles" → its ${s.nativeName} translation) and, on the onboarding slide, the picker labels ("Choose your languages" / "I'm learning" / "My native language").
- The language-pair chip must read: ${s.learnName} → ${s.nativeName}.
- The subtitle tracks must show ${s.learnName} on the top/main line and ${s.nativeName} on the line below (and the same on the on-video overlay).
- The slides per index: 1 = full browser window with dual subtitles; 2 = sidebar panel close-up; 3 = onboarding language picker; 4 = subtitles overlaid on the video; 5 = "guess mode" with some words masked as •••/***.

Hunt for DEFECTS, do not rubber-stamp. Check specifically for:
- Wrong language anywhere (copy in English when it should be ${s.nativeName}; subs in the wrong language; chip reversed or wrong flags).
- A visible YouTube AD in the player (logos like Uber/ClickUp, "Sponsored"/"Skip Ad") — that is a blocker.
- Real YouTube clutter showing through instead of gray skeleton placeholders.
- Text overflow, clipping, truncation, or overlapping blocks; headline running off the slide.
- Blurry/low-res rendering.
Report issues PER slide with a severity (blocker | major | minor | nit). If a slide is clean, give it an empty issues array. Then an overall verdict (ship | fix-recommended | blocked) and a one-line summary.`
  return agent(prompt, { label: `qa:${s.loc}`, phase: 'Review', schema: SCHEMA, effort: 'high' })
}))

const clean = reviews.filter(Boolean)
const flat = clean.flatMap((r) => (r.slides || []).flatMap((sl) => (sl.issues || []).map((i) => ({ loc: r.locale, n: sl.n, ...i }))))
const blockers = flat.filter((i) => i.severity === 'blocker')
const majors = flat.filter((i) => i.severity === 'major')

return {
  perLocale: clean.map((r) => ({ locale: r.locale, verdict: r.verdict, summary: r.summary })),
  counts: { blocker: blockers.length, major: majors.length, minor: flat.filter((i) => i.severity === 'minor').length, nit: flat.filter((i) => i.severity === 'nit').length },
  blockers,
  majors,
  allIssues: flat,
}
