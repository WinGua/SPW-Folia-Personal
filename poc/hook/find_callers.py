# -*- coding: utf-8 -*-
"""Find all classes in the host zip that reference a given owner+name+descriptor.
Reads the constant pool of every class entry; prints referenced-owner hits with caller context.
Usage: python find_callers.py <ownerInternalOrDots> <methodNameEscapedOrPlain> [descriptor]
Names may contain spaces/obfuscated chars: pass as UTF-8 argv.
"""
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
            raise ValueError("bad tag %d" % tag)
        i += 1
    return cp, pos


def u(cp, i):
    e = cp[i] if 0 <= i < len(cp) else None
    if e and e[0] == "u":
        return e[1]
    return None


def class_methods(data):
    """return (thisName, methods[(name,desc)], refs[(owner,name,desc)])"""
    cp, pos = parse_cp(data)
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
        methods.append((u(cp, mni), u(cp, mdi)))
        for _a in range(na):
            an, al = struct.unpack(">HI", data[pos:pos + 6])
            pos += 6 + al
    refs = []
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
                refs.append((owner, name, desc))
    return u(cp, this_i), methods, refs


def main():
    if len(sys.argv) < 3:
        print("usage: find_callers.py <owner> <methodName> [descriptor]")
        return
    owner_arg = sys.argv[1].replace(".", "/")
    name_arg = sys.argv[2]
    desc_arg = sys.argv[3] if len(sys.argv) > 3 else None
    z = zipfile.ZipFile(ZIP)
    names = [n for n in z.namelist() if n.endswith(".class")]
    print("owner=", esc(owner_arg), "name=", esc(name_arg), "desc=", esc(desc_arg),
          "entries=", len(names))
    for n in names:
        try:
            d = z.read(n)
        except Exception:
            continue
        try:
            this, methods, refs = class_methods(d)
        except Exception:
            continue
        matched = [r for r in refs if r[0] == owner_arg and r[1] == name_arg and
                   (desc_arg is None or r[2] == desc_arg)]
        if matched:
            print("\n== CALLER", esc(n))
            print("   this=", esc(this))
            print("   matched refs:", [(esc(m[1]), esc(m[2])) for m in matched])
            for (mn, md) in methods:
                print("   M", esc(mn), "|", esc(md))


if __name__ == "__main__":
    main()
