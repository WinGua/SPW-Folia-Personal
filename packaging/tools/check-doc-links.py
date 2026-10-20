#!/usr/bin/env python3
"""Fail if any local markdown/HTML link in the repository points at a missing file.

Keeps `docs/` honest after archival sweeps: a moved page that leaves a stale
`docs/<name>.md` reference behind breaks on GitHub while still looking fine in a
diff. Run from anywhere; paths are resolved relative to the repository root.

    python packaging/tools/check-doc-links.py

Excluded: the repository root's build/scratch directories, generated bundles and
vendored research assets (their links are not part of the shipped docs).
"""

import os
import re
import sys

SKIP_DIRS = {
    ".git", "work", "dist", "tmp-deps", "tmp-repro-thread", "tmp-verify",
    "tmp-inspect", "node_modules", "build", "backup", "dist-web", "out",
}
SKIP_PREFIXES = (
    "poc/hook/backup/", "poc/settings-ui/dist/", "packaging/web/",
    "packaging/native/", "research/", "tmp-verify/",
)

LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_RE = re.compile(r"(?:src|href)=\"([^\"]+)\"")


def repo_root():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(os.path.dirname(here))


def markdown_files(root):
    out = []
    for cur, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if not name.endswith(".md"):
                continue
            full = os.path.join(cur, name)
            rel = os.path.relpath(full, root).replace("\\", "/")
            if rel.startswith(SKIP_PREFIXES):
                continue
            out.append(rel)
    return sorted(out)


def main():
    root = repo_root()
    bad = []
    files = markdown_files(root)
    for rel in files:
        text = open(os.path.join(root, rel), encoding="utf-8").read()
        for target in LINK_RE.findall(text) + HTML_RE.findall(text):
            # absolute URLs, in-page anchors and host-absolute paths are not repo files
            if target.startswith(("http://", "https://", "mailto:", "#", "/")):
                continue
            # placeholder paths are written with an ellipsis, not meant to resolve
            if "…" in target or "..." in target:
                continue
            target = target.split("#")[0]
            if not target:
                continue
            resolved = os.path.normpath(
                os.path.join(os.path.dirname(rel), target)
            ).replace("\\", "/")
            if not os.path.exists(os.path.join(root, resolved)):
                bad.append((rel, target, resolved))

    print(f"scanned {len(files)} markdown files")
    if bad:
        print(f"broken local links: {len(bad)}")
        for rel, target, resolved in bad:
            print(f"  {rel}: {target}  ->  {resolved}")
        return 1
    print("all local links resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
