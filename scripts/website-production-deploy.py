#!/usr/bin/env python3
"""Guarded production deploy of an already-created website release bundle."""
import argparse, ftplib, hashlib, json, os, ssl
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_HOST = os.environ.get("PROD_FTPS_EXPECTED_HOST", "")
EXPECTED_ROOT = os.environ.get("PROD_FTPS_EXPECTED_ROOT", "")

def verify_bundle(bundle, staging_run_id=None, commit_sha=None):
    manifest = json.loads((bundle / "release-manifest.json").read_text())
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Invalid release manifest")
    for name, digest in files.items():
        p = PurePosixPath(name)
        if p.is_absolute() or ".." in p.parts or not isinstance(digest, str):
            raise ValueError("Unsafe release manifest path")
        path = bundle / name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Release SHA-256 verification failed")
    record = json.loads((bundle / "staging-deployment-record.json").read_text())
    if record.get('status') != 'verified' or record.get('run_id') != str(staging_run_id) or record.get('commit_sha') != commit_sha or record.get('artifact_name') != 'anise-website-staging-release-'+commit_sha:
        raise ValueError("Staging deployment evidence does not match selected release")
    return files

def check_settings(host, root, require_credentials):
    if not EXPECTED_HOST or not EXPECTED_ROOT:
        raise ValueError("Production host/root approval is not configured")
    if host != EXPECTED_HOST or root != EXPECTED_ROOT:
        raise ValueError("Production host or exact remote root is not approved")
    if host in {"wsuk32.pronameserver.com", ""} or "staging" in root.lower():
        raise ValueError("Staging target or empty production target refused")
    if require_credentials and (not os.environ.get("PROD_FTPS_USERNAME") or not os.environ.get("PROD_FTPS_PASSWORD")):
        raise ValueError("Separate production FTPS credentials are required")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--bundle", required=True); ap.add_argument("--staging-run-id", required=True); ap.add_argument("--commit-sha", required=True); ap.add_argument("--host", required=True); ap.add_argument("--root", required=True); ap.add_argument("--mode", choices=("check", "deploy"), default="check")
    a = ap.parse_args(); check_settings(a.host, a.root, a.mode == "deploy"); files = verify_bundle(Path(a.bundle), a.staging_run_id, a.commit_sha)
    if a.mode == "check": print(f"CHECK ONLY: verified {len(files)} files; no FTPS connection or write performed."); return
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=60)
    try:
        ftp.connect(a.host, 21); ftp.login(os.environ["PROD_FTPS_USERNAME"], os.environ["PROD_FTPS_PASSWORD"]); ftp.prot_p(); ftp.cwd(a.root)
        for name in files:
            local = Path(a.bundle) / name; parent = PurePosixPath(name).parent
            ftp.cwd(a.root)
            for part in parent.parts:
                try: ftp.cwd(part)
                except ftplib.error_perm:
                    ftp.mkd(part); ftp.cwd(part)
            with local.open("rb") as stream: ftp.storbinary("STOR " + PurePosixPath(name).name, stream)
        print(f"DEPLOYED: {len(files)} verified release files; configuration/runtime files were not targeted.")
    finally:
        try: ftp.quit()
        except Exception: ftp.close()

if __name__ == "__main__":
    try: main()
    except Exception as e: print("PRODUCTION DEPLOYMENT FAILED:", type(e).__name__, str(e)); raise SystemExit(1)
