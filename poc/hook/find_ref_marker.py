# -*- coding: utf-8 -*-
"""Search host zip for classes referencing a marker string; optionally show methods/refs."""
import sys, struct, zipfile

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
MARK = sys.argv[1] if len(sys.argv) > 1 else "PlaybackExtensionPoint"
SHOW = sys.argv[2] if len(sys.argv) > 2 else ""


def esc(s):
    return "".join(c if 32 <= ord(c) < 127 else ("U+%04X" % ord(c)) for c in s)


def parse_cp(data):
    cpc = struct.unpack(">H", data[8:10])[0]
    cp = [None] * cpc
    i, pos = 1, 10
    while i < cpc:
        tag = data[pos]; pos += 1
        if tag == 1:
            ln = struct.unpack(">H", data[pos:pos + 2])[0]; pos += 2
            cp[i] = ("u", data[pos:pos + ln].decode("utf-8", "replace")); pos += ln
        elif tag in (7, 8, 16, 19, 20):
            cp[i] = ("r1", struct.unpack(">H", data[pos:pos + 2])[0]); pos += 2
        elif tag == 15:
            cp[i] = ("mh", data[pos], struct.unpack(">H", data[pos + 1:pos + 3])[0]); pos += 3
        elif tag in (3, 4):
            cp[i] = ("num",); pos += 4
        elif tag in (9, 10, 11, 12, 17, 18):
            a, b = struct.unpack(">HH", data[pos:pos + 4]); cp[i] = ("r2", a, b); pos += 4
        elif tag in (5, 6):
            cp[i] = ("w",); pos += 8; i += 1
        else:
            raise ValueError("tag %d" % tag)
        i += 1
    return cp, pos


def u(cp, i):
    e = cp[i] if 0 <= i < len(cp) else None
    return e[1] if e and e[0] == "u" else None


def main():
    z = zipfile.ZipFile(ZIP)
    names = z.namelist()
    hits = []
    for n in names:
        if not n.endswith(".class"):
            continue
        d = z.read(n)
        if MARK.encode("utf-8") not in d:
            continue
        try:
            cp, pos = parse_cp(d)
        except Exception:
            continue
        this_i = struct.unpack(">H", d[pos + 2:pos + 4])[0]
        pos += 6
        ni = struct.unpack(">H", d[pos:pos + 2])[0]; pos += 2 + 2 * ni
        nfields = struct.unpack(">H", d[pos:pos + 2])[0]; pos += 2
        for _ in range(nfields):
            fl, fni, fdi, na = struct.unpack(">HHHH", d[pos:pos + 8]); pos += 8
            for _a in range(na):
                an, al = struct.unpack(">HI", d[pos:pos + 6]); pos += 6 + al
        nm = struct.unpack(">H", d[pos:pos + 2])[0]; pos += 2
        methods = []
        for _ in range(nm):
            fl, mni, mdi, na = struct.unpack(">HHHH", d[pos:pos + 8]); pos += 8
            methods.append((u(cp, mni), u(cp, mdi)))
            for _a in range(na):
                an, al = struct.unpack(">HI", d[pos:pos + 6]); pos += 6 + al
        hits.append((n, u(cp, this_i), len(d), methods))

    print("files referencing %r: %d" % (MARK, len(hits)))
    for (n, this, size, methods) in hits:
        print("\n== %s  (%d B)  this=%s" % (esc(n), size, esc(this or "?")))
        for (mn, md) in methods:
            print("   M %s | %s" % (esc(mn), esc(md)))
        if SHOW == "marker":
            d = z.read(n)
            # print utf8 constants containing marker or related substrings
            try:
                cp, _ = parse_cp(d)
            except Exception:
                continue
            for e in cp:
                if e and e[0] == "u" and (MARK in e[1] or "Extension" in e[1] or "extension" in e[1]):
                    print("   U", esc(e[1]))


if __name__ == "__main__":
    main()
