# -*- coding: utf-8 -*-
"""Resolve the real more-menu facade class and the exact call it makes to BlurPopupMenu.
Prints: entry/internal name of mini player classes with markers, all invokes to the
Blur.kt facade (owner + name + desc) from the more-menu facade class, and the facade's
own declared JVM methods (name/desc) read directly from the zip."""
import zipfile, struct

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
FACADE = "com/xuncorp/voxzen/ui/component/\u052c"
MINI = "com/xuncorp/voxzen/ui/player/mini/"
MARKER = b"PlayerMoreMenuFlyout"


def esc(s):
    if s is None:
        return "None"
    out = []
    for c in s:
        o = ord(c)
        out.append(c if 32 <= o < 127 else ("U+%04X" % o))
    return "".join(out)


def cp_only(data):
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
            raise ValueError("bad tag %d at %d" % (tag, i))
        i += 1
    return cp, pos


def full(data):
    cp, pos = cp_only(data)
    this_i = struct.unpack(">H", data[pos + 2:pos + 4])[0]
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
        m = {"name": cp[mni][1], "desc": cp[mdi][1], "code": None}
        for _a in range(na):
            an, al = struct.unpack(">HI", data[pos:pos + 6])
            pos += 6
            if cp[an][0] == "u" and cp[an][1] == "Code":
                clen = struct.unpack(">I", data[pos + 4:pos + 8])[0]
                m["code"] = data[pos + 8:pos + 8 + clen]
            pos += al
        methods.append(m)
    return cp, cp[cp[this_i][1]][1], methods


def anyref(cp, idx):
    e = cp[idx] if 0 < idx < len(cp) else None
    if not e or e[0] != "r2":
        return None
    c, nt = cp[e[1]], cp[e[2]]
    if not (c and c[0] == "r1" and nt and nt[0] == "r2"):
        return None
    cname = cp[c[1]][1] if cp[c[1]][0] == "u" else None
    return (cname, cp[nt[1]][1], cp[nt[2]][1])


def scans(data):
    cp, thisn, methods = full(data)
    out = []
    for m in methods:
        code = m["code"]
        if not code:
            continue
        for pos in range(len(code) - 2):
            op = code[pos]
            if op not in (0xB6, 0xB7, 0xB8, 0xB9):
                continue
            ref = anyref(cp, struct.unpack(">H", code[pos + 1:pos + 3])[0])
            if ref:
                out.append((m["name"], m["desc"], hex(op), ref))
    return thisn, methods, out


def main():
    z = zipfile.ZipFile(ZIP)
    names = [n for n in z.namelist() if n.endswith(".class")]
    print("=== mini package entries containing marker ===")
    mini = [n for n in names if n.startswith(MINI)]
    for n in mini:
        d = z.read(n)
        if MARKER in d:
            thisn, methods, out = scans(d)
            print("entry", esc(n), "size", len(d))
            print("internal", esc(thisn), "methods", len(methods))
            for m in methods:
                print("   M", esc(m["name"]), "|", esc(m["desc"]),
                      "code" if m["code"] else "no-code")
            print("   -- invokes to Blur facade --")
            for (mn, md, op, ref) in out:
                if ref[0] == FACADE:
                    print("      in", esc(mn), esc(md))
                    print("         ", op, esc(ref[1]), esc(ref[2]))
            print("   -- all invokestatic to com/xuncorp classes with Function0/Function2/Function1 descs --")
            for (mn, md, op, ref) in out:
                if ref[2].startswith("(Lkotlin/jvm/functions/Function0;Lkotlin/jvm/functions/Function2;Lkotlin/jvm/functions/Function1;"):
                    print("      in", esc(mn), esc(md))
                    print("         owner", esc(ref[0]), "name", esc(ref[1]), "desc", esc(ref[2]))
    print()
    print("=== facade declared methods (zip bytes) ===")
    d = z.read(FACADE + ".class")
    thisn, methods, out = scans(d)
    print("internal", esc(thisn), "size", len(d))
    for m in methods:
        print("   M", esc(m["name"]), "|", esc(m["desc"]))


if __name__ == "__main__":
    main()
