#!/usr/bin/env python3
"""Create a versioned, SHA-256 verified website release bundle offline."""
import hashlib, json, os, shutil
from pathlib import Path
import importlib.util
spec = importlib.util.spec_from_file_location("staging", Path(__file__).with_name("website-staging-deploy.py"))
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "website-release"
OUT.mkdir(parents=True, exist_ok=True)
version = os.environ.get("RELEASE_VERSION") or os.environ.get("GITHUB_SHA", "local")
files = staging.approved_files()
hashes = {}
for name in files:
    src = ROOT / name
    dst = OUT / name
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    hashes[name] = hashlib.sha256(dst.read_bytes()).hexdigest()
manifest = {"version": 1, "release": version, "files": hashes}
(OUT / "release-manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
print(f"Created website release {version} with {len(hashes)} files")
