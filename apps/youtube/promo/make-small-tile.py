#!/usr/bin/env python3
"""Build the 440x280 CWS small tile from the hand-made key art.

The small tile is key art, not a rendered HTML template — cover-crop the
source to the exact CWS aspect, then downscale with LANCZOS.

    python3 make-small-tile.py [source.png]
"""
import sys, pathlib
from PIL import Image

HERE = pathlib.Path(__file__).parent
DEFAULT_SRC = HERE.parent.parent.parent / 'ChatGPT Image Aug 26, 2026, 11_17_44 AM.png'
W, H = 440, 280

src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
if not src.exists():
    sys.exit(f'source not found: {src}')

im = Image.open(src).convert('RGB')      # 24-bit, no alpha — a CWS requirement
sw, sh = im.size
target = W / H
if sw / sh > target:                      # too wide → trim the sides
    nw = int(sh * target)
    im = im.crop(((sw - nw) // 2, 0, (sw - nw) // 2 + nw, sh))
else:                                     # too tall → trim top and bottom
    nh = int(sw / target)
    im = im.crop((0, (sh - nh) // 2, sw, (sh - nh) // 2 + nh))

out = HERE / 'out' / 'tile-small.png'
out.parent.mkdir(exist_ok=True)
im.resize((W, H), Image.LANCZOS).save(out)
print(f'wrote {out} ({W}x{H}) from {src.name}')
