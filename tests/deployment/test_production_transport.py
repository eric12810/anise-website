import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import production_transport as t

class FTP:
    def __init__(self):
        self.files = {'index.html': b'old'}
        self.files[t.MANIFEST] = json.dumps({'version': 1, 'files': {'index.html': hashlib.sha256(b'old').hexdigest()}}).encode()
        self.writes = []
    def connect(self, *a): pass
    def auth(self): pass
    def login(self, *a): pass
    def prot_p(self): pass
    def cwd(self, *a): pass
    def pwd(self): return '/livesiteftp/wwwroot'
    def nlst(self): return list(self.files)
    def close(self): pass
    def retrbinary(self, command, callback):
        if command[5:] not in self.files: raise t.ftplib.error_perm('550 missing')
        callback(self.files[command[5:]])
    def rename(self, old, new):
        self.writes.append((old, new)); self.files[new] = self.files.pop(old)

class Tests(unittest.TestCase):
    def setUp(self):
        self.ftp = FTP()
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.bundle = Path(self.tmp.name); (self.bundle/'index.html').write_bytes(b'new')
        self.files = {'index.html': hashlib.sha256(b'new').hexdigest()}
    def upload(self, host, user, password, root, name, local):
        self.ftp.writes.append(name); self.ftp.files[name] = Path(local).read_bytes()
    def run_mode(self, mode):
        with patch.object(t.ftplib, 'FTP_TLS', return_value=self.ftp), patch.object(t, 'curl_upload', side_effect=self.upload), patch.object(t, 'health'):
            t.operate('host', 'livesiteftp', 'password', '/livesiteftp/wwwroot', self.bundle, self.files, mode)
    def test_check_no_writes(self):
        self.run_mode('check'); self.assertEqual([], self.ftp.writes)
    def test_incremental_and_manifest(self):
        self.run_mode('deploy')
        self.assertEqual(self.files, json.loads(self.ftp.files[t.MANIFEST])['files'])
        self.ftp.writes.clear(); self.run_mode('deploy')
        self.assertNotIn('index.html', self.ftp.writes)
    def test_partial_and_missing_manifest_block(self):
        for kind in ('missing', 'corrupt', 'pending', 'mismatch'):
            self.ftp = FTP()
            if kind == 'missing': del self.ftp.files[t.MANIFEST]
            if kind == 'corrupt': self.ftp.files[t.MANIFEST] = b'bad'
            if kind == 'pending': self.ftp.files[t.PENDING] = b'pending'
            if kind == 'mismatch': self.ftp.files['index.html'] = b'partial'
            with self.subTest(kind=kind), self.assertRaises(RuntimeError): self.run_mode('deploy')
            self.assertEqual([], self.ftp.writes)
    def test_connection_timeout_and_wrong_root(self):
        self.ftp.connect = Mock(side_effect=TimeoutError())
        with self.assertRaises(TimeoutError): self.run_mode('check')
        self.ftp = FTP(); self.ftp.pwd = lambda: '/stagesiteftp/wwwroot'
        with self.assertRaises(RuntimeError): self.run_mode('deploy')
        self.assertEqual([], self.ftp.writes)
    def test_upload_failure_and_hash_mismatch_leave_pending(self):
        original = self.upload
        for mismatch in (False, True):
            self.ftp = FTP()
            def fail(*args):
                if args[4] == 'index.html':
                    if not mismatch: raise TimeoutError()
                    return
                original(*args)
            self.upload = fail
            with self.assertRaises((RuntimeError, TimeoutError)): self.run_mode('deploy')
            self.assertIn(t.PENDING, self.ftp.files)
            self.assertNotEqual(self.files, json.loads(self.ftp.files[t.MANIFEST])['files'])
    def test_manifest_rename_failure(self):
        self.ftp.rename = Mock(side_effect=OSError())
        with self.assertRaises(OSError): self.run_mode('deploy')
        self.assertIn(t.PENDING, self.ftp.files)
    def test_protected_files(self):
        for name in ('web.config', 'appsettings.json', 'data/key.js', '../index.html', '.env', 'public/web.config'):
            self.assertFalse(t.safe_file(name))
    def test_curl_path_tls_and_credentials(self):
        with patch.object(t.subprocess, 'run', return_value=Mock(returncode=0)) as run:
            t.curl_upload('host', 'user', 'private', '/livesiteftp/wwwroot', 'index.html', self.bundle/'index.html')
            args, kwargs = run.call_args
            self.assertEqual('ftp://host:21//livesiteftp/wwwroot/index.html', args[0][-1])
            self.assertIn('--ssl-reqd', args[0]); self.assertNotIn('private', ' '.join(args[0]))
            self.assertIn('private', kwargs['input'])
        with patch.object(t.subprocess, 'run', return_value=Mock(returncode=28)):
            with self.assertRaises(RuntimeError): t.curl_upload('host', 'u', 'p', '/root', 'index.html', 'local')
    def test_missing_manifest_always_blocks_check_and_deploy(self):
        self.ftp = FTP(); del self.ftp.files[t.MANIFEST]
        for mode in ('check', 'deploy'):
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, 'needs review'):
                self.run_mode(mode)
            self.assertEqual([], self.ftp.writes)

    def test_transport_accepts_only_check_and_deploy_modes(self):
        with self.assertRaises(ValueError):
            t.operate('host', 'livesiteftp', 'password', '/livesiteftp/wwwroot', self.bundle, self.files, 'bootstrap')
