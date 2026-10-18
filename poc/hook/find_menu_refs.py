# -*- coding: utf-8 -*-
"""Broad scan: all references whose owner is the menu file facade (any method/desc), and
all references whose (name,desc) matches a composable signature (any owner)."""
import struct, zipfile, collections

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
MENU = "androidx/compose/ui/\u0113"


def esc(s):
    if s is None:
        return "None"
    return "".join(c if 32 <= ord(c) < 127 else ("U+%04X" % ord(c)) for c in s)


def parse_cp(data):
    cpc = struct.unpack(">H", data[8:10])[0]
    cp = [None] * cpc
    i, pos = 1, 10
    while i < cpc:
        tag = data[pos]
        pos += 1
        if tag == 1:
            ln = struct.unpack(">H", data[pos:pos + 2])[0]
            pos += 2
            cp[i] = ("u", data[pos:pos + ln].decode("utf-8", "replace"))
            pos += ln
        elif tag in (7, 8, 16, 19, 20):
            cp[i] = ("r1", struct.unpack(">H", data[pos:pos + 2])[0])
            pos += 2
        elif tag == 15:
            cp[i] = ("mh", data[pos], struct.unpack(">H", data[pos + 1:pos + 3])[0])
            pos += 3
        elif tag in (3, 4):
            cp[i] = ("num",)
            pos += 4
        elif tag in (9, 10, 11, 12, 17, 18):
            a, b = struct.unpack(">HH", data[pos:pos + 4])
            cp[i] = ("r2", a, b)
            pos += 4
        elif tag in (5, 6):
            cp[i] = ("w",)
            pos += 8
            i += 1
        else:
            raise ValueError("bad tag %d" % (tag, pos))
        i += 1
    return cp, pos


def u(cp, i):
    e = cp[i] if 0 <= i < len(cp) else None
    if e and e[0] == "u":
        return e[1]
    return None


def refs_of(data):
    cp, _pos = parse_cp(data)
    out = []
    for e in cp:
        if e and e[0] == "r2":
            a, b = e[1], e[2]
            owner = u(cp, a)
            nat = cp[b] if b < len(cp) else None
            if owner is None or not nat or nat[0] != "r2":
                continue
            name = u(cp, nat[1])
            desc = u(cp, nat[2])
            if name is not None and desc is not None:
                out.append((owner, name, desc))
    return out


def main():
    z = zipfile.ZipFile(ZIP)
    names = [n for n in z.namelist() if n.endswith(".class")]
    by_menu = collections.Counter()
    callers = collections.defaultdict(list)
    parse_err = 0
    for n in names:
        try:
            d = z.read(n)
        except Exception:
            continue
        try:
            refs = refs_of(d)
        except Exception:
            parse_err += 1
            continue
        for (o, mn, desc) in refs:
            if o == MENU:
                by_menu[(mn, desc)] += 1
                callers[(mn, desc)].append(n)
    print("parse errors:", parse_err)
    print("refs with owner == menu facade:", sum(by_menu.values()))
    for (mn, desc), c in by_menu.most_common():
        print("\n  ref", esc(mn), "|", esc(desc), "x", c)
        for nn in callers[(mn, desc)][:10]:
            print("      in", esc(nn))


if __name__ == "__main__":
    main()
