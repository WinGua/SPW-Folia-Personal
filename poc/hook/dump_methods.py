# -*- coding: utf-8 -*-
"""Print declared methods (escaped name + descriptor) of classes in the host zip.
Usage: python dump_methods.py <internal-or-entry-substring> [...]
Reads straight from the zip so R8/unicode/case-collision issues don't apply."""
import sys, struct, zipfile

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"


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
            raise ValueError("bad tag %d at %d" % (tag, pos))
        i += 1
    return cp, pos


def parse_class(data):
    cp, pos = parse_cp(data)
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

    return r1name(this_i), r1name(sup_i), [r1name(x) for x in itf], cp, methods


def main():
    pats = sys.argv[1:]
    z = zipfile.ZipFile(ZIP)
    names = [n for n in z.namelist() if n.endswith(".class")]
    for pat in pats:
        p_esc = "".join(c if 32 <= ord(c) < 127 else ("U+%04X" % ord(c)) for c in pat)
        print("=== pattern", p_esc)
        for n in names:
            if pat not in n:
                continue
            d = z.read(n)
            try:
                internal, sup, itfs, cp, methods = parse_class(d)
            except Exception as e:
                print("PARSE-ERR", esc(n), e)
                continue
            print("-- entry", esc(n), "size", len(d))
            print("   internal", esc(internal), "super", esc(sup),
                  "ifaces", [esc(x) for x in itfs])
            for m in methods:
                print("   M", hex(m["flags"]), esc(m["name"]), "|", esc(m["desc"]))


if __name__ == "__main__":
    main()
