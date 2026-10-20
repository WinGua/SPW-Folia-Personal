"""make-gallery.py - turn the captured 1920x1080 style stills into gallery assets.

Produces 960x540 thumbs (assets/styles/*.jpg) and 1600x900 lightbox images
(assets/styles/large/*.jpg). Both sizes are centre-cropped to 16:9 first, so
they always frame the same region.

Usage: python site/tools/make-gallery.py <captureDir>
"""

import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SITE, ".cache", "scan")

MODES = [
    "sonnet", "tempera", "lumiere", "classic", "cadenza", "partita", "fume",
    "tilt", "claddagh", "monet", "pendolo", "cappella", "diorama", "still",
]
SIZES = [("thumbs", "styles", 960, 540, 85), ("large", "styles/large", 1600, 900, 82)]


def cover(im, want_w, want_h):
    """Centre-crop to the target aspect ratio, then resize."""
    w, h = im.size
    want = want_w / want_h
    if w / h > want:
        nw = int(h * want)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / want)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return im.resize((want_w, want_h), Image.LANCZOS)


total = 0
for label, subdir, w, h, q in SIZES:
    dest_dir = os.path.join(SITE, "assets", *subdir.split("/"))
    os.makedirs(dest_dir, exist_ok=True)
    for mode in MODES:
        src = os.path.join(SRC, f"{mode}.png")
        if not os.path.exists(src):
            print(f"  ! missing {mode}.png")
            continue
        out = os.path.join(dest_dir, f"{mode}.jpg")
        cover(Image.open(src).convert("RGB"), w, h).save(
            out, "JPEG", quality=q, optimize=True, progressive=True
        )
        n = os.path.getsize(out)
        total += n
        print(f"{label:7s} {mode:10s} {w}x{h} {n // 1024:4d} KB")

print(f"\n{total // 1024} KB across both sizes")
