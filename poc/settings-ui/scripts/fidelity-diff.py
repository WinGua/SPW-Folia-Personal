"""Task-11 fidelity diff: window-local region MAE between Folia's real 歌词样式 window and ours.

Usage (bundled Python + Pillow; run from poc/settings-ui):
    <python> scripts/fidelity-diff.py --real ../../research/settings-ui/real-window.png \
                                      --ours ../../research/settings-ui/ours-window.png \
                                      --out  ../../research/settings-ui
    # per tab:
    <python> scripts/fidelity-diff.py --real .../real-window-背景.png --ours .../ours-window-背景.png \
                                      --out ... --label 背景

Both inputs must be 1240x780 window clips (scripts/folia-drive.mjs shot-el / scripts/dev-capture.mjs).
"""
import argparse
import os
import sys

from PIL import Image, ImageChops

# Window-local regions, 1240x780 window (see research/settings-ui/fidelity-diff.md §1.3).
REGIONS = {
    'title-row': (0, 0, 1240, 64),
    'tabs': (860, 64, 1240, 104),
    'right-column': (860, 104, 1240, 780),
    'preview': (24, 64, 820, 515),
    'shelf': (24, 505, 820, 780),
}
SIDE_BY_SIDE = {'title-row', 'tabs', 'right-column'}


def mae(a, b, box):
    diff = ImageChops.difference(a.crop(box), b.crop(box)).convert('L')
    hist = diff.histogram()
    total = sum(hist)
    return sum(i * c for i, c in enumerate(hist)) / total if total else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--real', required=True)
    ap.add_argument('--ours', required=True)
    ap.add_argument('--out', default='.')
    ap.add_argument('--label', default='歌词动画')
    args = ap.parse_args()

    real = Image.open(args.real).convert('RGB')
    ours = Image.open(args.ours).convert('RGB')
    if real.size != ours.size:
        sys.exit(f'size mismatch: real={real.size} ours={ours.size}')
    if real.size != (1240, 780):
        print(f'warning: expected a 1240x780 window clip, got {real.size}', file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    rows = []
    for name, box in REGIONS.items():
        value = mae(real, ours, box)
        rows.append((name, value))
        if name in SIDE_BY_SIDE:
            a, b = real.crop(box), ours.crop(box)
            canvas = Image.new('RGB', (a.width * 2 + 4, a.height), (255, 0, 0))
            canvas.paste(a, (0, 0))
            canvas.paste(b, (a.width + 4, 0))
            canvas.save(os.path.join(args.out, f'fidelity-{args.label}-{name}.png'))

    print(f'{args.label}: ' + '  '.join(f'{name}={value:.2f}' for name, value in rows))


if __name__ == '__main__':
    main()
