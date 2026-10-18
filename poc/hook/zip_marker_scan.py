# -*- coding: utf-8 -*-
"""Search EVERY entry of the SPW host zip for marker strings (file-facade name, menu
labels) and print entry names. Used to locate the real mini-player more-menu class."""
import zipfile, sys

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"

MARKERS = {
    "PlayerMoreMenuFlyout": "PlayerMoreMenuFlyout".encode(),
    "播放速度": "播放速度".encode("utf-8"),
    "桌面歌词": "桌面歌词".encode("utf-8"),
    "歌词翻译": "歌词翻译".encode("utf-8"),
    "释放音频引擎": "释放音频引擎".encode("utf-8"),
}


def esc(s):
    return "".join(c if 32 <= ord(c) < 127 else ("U+%04X" % ord(c)) for c in s)


def main():
    z = zipfile.ZipFile(ZIP)
    names = z.namelist()
    print("entries:", len(names), flush=True)
    hits = {k: [] for k in MARKERS}
    for i, n in enumerate(names):
        try:
            d = z.read(n)
        except Exception:
            continue
        for k, raw in MARKERS.items():
            if raw in d:
                hits[k].append(n)
        if i % 5000 == 0:
            print("  ..", i, flush=True)
    print()
    for k, lst in hits.items():
        print("===", k, len(lst))
        for n in lst[:40]:
            print("   ", esc(n))
    print("done")


if __name__ == "__main__":
    main()
