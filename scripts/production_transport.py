"""Production FTPS transport and fail-closed incremental release state."""
import ftplib
import hashlib
import json
import os
import re
import ssl
import subprocess
import tempfile
import uuid
from pathlib import PurePosixPath
from urllib.parse import quote
from urllib.request import urlopen

MANIFEST = '.anise-production-deployment.json'
PENDING = MANIFEST + '.pending'
STAGE = 'offline validation'

def stage(label):
    global STAGE
    STAGE = label
    print('Stage: ' + label, flush=True)

def safe_file(name):
    p = PurePosixPath(name)
    return (isinstance(name, str) and bool(re.fullmatch(r'[A-Za-z0-9_./-]+', name))
            and not p.is_absolute() and '..' not in p.parts
            and not any(x.startswith('.') for x in p.parts)
            and not any(x.lower() in {'web.config', 'data', 'app_data', 'logs', 'secrets'}
                        or x.lower().startswith('appsettings') for x in p.parts)
            and p.suffix.lower() in {'.html', '.css', '.js', '.ashx', '.svg', '.png',
                '.webp', '.jpg', '.jpeg', '.mp4', '.eot', '.ttf', '.woff', '.woff2'})

def curl_upload(host, username, password, root, name, local):
    # A leading // in an FTP URL means an absolute server path, not login-relative.
    # Use precisely the path verified by FTP PWD; never strip the account prefix.
    credentials = (username + ':' + password).replace('\\', '\\\\').replace('"', '\\"').replace('\r', '\\r').replace('\n', '\\n')
    result = subprocess.run([
        'curl', '--silent', '--show-error', '--fail', '--ssl-reqd',
        '--ftp-pasv', '--ftp-skip-pasv-ip', '--connect-timeout', '30',
        '--max-time', '180', '--config', '-', '--upload-file', str(local),
        'ftp://' + host + ':21/' + quote(root + '/' + name, safe='/'),
    ], input='user = "' + credentials + '"\n', text=True, capture_output=True, timeout=195)
    if result.returncode:
        raise RuntimeError('Encrypted upload failed; curl code ' + str(result.returncode))

def read_bytes(ftp, name):
    chunks = []
    ftp.retrbinary('RETR ' + name, chunks.append)
    return b''.join(chunks)

def remote_hash(ftp, name):
    digest = hashlib.sha256()
    ftp.retrbinary('RETR ' + name, digest.update)
    return digest.hexdigest()

def inventory(ftp, files):
    names = {PurePosixPath(n).name for n in ftp.nlst()}
    issues = []
    previous = {}
    if PENDING in names:
        issues.append('Incomplete deployment marker present')
    if MANIFEST not in names:
        issues.append('No trusted production manifest: existing installation requires review and baseline recovery')
    else:
        try:
            payload = json.loads(read_bytes(ftp, MANIFEST))
            previous = payload['files']
            if payload['version'] != 1 or not isinstance(previous, dict) or not previous:
                raise ValueError()
            if not all(safe_file(n) and isinstance(h, str) and re.fullmatch('[0-9a-f]{64}', h)
                       for n, h in previous.items()):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            previous = {}
            issues.append('Corrupt production manifest requires recovery')
    actual = {}
    for name in sorted(set(files) | set(previous)):
        stage('inspect remote hash: ' + name)
        try:
            actual[name] = remote_hash(ftp, name)
        except ftplib.error_perm as error:
            if not str(error).startswith('550'):
                raise
            actual[name] = None
            print('Missing or unreadable file: ' + name)
        if name in previous and actual[name] != previous[name]:
            issues.append('Baseline mismatch: ' + name)
    changed = [n for n, h in files.items() if actual[n] != h]
    removed = sorted(set(previous) - set(files))
    for name in removed:
        print('Preserved obsolete application file: ' + name)
    print(f'Plan: {len(changed)} upload; {len(files)-len(changed)} unchanged; {len(removed)} obsolete preserved')
    for issue in issues:
        print('REVIEW REQUIRED: ' + issue)
    return changed, issues

def bootstrap_baseline(ftp, root, owner_confirmation, backup_confirmation, backup_reference):
    """Record an independently inspected live baseline; never uploads release files."""
    if owner_confirmation != 'ESTABLISH PRODUCTION BASELINE':
        raise RuntimeError('Owner baseline confirmation is required')
    if backup_confirmation != 'BACKUP CONFIRMED' or not backup_reference.strip():
        raise RuntimeError('Verified backup confirmation and reference are required')
    names = sorted({PurePosixPath(n).name for n in ftp.nlst() if safe_file(PurePosixPath(n).name)})
    baseline = {}
    for name in names:
        stage('bootstrap hash: ' + name)
        try:
            baseline[name] = remote_hash(ftp, name)
        except ftplib.error_perm as error:
            if not str(error).startswith('550'):
                raise
            print('Skipped unreadable live file: ' + name)
    if not baseline:
        raise RuntimeError('No readable live files found; baseline not established')
    payload = json.dumps({'version': 1, 'status': 'baseline', 'backup_reference': backup_reference.strip(), 'files': baseline}, sort_keys=True).encode()
    with tempfile.NamedTemporaryFile() as local:
        local.write(payload); local.flush()
        curl_upload(os.environ['PROD_FTPS_HOST'], os.environ['PROD_FTPS_USERNAME'], os.environ['PROD_FTPS_PASSWORD'], root, MANIFEST, local.name)
    if remote_hash(ftp, MANIFEST) != hashlib.sha256(payload).hexdigest():
        raise RuntimeError('Baseline manifest verification failed')
    print(f'BASELINE ESTABLISHED: {len(baseline)} existing files recorded; no release files uploaded')

def health():
    stage('verify production HTTP health')
    for path in ('/', '/menu', '/order'):
        with urlopen('https://www.loveanise.co.uk' + path, timeout=30) as response:
            if response.status != 200 or not response.read(1024) or not response.url.startswith('https://www.loveanise.co.uk/'):
                raise RuntimeError('Website health verification failed')

def operate(host, username, password, root, bundle, files, mode, owner_confirmation='', backup_confirmation='', backup_reference=''):
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=60)
    try:
        stage('connect to production FTPS'); ftp.connect(host, 21)
        stage('negotiate TLS'); ftp.auth()
        stage('authenticate'); ftp.login(username, password)
        stage('enable encrypted data connections'); ftp.prot_p()
        stage('select approved production root'); ftp.cwd(root)
        stage('verify remote directory')
        if ftp.pwd() != root:
            raise RuntimeError('Server root differs from approved root')
        if mode == 'bootstrap':
            if MANIFEST in {PurePosixPath(n).name for n in ftp.nlst()} or PENDING in {PurePosixPath(n).name for n in ftp.nlst()}:
                raise RuntimeError('A production manifest or pending marker already exists; bootstrap is only for first deployment')
            bootstrap_baseline(ftp, root, owner_confirmation, backup_confirmation, backup_reference)
            return
        changed, issues = inventory(ftp, files)
        if issues:
            raise RuntimeError('Remote state needs review; no writes permitted')
        if mode == 'check':
            print('CHECK PASSED: offline and remote verification passed; no files written')
            return
        # Preserve an interruption marker until every transfer and HTTP check succeeds.
        def write(name, content):
            with tempfile.NamedTemporaryFile() as local:
                local.write(content); local.flush()
                curl_upload(host, username, password, root, name, local.name)
            if remote_hash(ftp, name) != hashlib.sha256(content).hexdigest():
                raise RuntimeError('Metadata verification failed')
        stage('mark deployment pending')
        write(PENDING, b'{"status":"incomplete"}')
        for index, name in enumerate(changed, 1):
            stage(f'upload {index}/{len(changed)}: {name}')
            ftp.cwd(root)
            for part in PurePosixPath(name).parent.parts:
                entries = {PurePosixPath(n).name for n in ftp.nlst()}
                if part not in entries: ftp.mkd(part)
                ftp.cwd(part)
            curl_upload(host, username, password, root, name, bundle / name)
            ftp.cwd(root)
            stage('verify uploaded hash: ' + name)
            if remote_hash(ftp, name) != files[name]:
                raise RuntimeError('Uploaded SHA-256 mismatch')
        health()
        stage('publish successful production manifest')
        write(PENDING, json.dumps({'version': 1, 'files': files}, sort_keys=True).encode())
        # Keep old successful manifest permanently; never delete remote files.
        ftp.rename(MANIFEST, MANIFEST + '.previous-' + uuid.uuid4().hex)
        ftp.rename(PENDING, MANIFEST)
        stage('complete deployment')
        print(f'SUCCESS: {len(changed)} uploaded and verified; {len(files)-len(changed)} unchanged')
    finally:
        ftp.close()
