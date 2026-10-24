#!/usr/bin/env python3
"""Assemble the personal test .spmod from the pinned base package + this repo's builds.

The repository does not carry Folia's web bundle or the settings UI dist (both are generated
from Folia's own sources outside this repo), so every cloud build starts from the official
0.3.1 package kept as the `base-v0.3.1` release asset and replaces only what this repo builds:

  * classes/ (+ lib/, META-INF/)  <- the plugin archive produced by `gradlew plugin`
  * native/                        <- the helper built by poc/webview/host/build.sh

Native files are taken as a whole set (exe + .config + the three WebView2 dlls from the same
SDK), so the exe's assembly references always match the dlls that ship next to it.

Usage:
  python .github/scripts/assemble-spmod.py \
      --base base.zip --plugin plugin.spmod \
      --native-dir poc/webview/host/build --out dist/spw-folia-0.3.2-test.spmod
"""
import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

NATIVE_FILES = (
    "spw-folia-host.exe",
    "spw-folia-host.exe.config",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll",
)
REQUIRED_BASE = ("web/index.html", "web/settings/settings-ui.js")
REQUIRED_PLUGIN = ("META-INF/MANIFEST.MF", "META-INF/extensions.idx")
REQUIRED_MANIFEST_KEYS = ("Plugin-Id", "Plugin-Class", "Plugin-Version", "Plugin-Name")
# Fixed timestamp keeps the output byte-for-byte reproducible for the same inputs.
FIXED_DATE = (2026, 1, 1, 0, 0, 0)


def read_manifest(zf: zipfile.ZipFile) -> dict:
    for name in zf.namelist():
        if name.endswith("META-INF/MANIFEST.MF"):
            text = zf.read(name).decode("utf-8", "replace")
            attrs = {}
            for line in text.splitlines():
                if ": " in line and not line.startswith(" "):
                    key, value = line.split(": ", 1)
                    attrs[key.strip()] = value.strip()
            return attrs
    return {}


def write_entry(zf: zipfile.ZipFile, name: str, data: bytes, seen: set) -> None:
    if name in seen:
        raise SystemExit(f"ERROR: duplicate entry {name}")
    seen.add(name)
    info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, data)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="official .spmod (zip) used as the payload base")
    ap.add_argument("--plugin", required=True, help=".spmod produced by `gradlew plugin`")
    ap.add_argument("--native-dir", required=True, help="helper build output directory")
    ap.add_argument("--out", required=True, help="output .spmod path")
    args = ap.parse_args(argv)

    base, plugin = Path(args.base), Path(args.plugin)
    native_dir, out = Path(args.native_dir), Path(args.out)
    for path in (base, plugin):
        if not path.is_file():
            print(f"ERROR: missing {path}", file=sys.stderr)
            return 2
    missing = [name for name in NATIVE_FILES if not (native_dir / name).is_file()]
    if missing:
        print(f"ERROR: native build output incomplete, missing {missing}", file=sys.stderr)
        return 3

    with zipfile.ZipFile(base) as base_zf, zipfile.ZipFile(plugin) as plugin_zf:
        base_names = set(base_zf.namelist())
        missing = [name for name in REQUIRED_BASE if name not in base_names]
        if missing:
            print(f"ERROR: base package lacks {missing}", file=sys.stderr)
            return 4
        plugin_names = set(plugin_zf.namelist())
        # The plugin archive keeps the workshop layout: classes/ at the root of the entry names.
        missing = [
            name for name in REQUIRED_PLUGIN
            if f"classes/{name}" not in plugin_names
        ]
        if missing:
            print(f"ERROR: plugin archive lacks classes/{missing}", file=sys.stderr)
            return 5

        base_manifest = read_manifest(base_zf)
        plugin_manifest = read_manifest(plugin_zf)
        missing = [key for key in REQUIRED_MANIFEST_KEYS if key not in plugin_manifest]
        if missing:
            print(f"ERROR: plugin manifest missing {missing}", file=sys.stderr)
            return 6
        if base_manifest.get("Plugin-Id") != plugin_manifest.get("Plugin-Id"):
            print(
                "ERROR: base and plugin Plugin-Id differ "
                f"({base_manifest.get('Plugin-Id')} != {plugin_manifest.get('Plugin-Id')})",
                file=sys.stderr,
            )
            return 7

        out.parent.mkdir(parents=True, exist_ok=True)
        seen: set = set()
        kept = 0
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as target:
            # Everything the base carries except the plugin classes and the native set.
            for info in base_zf.infolist():
                name = info.filename
                if name.endswith("/") or name.startswith(("classes/", "native/")):
                    continue
                write_entry(target, name, base_zf.read(name), seen)
                kept += 1

            # This repo's plugin build: classes/ + any lib/ + the workspace manifest.
            payload = 0
            for info in plugin_zf.infolist():
                name = info.filename
                if name.endswith("/") or name.startswith(("native/", "web/")):
                    continue
                write_entry(target, name, plugin_zf.read(name), seen)
                payload += 1

            for name in NATIVE_FILES:
                write_entry(target, f"native/{name}", (native_dir / name).read_bytes(), seen)

    data = out.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    print(f"assembled {out} ({len(data)} bytes)")
    print(f"  base payload entries:   {kept}")
    print(f"  plugin payload entries: {payload}")
    print(f"  native entries:         {len(NATIVE_FILES)}")
    print(
        "  manifest: "
        f"id={plugin_manifest.get('Plugin-Id')} "
        f"version={plugin_manifest.get('Plugin-Version')} "
        f"class={plugin_manifest.get('Plugin-Class')}"
    )
    print(f"  sha256: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
