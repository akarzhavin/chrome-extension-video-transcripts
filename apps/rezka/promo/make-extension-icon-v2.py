#!/usr/bin/env python3
"""Generate the Lingogram extension icon set v2 (chameleon perched on a subtitle
line — the 2026-07 mascot restyle) from mascot-source-v2.png.

Writes icon{16,48,128}.png into apps/rezka/src/assets/icons/ — rezka's icon dir
is the shared source of truth: the youtube and web apps copy from it at build
time (see their vite.config.ts viteStaticCopy), so writing here updates all
three extensions at once.

Per-size treatment (not a dumb downscale):
- 128/48: full composition (chameleon + both subtitle bars) on a rounded tile.
- 16: the dim second bar is painted out and the crop is tighter, so the toolbar
  icon reads "creature on a line" instead of mush.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(HERE, "mascot-source-v2.png")
DST = os.path.join(ROOT, "apps", "rezka", "src", "assets", "icons")

im = Image.open(SRC).convert("RGB")
W, H = im.size
px = im.load()
BG = px[8, 8]  # uniform dark indigo backdrop


def dist(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def content_bbox(img, step=2, thresh=48):
    p = img.load()
    w, h = img.size
    xs, ys = [], []
    for y in range(0, h, step):
        for x in range(0, w, step):
            if dist(p[x, y], BG) > thresh:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def square_crop(img, bbox, pad_frac):
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    side = int(max(x1 - x0, y1 - y0) * (1 + pad_frac * 2))
    side = min(side, img.size[0], img.size[1])
    left = max(0, min(cx - side // 2, img.size[0] - side))
    top = max(0, min(cy - side // 2, img.size[1] - side))
    return img.crop((left, top, left + side, top + side))


def rounded(img, radius_frac):
    """Apply a rounded-rect alpha mask (the tile keeps the source backdrop)."""
    s = img.size[0]
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_frac), fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


# ── 128 / 48: full composition ────────────────────────────────────────────
bbox = content_bbox(im)
comp = square_crop(im, bbox, pad_frac=0.10)
for size in (128, 48):
    tile = comp.resize((size, size), Image.LANCZOS)
    rounded(tile, 0.24).save(os.path.join(DST, f"icon{size}.png"))
    print(f"icon{size}.png ← full composition ({comp.size[0]}px crop)")

# ── 16: paint out the dim second bar, crop tighter ────────────────────────
im16 = im.copy()
p16 = im16.load()
# find the main white bar's bottom edge first — its antialiased rim blends
# into the same violet-gray as the dim bar, so restrict the scan to below it
white_rows = [y for y in range(H // 2, H, 2)
              if sum(1 for x in range(0, W, 8) if sum(p16[x, y]) > 700) > 20]
bar_bottom = max(white_rows) if white_rows else H // 2
# the dim bar is violet-gray ≈ (137,133,173); scan only below the main bar
DIM = (137, 133, 173)
gxs, gys = [], []
for y in range(bar_bottom + 14, H, 2):
    for x in range(0, W, 2):
        if dist(p16[x, y], DIM) < 60:
            gxs.append(x)
            gys.append(y)
if gxs:
    d = ImageDraw.Draw(im16)
    d.rectangle([min(gxs) - 6, min(gys) - 6, max(gxs) + 6, max(gys) + 6], fill=BG)
    print(f"16px prep: erased dim bar at x{min(gxs)}..{max(gxs)} y{min(gys)}..{max(gys)}")
# crop by the CHAMELEON only (saturated pixels), so the white bar runs
# edge-to-edge and the creature fills the 16px tile
sxs, sys = [], []
for y in range(0, H, 2):
    for x in range(0, W, 2):
        r, g, b = p16[x, y]
        if dist((r, g, b), BG) > 48 and max(r, g, b) - min(r, g, b) > 50:
            sxs.append(x)
            sys.append(y)
bbox16 = (min(sxs), min(sys), max(sxs), max(sys))
comp16 = square_crop(im16, bbox16, pad_frac=0.04)
tile16 = comp16.resize((16, 16), Image.LANCZOS)
rounded(tile16, 0.22).save(os.path.join(DST, "icon16.png"))
print(f"icon16.png ← chameleon-tight crop, no dim bar ({comp16.size[0]}px crop)")
print("done →", DST)
