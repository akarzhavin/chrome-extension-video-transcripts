# Source imagery for the HDrezka promo

`out-live/` holds the product captures consumed by [`../promo/`](../promo/):

- `live-demo-<loc>.png`, `live-demo-onboarding-<loc>.png`,
  `live-demo-guess-<loc>.png` (en / ru / uk) — the **shared `SidebarUI` panel**,
  reused from the YouTube extension's demo-mode captures
  (`../../youtube/screenshots/out-live/`). The panel component is identical across
  both extensions, so these are authentic for HDrezka too.
- `host-hero.png`, `host-overlay.png` — **real HDrezka captures** (full player +
  panel, and the on-video dual-subtitle overlay).

There is no automated capture harness here (unlike the YouTube
`screenshots/capture-*.mjs`): HDrezka is **region/IP-blocked** (`Ошибка доступа
105`) from blocked regions / datacenter IPs, so host shots are captured **by
hand** from an allowed-region browser. (From an allowed region the site loads and
the player streams fine — the `<video>` is in the top document — so an automated
harness is possible later if needed.) See
[`../promo/README.md`](../promo/README.md) → *Refreshing the HDrezka host shots*.
