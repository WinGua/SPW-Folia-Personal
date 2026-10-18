# -*- coding: utf-8 -*-
"""Scan host class files for references to a target class name (raw modified-UTF8 bytes),
and dump constant-pool utf8 strings matching a prefix from a given class file."""
import os, sys, struct

ROOT = r"C:\Users\24037\AppData\Local\Temp\hostfull"

FACADE = "com/xuncorp/voxzen/ui/component/\u052c"   # Blur.kt file facade


def iter_classes(root):
    for dirpath, _, names in os.walk(root):
        for nm in names:
            if nm.endswith(".class"):
                yield os.path.join(dirpath, nm)


def scan_raw(target):
    b = target.encode("utf-8")
    hits = []
    for p in iter_classes(ROOT):
        try:
            data = open(p, "rb").read()
        except OSError:
            continue
        if b in data:
            hits.append(os.path.relpath(p, ROOT))
    return hits


def parse_utf8s(data):
    """Return all CONSTANT_Utf8 strings from a class file."""
    cpc = struct.unpack(">H", data[8:10])[0]
    out = []
    i, pos = 1, 10
    while i < cpc:
        tag = data[pos]
        pos += 1
        if tag == 1:
            ln = struct.unpack(">H", data[pos:pos + 2])[0]
            pos += 2
            out.append(data[pos:pos + ln].decode("utf-8", "replace"))
            pos += ln
        elif tag in (7, 8, 16, 19, 20):
            pos += 2
        elif tag == 15:
            pos += 3
        elif tag in (3, 4, 9, 10, 11, 12, 17, 18):
            pos += 4
        elif tag in (5, 6):
            pos += 8
            i += 1
        else:
            raise ValueError("bad tag %s at %s" % (tag, i))
        i += 1
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "scan"
    if mode == "scan":
        hits = scan_raw(FACADE)
        print("FILES REFERENCING FACADE:", len(hits))
        for h in hits:
            print("  ", h)
    elif mode == "utf8s":
        p = sys.argv[2]
        pref = sys.argv[3] if len(sys.argv) > 3 else ""
        for s in parse_utf8s(open(p, "rb").read()):
            if pref in s:
                print(repr(s))
    elif mode == "scanname":
        # search utf8 string fragments (e.g. 'BlurPopupMenu') in all class files
        frag = sys.argv[2].encode("utf-8")
        hits = []
        for p in iter_classes(ROOT):
            try:
                data = open(p, "rb").read()
            except OSError:
                continue
            if frag in data:
                hits.append(os.path.relpath(p, ROOT))
        print("FILES CONTAINING %r: %d" % (frag, len(hits)))
        for h in hits[:80]:
            print("  ", h)


if __name__ == "__main__":
    main()
