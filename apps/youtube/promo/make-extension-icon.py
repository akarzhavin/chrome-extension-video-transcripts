#!/usr/bin/env python3
"""Generate the Lingogram extension icon set (#2 — frameless chameleon head on a
TRANSPARENT background) from new_icon2.png → apps/rezka/src/assets/icons/icon{16,48,128}.png.

rezka's icon dir is the shared source of truth: the youtube and web apps copy
from it at build time (see their vite.config.ts viteStaticCopy), so writing here
updates all three extensions at once."""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(ROOT, "new_icon2.png")          # the chosen icon (contact sheet)
DST = os.path.join(ROOT, "apps", "rezka", "src", "assets", "icons")
SIZES = [16, 48, 128]

im = Image.open(SRC).convert("RGB"); W, H = im.size

# 1) flood-fill the dark background (page + tile + moat) from the 4 corners so
#    only the bright content (chameleon outlines/bodies, labels) survives.
fill = im.copy(); MARK = (255, 0, 255)
for s in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
    ImageDraw.floodfill(fill, s, MARK, thresh=65)
fp = fill.load()
alpha = Image.new("L", (W, H), 0); ap = alpha.load()
for y in range(H):
    for x in range(W):
        if fp[x, y] != MARK:
            ap[x, y] = 255

# 2) bbox of the BIG chameleon only (top-left window excludes the "1024×1024"
#    label text below it and the smaller preview tiles to the right).
WX, WY = 815, 710
pts = [(x, y) for y in range(WY) for x in range(WX) if ap[x, y]]
minx = min(p[0] for p in pts); maxx = max(p[0] for p in pts)
miny = min(p[1] for p in pts); maxy = max(p[1] for p in pts)
alpha = alpha.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(0.8))  # debfringe
head = im.convert("RGBA"); head.putalpha(alpha)
head = head.crop((minx, miny, maxx + 1, maxy + 1))

# 3) place the head on a TRANSPARENT square canvas with minimal padding —
#    no fill, no squircle; the chameleon fills the larger dimension edge-to-edge.
PAD = 1.0
S = int(max(head.size) / PAD)
base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
base.alpha_composite(head, ((S - head.width) // 2, (S - head.height) // 2))

master = os.path.join(HERE, "icon-master.png")
base.save(master)
os.makedirs(DST, exist_ok=True)
for p in SIZES:
    base.resize((p, p), Image.LANCZOS).save(os.path.join(DST, f"icon{p}.png"))
    print(f"✓ icon{p}.png")
print(f"master  → {master}  ({S}×{S})")
print(f"install → {DST}  (shared by youtube + rezka + web)")
