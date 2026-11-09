#!/usr/bin/env python3
"""Guarded production deploy of an already-created website release bundle."""
import argparse, ftplib, hashlib, json, os, ssl
import production_transport as transport
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
        if not transport.safe_file(name) or not isinstance(digest, str):
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
        raise ValueError("Production FTPS host/root secrets are missing")
    if host != EXPECTED_HOST or root != EXPECTED_ROOT:
        raise ValueError("Production host or exact remote root is not approved")
    username = os.environ.get("PROD_FTPS_USERNAME", "")
    if not username:
        raise ValueError("Production FTPS username secret is missing")
    if username != 'livesiteftp' or root != '/livesiteftp/wwwroot':
        raise ValueError('Production account/root differs from owner-approved website destination')
    if not __import__('re').fullmatch(r'[A-Za-z0-9.-]+', host):
        raise ValueError('Invalid FTP hostname')
    staging_host = os.environ.get("STAGING_FTPS_HOST", "")
    staging_username = os.environ.get("STAGING_FTPS_USERNAME", "stagesiteftp")
    staging_root = os.environ.get("STAGING_FTPS_ROOT", "/stagesiteftp/wwwroot")
    if root == staging_root or username == staging_username or (staging_host and host == staging_host and root == staging_root):
        raise ValueError("Production FTPS account/root overlaps the staging destination")
    if "staging" in root.lower() or not root.startswith("/"):
        raise ValueError("Production remote root is invalid or targets staging")
    if require_credentials and not os.environ.get("PROD_FTPS_PASSWORD"):
        raise ValueError("Production FTPS password secret is missing")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--bundle", required=True); ap.add_argument("--staging-run-id", required=True); ap.add_argument("--commit-sha", required=True); ap.add_argument("--host", required=True); ap.add_argument("--root", required=True); ap.add_argument("--mode", choices=("check", "bootstrap", "deploy"), default="check"); ap.add_argument("--owner-confirmation", default=""); ap.add_argument("--backup-confirmation", default=""); ap.add_argument("--backup-reference", default="")
    a = ap.parse_args(); check_settings(a.host, a.root, a.mode != "check"); files = verify_bundle(Path(a.bundle), a.staging_run_id, a.commit_sha)
    print('Offline artifact and destination validation passed')
    transport.operate(a.host, os.environ['PROD_FTPS_USERNAME'], os.environ['PROD_FTPS_PASSWORD'], a.root, Path(a.bundle), files, a.mode, a.owner_confirmation, a.backup_confirmation, a.backup_reference)

if __name__ == "__main__":
    try: main()
    except Exception as e: print('FAILED at ' + transport.STAGE + ' (' + type(e).__name__ + '). Review remote state before retry; no automatic recovery.'); raise SystemExit(1)
