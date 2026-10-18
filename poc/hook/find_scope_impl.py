# -*- coding: utf-8 -*-
"""Find classes that implement androidx.compose.ui.<U+09A8> (MenuFlyoutScope) in the
host zip and print their declared JVM methods (name/desc) read straight from the zip."""
import zipfile, struct

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
SCOPE = "androidx/compose/ui/\u09a8"


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
    sup_i = struct.unpack(">H", data[pos + 4:pos + 6])[0]
    pos += 6
    ni = struct.unpack(">H", data[pos:pos + 2])[0]
    pos += 2
    itf = []
    for _ in range(ni):
        itf.append(struct.unpack(">H", data[pos:pos + 2])[0])
        pos += 2
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
        m = {"flags": fl, "name": cp[mni][1], "desc": cp[mdi][1]}
        for _a in range(na):
            an, al = struct.unpack(">HI", data[pos:pos + 6])
            pos += 6 + al
        methods.append(m)

    def r1name(idx):
        e = cp[idx]
        if e and e[0] == "r1" and cp[e[1]][0] == "u":
            return cp[e[1]][1]
        return None

    return cp, r1name(this_i), r1name(sup_i), [r1name(x) for x in itf], methods


def main():
    z = zipfile.ZipFile(ZIP)
    names = [n for n in z.namelist() if n.endswith(".class")]
    print("scanning", len(names), "entries for", esc(SCOPE))
    for n in names:
        try:
            d = z.read(n)
        except Exception:
            continue
        if SCOPE.encode("utf-8") not in d:
            continue
        try:
            cp, thisn, supn, itfs, methods = full(d)
        except Exception as e:
            print("PARSE-ERR", esc(n), e)
            continue
        if SCOPE in itfs:
            print()
            print("-- IMPLEMENTOR", esc(n))
            print("   internal", esc(thisn), "super", esc(supn), "ifaces", [esc(x) for x in itfs])
            for m in methods:
                print("   M", hex(m["flags"]), esc(m["name"]), "|", esc(m["desc"]))
    print("done")


if __name__ == "__main__":
    main()
