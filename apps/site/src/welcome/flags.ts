// Flags for the popular-language tiles on the Language step.
//
// Drawn as SVG rather than regional-indicator emoji: Chrome on Windows has no
// flag glyphs and shows the two letters instead. A flag is a country, not a
// language, so this is only the picture the tile carries; the tile's name is
// the language. All markup below is constant, written here, never built from
// anything the extension or the URL supplies.

// Decoration: the tile's own text names the language, so a screen reader skips the picture.
const svg = (_country: string, inner: string) =>
  `<svg width="36" height="24" viewBox="0 0 36 24" aria-hidden="true" focusable="false">${inner}</svg>`;
const outline = '<rect x="0.5" y="0.5" width="35" height="23" fill="none" stroke="#d4cfe6"/>';

export const FLAGS: Record<string, string> = {
  en: svg(
    'United Kingdom',
    '<rect width="36" height="24" fill="#012169"/><path d="M0 0L36 24M36 0L0 24" stroke="#fff" stroke-width="5"/><path d="M0 0L36 24M36 0L0 24" stroke="#c8102e" stroke-width="2"/><rect x="14" width="8" height="24" fill="#fff"/><rect y="8" width="36" height="8" fill="#fff"/><rect x="15.5" width="5" height="24" fill="#c8102e"/><rect y="9.5" width="36" height="5" fill="#c8102e"/>',
  ),
  es: svg('Spain', '<rect width="36" height="24" fill="#aa151b"/><rect y="6" width="36" height="12" fill="#f1bf00"/>'),
  de: svg('Germany', '<rect width="36" height="8" fill="#1a1a1a"/><rect y="8" width="36" height="8" fill="#dd0000"/><rect y="16" width="36" height="8" fill="#ffce00"/>'),
  fr: svg('France', `<rect width="12" height="24" fill="#0055a4"/><rect x="12" width="12" height="24" fill="#fff"/><rect x="24" width="12" height="24" fill="#ef4135"/>${outline}`),
  it: svg('Italy', `<rect width="12" height="24" fill="#009246"/><rect x="12" width="12" height="24" fill="#fff"/><rect x="24" width="12" height="24" fill="#ce2b37"/>${outline}`),
  pt: svg('Portugal', '<rect width="36" height="24" fill="#da291c"/><rect width="14" height="24" fill="#046a38"/><circle cx="14" cy="12" r="5" fill="#ffe900"/>'),
  ja: svg('Japan', `<rect width="36" height="24" fill="#fff"/><circle cx="18" cy="12" r="7" fill="#bc002d"/>${outline}`),
  ko: svg(
    'South Korea',
    `<rect width="36" height="24" fill="#fff"/><path d="M12 12a6 6 0 0 1 12 0z" fill="#cd2e3a"/><path d="M12 12a6 6 0 0 0 12 0z" fill="#0047a0"/><rect x="4" y="3" width="5" height="1.5" fill="#1a1a1a"/><rect x="27" y="3" width="5" height="1.5" fill="#1a1a1a"/><rect x="4" y="19.5" width="5" height="1.5" fill="#1a1a1a"/><rect x="27" y="19.5" width="5" height="1.5" fill="#1a1a1a"/>${outline}`,
  ),
  ru: svg('Russia', `<rect width="36" height="8" fill="#fff"/><rect y="8" width="36" height="8" fill="#0039a6"/><rect y="16" width="36" height="8" fill="#d52b1e"/>${outline}`),
  uk: svg('Ukraine', '<rect width="36" height="12" fill="#0057b7"/><rect y="12" width="36" height="12" fill="#ffd700"/>'),
  vi: svg('Vietnam', '<rect width="36" height="24" fill="#da251d"/><polygon points="18,5 19.65,10.1 25,10.1 20.7,13.25 22.3,18.35 18,15.2 13.7,18.35 15.3,13.25 11,10.1 16.35,10.1" fill="#ffff00"/>'),
  zh: svg('China', '<rect width="36" height="24" fill="#de2910"/><polygon points="7,3 8,5.8 11,5.8 8.6,7.6 9.5,10.5 7,8.8 4.5,10.5 5.4,7.6 3,5.8 6,5.8" fill="#ffde00"/>'),
};
