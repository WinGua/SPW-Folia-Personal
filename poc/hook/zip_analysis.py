# -*- coding: utf-8 -*-
"""Analyze host classes (read directly from ffmpeg-x64.dll zip) to locate the
unique call site of com.xuncorp.voxzen.ui.component.<U+052C>.BlurPopupMenu and
list candidate caller classes + exact JVM descriptors."""
import zipfile, struct, sys, os

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
FACADE = "com/xuncorp/voxzen/ui/component/\u052c"   # Blur.kt facade (Ԭ)


def esc(s):
    return "".join(c if 32 <= ord(c) < 127 else "U+%04X" % ord(c) for c in s)


def parse(data):
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
            raise ValueError("bad tag %s idx %s" % (tag, i))
        i += 1
    # skip class header
    access, this_i, sup_i = struct.unpack(">HHH", data[pos:pos + 6])
    pos += 6
    ni = struct.unpack(">H", data[pos:pos + 2])[0]
    pos += 2 + 2 * ni
    nfields = struct.unpack(">H", data[pos:pos + 2])[0]
    pos += 2
    for _ in range(nfields):
        fl, fni, fdi, na = struct.unpack(">HHHH", data[pos:pos + 8])
        pos += 8
        for _a in range(na):
            an, al = struct.unpack(">HI", data[pos:pos + 6])
            pos += 6 + al
    nm = struct.unpack(">H", data[pos:pos + 2])[0]
    pos += 2
    methods = []
    for _ in range(nm):
        fl, mni, mdi, na = struct.unpack(">HHHH", data[pos:pos + 8])
        pos += 8
        methods.append((cp[mni][1], cp[mdi][1]))
        for _a in range(na):
            an, al = struct.unpack(">HI", data[pos:pos + 6])
            pos += 6 + al
    return cp, cp[cp[this_i][1]][1], methods


def u(cp, i):
    e = cp[i]
    return e[1] if e and e[0] == "u" else "?"


def methodrefs(cp):
    out = []
    for e in cp:
        if e and e[0] == "r2":
            c, nt = cp[e[1]], cp[e[2]]
            if c and c[0] == "r1" and nt and nt[0] == "r2":
                out.append((u(cp, c[1]), u(cp, nt[1]), u(cp, nt[2])))
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "single"
    z = zipfile.ZipFile(ZIP)
    if mode == "single":
        cls = sys.argv[2] if len(sys.argv) > 2 else "androidx/compose/ui/\u0113.class"
        d = z.read(cls)
        cp, thisn, methods = parse(d)
        print("ENTRY:", esc(cls), "size", len(d), "internal", esc(thisn), "methods", len(methods))
        for mn, md in methods:
            print("  m:", esc(mn), "|", esc(md))
        print("REFS (host-owned):")
        for owner, mn, md in methodrefs(cp):
            if "xuncorp" in owner or owner.startswith("androidx/compose/ui/"):
                print("  ref:", esc(owner), "|", esc(mn), "|", esc(md))
    elif mode == "scan":
        target = FACADE.encode("utf-8")
        names = z.namelist()
        print("zip entries:", len(names))
        hits = []
        for i, n in enumerate(names):
            if not n.endswith(".class"):
                continue
            try:
                data = z.read(n)
            except Exception as ex:
                continue
            if target in data:
                hits.append((n, data))
        print("CLASSES REFERENCING FACADE:", len(hits))
        for n, data in hits:
            cp, thisn, methods = parse(data)
            fac_refs = []
            for owner, mn, md in methodrefs(cp):
                if owner == FACADE:
                    fac_refs.append((mn, md))
            print("-", esc(thisn), "(file:", esc(n) + ")")
            for mn, md in sorted(set(fac_refs)):
                print("    call:", esc(mn), "|", esc(md))


if __name__ == "__main__":
    main()
