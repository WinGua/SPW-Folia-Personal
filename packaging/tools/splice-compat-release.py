"""Splice the freshly built plugin classes onto the v0.3.0 release payload.

v0.3.1 is a compatibility-only release: web/, native/ and licenses/ must stay byte-identical to
the accepted v0.3.0 artifact (packaging/native + packaging/web in this checkout are older than what
shipped in v0.3.0, so re-staging them would regress the helper exe and the settings island).
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

BASE = Path("dist/release/spw-folia-0.3.0-ref.spmod")
CLASSES = Path("spw-folia/build/libs/plugin-dev.spw.folia-0.3.1.spmod")
OUT = Path("dist/release/spw-folia-0.3.1.spmod")
STAMP = (2026, 1, 1, 0, 0, 0)


def main() -> int:
    base = zipfile.ZipFile(BASE)
    classes = zipfile.ZipFile(CLASSES)

    kept = [(i, base.read(i.filename)) for i in base.infolist() if not i.filename.startswith("classes/")]
    replaced = [(i, base.read(i.filename)) for i in base.infolist() if i.filename.startswith("classes/")]
    new = [(i, classes.read(i.filename)) for i in classes.infolist()]

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as out:
        for info, data in kept:
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = info.external_attr
            out.writestr(zi, data)
        for info, data in new:
            zi = zipfile.ZipInfo(info.filename, date_time=STAMP)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            out.writestr(zi, data)

    digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
    size = OUT.stat().st_size
    print("wrote %s (%d B, %.2f MB, sha256=%s)" % (OUT, size, size / 1048576, digest))
    print("kept %d payload entries, dropped %d old classes, added %d new classes"
          % (len(kept), len(replaced), len(new)))

    # Verify every payload entry kept its CRC.
    a = {i.filename: i.CRC for i in base.infolist() if not i.filename.startswith("classes/")}
    b = zipfile.ZipFile(OUT)
    bb = {i.filename: i.CRC for i in b.infolist() if not i.filename.startswith("classes/")}
    if a != bb:
        print("ERROR: payload entries changed", file=sys.stderr)
        print(set(a.items()) ^ set(bb.items()), file=sys.stderr)
        return 1
    print("payload verified: %d/%d entries identical" % (len(a), len(a)))

    meta = {
        "file": OUT.name,
        "sizeBytes": size,
        "sizeMB": round(size / 1048576, 2),
        "sha256": digest,
        "entries": len(b.infolist()),
        "pluginId": "dev.spw.folia",
        "pluginClass": "dev.spw.folia.FoliaPlugin",
        "pluginVersion": "0.3.1",
        "pluginName": "spw-folia",
        "permissions": "class-transform,library-read",
        "payload": "v0.3.0 (web/native/licenses unchanged)",
    }
    (OUT.parent / (OUT.name + ".json")).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
