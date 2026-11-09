#!/usr/bin/env python3
"""Incremental, allowlisted FTPS upload for the Anise WEBSITE staging site only.

The manifest records hashes only after every selected upload succeeds.
The first run without a manifest is deliberately a full, one-time upload.
Remote website files are never deleted by this script.
"""
import argparse
import ftplib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import ssl
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HOST = "wsuk32.pronameserver.com"
USERNAME = "stagesiteftp"
TARGET = "/stagesiteftp/wwwroot"
CURL_ROOT = "/wwwroot"
MANIFEST = ".anise-staging-deployment.json"
MANIFEST_VERSION = 1
ROOT_FILES = """index.html menu.html order.html order-status.html philosophy.html
creations.html vegan.html stripe-cancelled.html styles.css creations-hero-carousel.css
menu-live.js order.css order.js order-status.js ordering-status.js plum-background.js
promotion-cookie.js promotions-display.js stripe-resume.js dish-thumbnail.ashx""".split()
PUBLIC_EXTENSIONS = {".svg", ".png", ".webp", ".jpg", ".jpeg", ".mp4",
                     ".eot", ".ttf", ".woff", ".woff2"}
PATH_PATTERN = re.compile(r"[A-Za-z0-9_./-]+\Z")
HASH_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


def approved_files():
    tracked = set(subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", "-z"], text=True
    ).split("\0"))
    candidates = set(ROOT_FILES)
    candidates.update(
        name for name in tracked
        if name.startswith("public/") and PurePosixPath(name).suffix.lower() in PUBLIC_EXTENSIONS
    )
    for name in sorted(candidates):
        path = PurePosixPath(name)
        local = ROOT.joinpath(*path.parts)
        if (not PATH_PATTERN.fullmatch(name) or path.is_absolute()
                or ".." in path.parts or name not in tracked
                or not local.is_file() or local.is_symlink()
                or any(ROOT.joinpath(*path.parts[:i]).is_symlink()
                       for i in range(1, len(path.parts) + 1))):
            raise RuntimeError("Unsafe, untracked or missing candidate: " + name)
    return sorted(candidates)


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def local_hashes(names):
    return {name: digest(ROOT / name) for name in names}


def read_manifest(ftp):
    chunks = []
    try:
        ftp.retrbinary("RETR " + MANIFEST, chunks.append)
    except ftplib.error_perm as exc:
        if str(exc).startswith("550"):
            print("No previous staging manifest: performing a one-time full upload.", flush=True)
            return {}
        raise
    try:
        payload = json.loads(b"".join(chunks).decode("utf-8"))
        files = payload["files"]
        if (payload.get("version") != MANIFEST_VERSION or not isinstance(files, dict)
                or not all(isinstance(name, str) and PATH_PATTERN.fullmatch(name)
                           and ".." not in PurePosixPath(name).parts
                           and isinstance(sha, str) and HASH_PATTERN.fullmatch(sha)
                           for name, sha in files.items())):
            raise ValueError("Invalid manifest structure")
        print("Loaded prior successful staging deployment manifest.", flush=True)
        return files
    except (ValueError, KeyError, TypeError, UnicodeDecodeError) as exc:
        raise RuntimeError("Remote deployment manifest is invalid; refusing to skip files.") from exc


def curl_upload(local_path, remote_path, password):
    # A temporary config avoids placing credentials directly on the curl command line.
    credentials = USERNAME + ":" + password
    escaped = (credentials.replace("\\", "\\\\").replace('"', '\\"')
               .replace("\r", "\\r").replace("\n", "\\n"))
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as config:
        config.write('user = "' + escaped + '"\n')
        config.flush()
        result = subprocess.run(
            ["curl", "--silent", "--show-error", "--fail", "--ssl-reqd",
             "--ftp-pasv", "--ftp-skip-pasv-ip", "--connect-timeout", "30",
             "--max-time", "180", "--config", config.name, "--upload-file",
             str(local_path), "ftp://" + HOST + ":21" + remote_path],
            capture_output=True, text=True, timeout=195
        )
    if result.returncode:
        # Suppress raw curl errors: some failures may include a URL or credentials.
        raise RuntimeError("FTPS upload failed (curl exit code " + str(result.returncode) + ").")


def ensure_remote_directory(ftp, relative_name):
    ftp.cwd(TARGET)
    for component in PurePosixPath(relative_name).parts[:-1]:
        try:
            ftp.cwd(component)
        except ftplib.error_perm as exc:
            if not str(exc).startswith("550"):
                raise
            ftp.mkd(component)
            ftp.cwd(component)


def publish_manifest(ftp, hashes, password):
    payload = json.dumps(
        {"version": MANIFEST_VERSION, "files": hashes},
        sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    temp_name = MANIFEST + ".pending"
    backup_name = MANIFEST + ".previous"
    with tempfile.NamedTemporaryFile(mode="wb") as local:
        local.write(payload)
        local.flush()
        curl_upload(local.name, CURL_ROOT + "/" + temp_name, password)
    ftp.cwd(TARGET)
    try:
        ftp.rename(temp_name, MANIFEST)
    except ftplib.error_perm:
        # Windows FTP servers can refuse rename-over-existing. Keep a recovery copy.
        try:
            ftp.delete(backup_name)
        except ftplib.error_perm as exc:
            if not str(exc).startswith("550"):
                raise
        ftp.rename(MANIFEST, backup_name)
        try:
            ftp.rename(temp_name, MANIFEST)
        except Exception:
            ftp.rename(backup_name, MANIFEST)
            raise
        ftp.delete(backup_name)


def deploy(names, hashes):
    host = os.environ.get("FTPS_HOST", "")
    username = os.environ.get("FTPS_USERNAME", "")
    password = os.environ.get("FTPS_PASSWORD", "")
    if host.lower() != HOST or username != USERNAME or not password:
        raise RuntimeError("Missing or unexpected staging-only FTPS settings.")
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=120)
    try:
        ftp.connect(HOST, 21)
        ftp.login(USERNAME, password)
        ftp.prot_p()
        ftp.set_pasv(True)
        ftp.use_epsv = False
        ftp.cwd(TARGET)
        if ftp.pwd().rstrip("/") != TARGET:
            raise RuntimeError("Unexpected FTP target; refusing to deploy.")
        previous = read_manifest(ftp)
        changed = [name for name in names if previous.get(name) != hashes[name]]
        unchanged = len(names) - len(changed)
        removed = sorted(set(previous) - set(names))
        print(f"Files: {len(names)} approved; {len(changed)} to upload; "
              f"{unchanged} unchanged (skipped).", flush=True)
        if removed:
            print(f"WARNING: {len(removed)} previously deployed files are no longer "
                  "in the allowlist. No remote files were deleted.", flush=True)
            for name in removed[:30]:
                print("  Preserved remote file:", name, flush=True)
        for number, name in enumerate(changed, 1):
            ensure_remote_directory(ftp, name)
            print(f"Uploading [{number}/{len(changed)}] {name}", flush=True)
            curl_upload(ROOT / name, CURL_ROOT + "/" + name, password)
            received = hashlib.sha256()
            ftp.cwd(TARGET)
            ftp.retrbinary("RETR " + name, received.update)
            if received.hexdigest() != hashes[name]:
                raise RuntimeError("Remote file hash verification failed; staging release is incomplete.")
            print("Uploaded:", name, flush=True)
        # No uploads to commit? The existing manifest already captures success.
        if changed or not previous:
            publish_manifest(ftp, hashes, password)
            print("Deployment manifest updated after successful uploads.", flush=True)
        print(f"SUCCESS: {len(changed)} uploaded, {unchanged} unchanged, "
              f"{len(removed)} preserved (no deletions).", flush=True)
    finally:
        try:
            ftp.quit()
        except (OSError, ftplib.Error):
            ftp.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()
    if args.preview == args.upload:
        parser.error("Choose exactly one of --preview or --upload")
    names = approved_files()
    hashes = local_hashes(names)
    if args.preview:
        for name in names:
            print(hashes[name], name)
        print(f"\n{len(names)} approved staging files. Preview only; no upload.")
    else:
        deploy(names, hashes)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ftplib.Error, subprocess.SubprocessError) as exc:
        print("STAGING DEPLOYMENT FAILED:", str(exc), file=sys.stderr)
        sys.exit(1)
