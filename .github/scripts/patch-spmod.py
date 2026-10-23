#!/usr/bin/env python3
"""Wrap the freshly built plugin + native host into the released .spmod.

The full .spmod also carries Folia's web bundle and the settings UI, which are generated from
Folia's own sources and are not part of this repository. For a test build we therefore start from
the published release package and swap only the two artifacts this branch changes:

  * classes/ + META-INF/MANIFEST.MF  <- the plugin .spmod produced by `gradlew plugin`
  * native/spw-folia-host.exe        <- the helper built by poc/webview/host/build.sh

Usage:
  python .github/scripts/patch-spmod.py official.spmod plugin.spmod host.exe out.spmod
"""
import sys
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    official, plugin, host_exe, out = (Path(arg) for arg in sys.argv[1:])
    for path in (official, plugin, host_exe):
        if not path.is_file():
            print(f"ERROR: missing input {path}", file=sys.stderr)
            return 3
    out.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(official) as base, zipfile.ZipFile(plugin) as bundle:
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as target:
            for info in base.infolist():
                name = info.filename
                if name.startswith("classes/"):
                    continue
                if name == "native/spw-folia-host.exe":
                    continue
                if name.endswith("META-INF/MANIFEST.MF"):
                    continue
                target.writestr(info, base.read(name))

            copied = 0
            for info in bundle.infolist():
                name = info.filename
                if not (name.startswith("classes/") or name.endswith("META-INF/MANIFEST.MF")):
                    continue
                target.writestr(info, bundle.read(name))
                copied += 1

            target.write(host_exe, "native/spw-folia-host.exe")

    print(f"wrote {out} ({out.stat().st_size} bytes, {copied} plugin entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
