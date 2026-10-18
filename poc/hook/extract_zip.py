# -*- coding: utf-8 -*-
"""Correctly extract all class files from the SPW host jar to a clean dir.

Earlier extraction (C:\\Users\\24037\\AppData\\Local\\Temp\\hostfull) produced WRONG
contents for some entries (e.g. androidx/compose/ui/ē.class was 1329 B instead of the
real 12406 B), so always read host classes directly from the zip or via this script.
"""
import zipfile, os, sys

ZIP = r"C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll"
OUT = r"C:\Users\24037\AppData\Local\Temp\hostfix"


def main():
    z = zipfile.ZipFile(ZIP)
    names = z.namelist()
    os.makedirs(OUT, exist_ok=True)
    written = 0
    skipped = 0
    dirmap = {}
    for i, n in enumerate(names):
        if not (n.endswith(".class") or n.endswith(".xml") or n.endswith(".json") or n.startswith("META-INF/")):
            continue
        target = os.path.join(OUT, *n.split("/"))
        try:
            data = z.read(n)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(data)
            written += 1
        except Exception as ex:
            skipped += 1
            if skipped < 10:
                print("SKIP", repr(n), ex, file=sys.stderr)
        if i % 5000 == 0:
            print("...", i, "written", written, flush=True)
    print("DONE written", written, "skipped", skipped)


if __name__ == "__main__":
    main()
