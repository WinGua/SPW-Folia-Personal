# -*- coding: utf-8 -*-
"""Find the real call site of BlurPopupMenu in the SPW host jar (read directly from the
polyglot zip to avoid Windows case-collision corruption).

Outputs:
  A) all single-char classes directly in androidx/compose/ui/ (entry name vs internal name,
     size, whether they contain marker strings like PlayerMoreMenuFlyout / more-menu text)
  B) for every such class, invokes whose owner is the Blur.kt facade (printed escaped)
  C) declared JVM methods of the facade class
"""
import zipfile, struct, sys

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
FACADE = "com/xuncorp/voxzen/ui/component/\u052c"  # Բ
UI_PKG = "androidx/compose/ui/"
MARKERS = [b"PlayerMoreMenuFlyout", b"BlurMenuFlyout", b"BlurPopupMenu"]


def esc(s):
    if s is None:
        return "None"
    return "".join(c if 32 <= ord(c) < 127 else "U+%04X" % ord(c) for c in s)


def parse_full(data):
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
        m = {"name": cp[mni][1], "desc": cp[mdi][1], "code": None}
        for _a in range(na):
            an, al = struct.unpack(">HI", data[pos:pos + 6])
            pos += 6
            aname = cp[an][1]
            if aname == "Code":
                clen = struct.unpack(">I", data[pos + 4:pos + 8])[0]
                m["code"] = data[pos + 8:pos + 8 + clen]
            pos += al
        methods.append(m)
    return cp, cp[cp[this_i][1]][1], methods


def u(cp, i):
    e = cp[i]
    return e[1] if e and e[0] == "u" else None


def cp_methodref(cp, idx):
    e = cp[idx] if 0 < idx < len(cp) else None
    if not e or e[0] != "r2":
        return None
    c, nt = cp[e[1]], cp[e[2]]
    if not (c and c[0] == "r1" and nt and nt[0] == "r2"):
        return None
    return (u(cp, c[1]), u(cp, nt[1]), u(cp, nt[2]))


def scan_class(data):
    cp, thisn, methods = parse_full(data)
    hits = []
    for m in methods:
        code = m["code"]
        if not code:
            continue
        for pos in range(len(code) - 2):
            op = code[pos]
            if op not in (0xB6, 0xB7, 0xB8, 0xB9):
                continue
            idx = struct.unpack(">H", code[pos + 1:pos + 3])[0]
            ref = cp_methodref(cp, idx)
            if ref and ref[0] == FACADE:
                hits.append((m["name"], m["desc"], hex(op), ref[1], ref[2]))
    return thisn, hits


def main():
    z = zipfile.ZipFile(ZIP)
    names = z.namelist()
    cand = [n for n in names
            if n.startswith(UI_PKG) and n.endswith(".class") and "/" not in n[len(UI_PKG):]
            and len(n[len(UI_PKG):-6]) == 1]
    print("single-char classes in androidx/compose/ui:", len(cand))
    print()
    print("=== A) candidates with markers ===")
    print("== A2) facade declared methods ==")
    try:
        fdata = z.read(FACADE + ".class")
        cp, thisn, methods = parse_full(fdata)
        print("facade internal:", esc(thisn), "size", len(fdata), "methods", len(methods))
        for m in methods:
            print("  M", esc(m["name"]), "|", esc(m["desc"]))
    except KeyError:
        print("FACADE ENTRY MISSING:", FACADE)
        sys.exit(1)
    print()
    print("=== B) single-char androidx/compose/ui classes calling the facade ===")
    any_hit = False
    for entry in sorted(cand):
        data = z.read(entry)
        try:
            thisn, hits = scan_class(data)
        except Exception as e:
            print("  ERR", esc(entry), e)
            continue
        marks = [mk.decode() for mk in MARKERS if mk in data]
        if hits or marks:
            any_hit = True
            print("-- entry", esc(entry), "internal", esc(thisn), "size", len(data),
                  "markers", marks)
            for h in hits:
                print("     in", esc(h[0]), esc(h[1]), "invoke", h[2], "name", esc(h[3]),
                      "desc", esc(h[4]))
    if not any_hit:
        print("NO HITS in single-char androidx/compose/ui classes")


if __name__ == "__main__":
    main()
