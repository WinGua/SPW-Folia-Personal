# -*- coding: utf-8 -*-
"""Locate the real mini-player '更多' menu class and every call site of the
BlurPopupMenu(Function0, Function2, Function1, Composer, int, int) facade method
inside the SPW host jar (read straight from the polyglot zip)."""
import zipfile, struct, sys

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
FACADE = "com/xuncorp/voxzen/ui/component/\u052c"
TARGET_DESC = ("(Lkotlin/jvm/functions/Function0;Lkotlin/jvm/functions/Function2;"
               "Lkotlin/jvm/functions/Function1;Landroidx/compose/runtime/Composer;II)V")
MARKERS = {b"\xe6\x92\xad\xe6\x94\xbe\xe9\x80\x9f\xe5\xba\xa6": "播放速度",
           b"\xe9\x87\x8a\xe6\x94\xbe\xe9\x9f\xb3\xe9\xa2\x91\xe5\xbc\x95\xe6\x93\x8e": "释放音频引擎",
           b"\xe6\xa1\x8c\xe9\x9d\xa2\xe6\xad\x8c\xe8\xaf\x8d": "桌面歌词",
           b"PlayerMoreMenuFlyout": "PlayerMoreMenuFlyout"}


def esc(s):
    if s is None:
        return "None"
    out = []
    for c in s:
        o = ord(c)
        if 32 <= o < 127:
            out.append(c)
        elif o < 0x10000:
            out.append("U+%04X" % o)
        else:
            out.append("U+%X" % o)
    return "".join(out)


def load_cp_only(data):
    """Cheap constant-pool walk; returns cp list or None."""
    try:
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
                return None
            i += 1
        return cp, pos
    except Exception:
        return None


def parse_full(data):
    r = load_cp_only(data)
    if not r:
        raise ValueError("cp fail")
    cp, pos = r
    pos += 6  # access,this,super
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
    return cp, methods


def u(cp, i):
    e = cp[i] if 0 < i < len(cp) else None
    return e[1] if e and e[0] == "u" else None


def cp_anyref(cp, idx):
    e = cp[idx] if 0 < idx < len(cp) else None
    if not e or e[0] != "r2":
        return None
    c, nt = cp[e[1]], cp[e[2]]
    if not (c and c[0] == "r1" and nt and nt[0] == "r2"):
        return None
    return (u(cp, c[1]), u(cp, nt[1]), u(cp, nt[2]))


def main():
    z = zipfile.ZipFile(ZIP)
    classes = [n for n in z.namelist() if n.endswith(".class") and n.startswith("com/")]
    print("scanning", len(classes), "com/* class entries for markers", flush=True)
    marker_hits = {}
    for n in classes:
        try:
            d = z.read(n)
        except Exception:
            continue
        for raw, label in MARKERS.items():
            if raw in d:
                marker_hits.setdefault(label, []).append(n)
    print("=== marker hits ===")
    for label, lst in marker_hits.items():
        print("--", label, len(lst))
        for n in lst[:30]:
            print("   ", esc(n))
    print()
    print("=== call sites of target BlurPopupMenu desc across ALL classes ===")
    for n in classes:
        try:
            d = z.read(n)
        except Exception:
            continue
        if FACADE.encode("utf-8") not in d:
            continue
        try:
            cp, methods = parse_full(d)
        except Exception as e:
            print("parse err", esc(n), e)
            continue
        thisn = None
        for idx in range(1, len(cp)):
            e = cp[idx]
            if e and e[0] == "u" and e[1] == n[:-6]:
                thisn = e[1]
        for m in methods:
            code = m["code"]
            if not code:
                continue
            for pos in range(len(code) - 2):
                op = code[pos]
                if op not in (0xB6, 0xB7, 0xB8, 0xB9):
                    continue
                idx = struct.unpack(">H", code[pos + 1:pos + 3])[0]
                ref = cp_anyref(cp, idx)
                if ref and ref[0] == FACADE and ref[2] == TARGET_DESC:
                    print("-- class", esc(n))
                    print("     enclosing", esc(m["name"]), esc(m["desc"]))
                    print("     call", hex(op), "name", esc(ref[1]))
    print("done")


if __name__ == "__main__":
    main()
