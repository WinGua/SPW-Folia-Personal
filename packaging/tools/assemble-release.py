#!/usr/bin/env python3
"""Assemble the release .spmod for spw-folia.

Takes the plugin archive produced by the official SPW workshop Gradle plugin
(classes/ + lib/ + META-INF manifest) and merges the packaging payload
(web/ + native/ + licenses/) into one deterministic .spmod.

Usage:
  python packaging/tools/assemble-release.py \
      --spmod  spw-folia/build/libs/plugin-dev.spw.folia-0.1.0.spmod \
      --staging packaging \
      --out dist/release \
      --name spw-folia-0.1.0-windows-x64.spmod

Staging layout (provided by webview-spike / task-8):
  packaging/web/                 Folia dist subset (index.html, assets/, settings/, shim.js, fonts, thumbs)
  packaging/native/              spw-folia-host.exe (+ WebView2Loader.dll)
  packaging/licenses/            AGPL-3.0, THIRD_PARTY_NOTICES, FOLIA_UPSTREAM, per-dependency licenses
  packaging/web/settings/settings-ui.js   injected settings UI bundle
  packaging/testdata/            example songs (optional, kept out of release by --link-testdata)
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

REQUIRED_WEB = ["index.html", "settings/settings-ui.js"]
REQUIRED_NATIVE = ["spw-folia-host.exe"]
REQUIRED_LICENSES = ["AGPL-3.0.txt", "NOTICE.md", "THIRD-PARTY.md", "SOURCE-OFFER.md", "AUDIO-MIT.txt"]
REQUIRED_SPMOD_MANIFEST_KEYS = ["Plugin-Id", "Plugin-Class", "Plugin-Version", "Plugin-Name"]


def read_manifest(zf: zipfile.ZipFile) -> dict:
    for name in zf.namelist():
        if name.endswith("META-INF/MANIFEST.MF"):
            text = zf.read(name).decode("utf-8", "replace")
            attrs = {}
            for line in text.splitlines():
                if ": " in line and not line.startswith(" "):
                    k, v = line.split(": ", 1)
                    attrs[k.strip()] = v.strip()
            return attrs
    return {}


def add_tree(zf: zipfile.ZipFile, root: Path, arc_prefix: str, skip=()) -> int:
    count = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if any(rel == s or rel.startswith(s + "/") for s in skip):
            continue
        arc = f"{arc_prefix}/{rel}" if arc_prefix else rel
        info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(path, "rb") as fh:
            data = fh.read()
        zf.writestr(info, data)
        count += 1
    return count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spmod", required=True)
    ap.add_argument("--staging", default="packaging")
    ap.add_argument("--out", default="dist/release")
    ap.add_argument("--name", default="spw-folia-0.1.0-windows-x64.spmod")
    ap.add_argument("--no-testdata", action="store_true", default=True)
    args = ap.parse_args()

    root = Path.cwd()
    spmod = Path(args.spmod)
    if not spmod.is_absolute():
        spmod = root / spmod
    staging = (root / args.staging).resolve()
    out_dir = (root / args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / args.name

    errors = []

    if not spmod.is_file():
        print(f"ERROR: spmod not found: {spmod}", file=sys.stderr)
        return 2

    for rel in REQUIRED_WEB:
        if not (staging / "web" / rel).is_file():
            errors.append(f"missing web/{rel}")
    for rel in REQUIRED_NATIVE:
        if not (staging / "native" / rel).is_file():
            errors.append(f"missing native/{rel}")
    for rel in REQUIRED_LICENSES:
        if not (staging / "licenses" / rel).is_file():
            errors.append(f"missing licenses/{rel}")
    if errors:
        print("ERROR: staging incomplete:\n  " + "\n  ".join(errors), file=sys.stderr)
        print("(task-8 webview-spike owns packaging/; run again after it completes)", file=sys.stderr)
        return 3

    with zipfile.ZipFile(spmod) as zf:
        manifest = read_manifest(zf)
        missing = [k for k in REQUIRED_SPMOD_MANIFEST_KEYS if k not in manifest]
        if missing:
            print(f"ERROR: spmod manifest missing {missing}", file=sys.stderr)
            return 4
        if manifest.get("Plugin-Permissions") and "class-transform" not in manifest["Plugin-Permissions"]:
            errors.append("manifest Plugin-Permissions lacks class-transform")
        tmp = Path(tempfile.mkdtemp(prefix="spmod-"))
        zf.extractall(tmp)

    # Rebuild deterministically: plugin payload + staging payload.
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        added = add_tree(zf, tmp, "")
        added += add_tree(zf, staging / "web", "web")
        added += add_tree(zf, staging / "native", "native")
        added += add_tree(zf, staging / "licenses", "licenses")
        testdata = staging / "testdata"
        if testdata.is_dir() and not args.no_testdata:
            added += add_tree(zf, testdata, "testdata")
    shutil.rmtree(tmp, ignore_errors=True)

    data = target.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    meta = {
        "file": target.name,
        "sizeBytes": len(data),
        "sizeMB": round(len(data) / (1024 * 1024), 2),
        "sha256": sha,
        "entries": added,
        "pluginId": manifest.get("Plugin-Id"),
        "pluginClass": manifest.get("Plugin-Class"),
        "pluginVersion": manifest.get("Plugin-Version"),
        "pluginName": manifest.get("Plugin-Name"),
        "permissions": manifest.get("Plugin-Permissions", ""),
        "sourceSpmod": str(spmod),
    }
    (out_dir / (target.name + ".json")).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
