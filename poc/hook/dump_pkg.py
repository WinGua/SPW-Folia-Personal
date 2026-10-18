# -*- coding: utf-8 -*-
"""Dump all classes/methods under a package prefix from the host zip."""
import sys, struct, zipfile

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
PREFIX = "com/xuncorp/voxzen/ui/player/mini/"


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
            raise ValueError("bad tag %d" % tag)
        i += 1
    return cp, pos


def u(cp, i):
    e = cp[i] if 0 <= i < len(cp) else None
    if e and e[0] == "u":
        return e[1]
    return None


def main():
    z = zipfile.ZipFile(ZIP)
    names = sorted(n for n in z.namelist() if n.endswith(".class") and n.startswith(PREFIX))
    print("classes in", PREFIX, "=", len(names))
    for n in names:
        d = z.read(n)
        try:
            cp, pos = parse_cp(d)
        except Exception as e:
            print("PARSE-ERR", esc(n), e)
            continue
        this_i = struct.unpack(">H", d[pos + 2:pos + 4])[0]
        pos += 6
        ni = struct.unpack(">H", d[pos:pos + 2])[0]
        pos += 2 + 2 * ni
        nfields = struct.unpack(">H", d[pos:pos + 2])[0]
        pos += 2
        fields = []
        for _ in range(nfields):
            fl, fni, fdi, na = struct.unpack(">HHHH", d[pos:pos + 8])
            pos += 8
            fields.append((u(cp, fni), u(cp, fdi), fl))
            for _a in range(na):
                an, al = struct.unpack(">HI", d[pos:pos + 6])
                pos += 6 + al
        nm = struct.unpack(">H", d[pos:pos + 2])[0]
        pos += 2
        methods = []
        for _ in range(nm):
            fl, mni, mdi, na = struct.unpack(">HHHH", d[pos:pos + 8])
            pos += 8
            methods.append((u(cp, mni), u(cp, mdi), fl))
            for _a in range(na):
                an, al = struct.unpack(">HI", d[pos:pos + 6])
                pos += 6 + al
        print("\n-- %s size=%d this=%s" % (esc(n), len(d), esc(u(cp, this_i))))
        for (fn, fd, fl) in fields:
            print("   F", hex(fl), esc(fn), "|", esc(fd))
        for (mn, md, fl) in methods:
            print("   M", hex(fl), esc(mn), "|", esc(md))


if __name__ == "__main__":
    main()
