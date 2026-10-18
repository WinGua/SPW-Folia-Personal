# -*- coding: utf-8 -*-
"""Dump declared methods + selected invokes for specific host class entries (zip-direct)."""
import zipfile, struct

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
ENTRIES = [
    "androidx/compose/ui/\u0113.class",          # ē  (PlayerMoreMenuFlyout per docs)
    "androidx/compose/ui/\u0aa0.class",          # ઠ
    "androidx/compose/ui/\u09a4.class",          # U+09A4 (has 播放速度 lambda child)
    "androidx/compose/ui/\u09a4$\u037f$1.class",
    "com/xuncorp/voxzen/ui/player/mini/\u037f.class",
]
FACADE = "com/xuncorp/voxzen/ui/component/\u052c"
COMPONENT = "com/xuncorp/voxzen/ui/component/"


def esc(s):
    if s is None:
        return "None"
    return "".join(c if 32 <= ord(c) < 127 else ("U+%04X" % ord(c)) for c in s)


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
            raise ValueError("bad tag %d" % tag)
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


def main():
    z = zipfile.ZipFile(ZIP)
    for entry in ENTRIES:
        try:
            data = z.read(entry)
        except KeyError:
            print("MISSING", esc(entry))
            continue
        print("=" * 100)
        print("ENTRY", esc(entry), "size", len(data))
        cp, thisn, methods = full(data)
        print("internal", esc(thisn))
        for m in methods:
            print("  M", esc(m["name"]), "|", esc(m["desc"]), "" if m["code"] else "NO-CODE")
            code = m["code"]
            if not code:
                continue
            seen = set()
            for pos in range(len(code) - 2):
                op = code[pos]
                if op not in (0xB6, 0xB7, 0xB8, 0xB9):
                    continue
                ref = anyref(cp, struct.unpack(">H", code[pos + 1:pos + 3])[0])
                if ref and (ref[0] == FACADE or (ref[0] or "").startswith(COMPONENT)):
                    key = (ref[0], ref[1], ref[2])
                    if key not in seen:
                        seen.add(key)
                        print("      invoke", hex(op), "owner", esc(ref[0]), "name", esc(ref[1]),
                              "desc", esc(ref[2]))
        print()


if __name__ == "__main__":
    main()
