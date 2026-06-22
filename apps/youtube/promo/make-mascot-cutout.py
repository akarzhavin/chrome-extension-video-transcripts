#!/usr/bin/env python3
"""Produce a clean transparent cutout of the chameleon mascot (dark plate +
black frame removed, no halo) → apps/youtube/promo/mascot-cutout.png.
Square transparent canvas so it can be sized 1:1 in CSS without distortion."""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ICON = os.path.join(ROOT, "new_icon.png")
OUT = os.path.join(HERE, "mascot-cutout.png")

raw = Image.open(ICON).convert("RGB")
W, H = raw.size
fill = raw.copy()
MARK = (255, 0, 255)
for s in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:          # exterior black frame
    ImageDraw.floodfill(fill, s, MARK, thresh=40)
for fx, fy in [(0.16, 0.16), (0.84, 0.16), (0.84, 0.84), (0.16, 0.84), (0.5, 0.92)]:
    ImageDraw.floodfill(fill, (int(fx * W), int(fy * H)), MARK, thresh=75)  # navy plate

px = fill.load()
mask = Image.new("L", (W, H), 0)
mp = mask.load()
for y in range(H):
    for x in range(W):
        if px[x, y] != MARK:
            mp[x, y] = 255
mask = mask.filter(ImageFilter.MinFilter(7))        # erode ~3px past the fringe
mask = mask.filter(ImageFilter.GaussianBlur(1.0))   # feather

mascot = raw.convert("RGBA")
mascot.putalpha(mask)
mascot = mascot.crop(mascot.getbbox())              # trim to silhouette

side = max(mascot.size)                             # square canvas, centered
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(mascot, ((side - mascot.width) // 2, (side - mascot.height) // 2), mascot)
canvas = canvas.resize((512, 512), Image.LANCZOS)
canvas.save(OUT)
print(f"✓ {OUT}  ({canvas.size[0]}×{canvas.size[1]}, transparent)")
