import importlib.util, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location('production', Path(__file__).parents[2] / 'scripts/website-production-deploy.py')
production = importlib.util.module_from_spec(spec); spec.loader.exec_module(production)

class ProductionGuardTests(unittest.TestCase):
    def test_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'index.html').write_text('safe')
            (root/'release-manifest.json').write_text(json.dumps({'files': {'index.html': '0'*64}}))
            (root/'staging-deployment-record.json').write_text('{}')
            with self.assertRaises(ValueError): production.verify_bundle(root, '1', 'a'*40)
    def test_missing_approval_is_rejected(self):
        with mock.patch.object(production, 'EXPECTED_HOST', ''), mock.patch.object(production, 'EXPECTED_ROOT', ''):
            with self.assertRaises(ValueError): production.check_settings('example', '/root', False)

    def test_check_mode_verifies_without_connecting(self):
        commit = 'a' * 40
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            content = b'complete release'
            (root / 'index.html').write_bytes(content)
            digest = __import__('hashlib').sha256(content).hexdigest()
            (root / 'release-manifest.json').write_text(json.dumps({'files': {'index.html': digest}}))
            (root / 'staging-deployment-record.json').write_text(json.dumps({'status': 'verified', 'run_id': '42', 'commit_sha': commit, 'artifact_name': 'anise-website-staging-release-' + commit}))
            env = {**os.environ, 'PROD_FTPS_EXPECTED_HOST': 'loveanise.co.uk', 'PROD_FTPS_EXPECTED_ROOT': '/livesiteftp/wwwroot'}
            result = subprocess.run([sys.executable, str(Path(__file__).parents[2] / 'scripts/website-production-deploy.py'), '--bundle', str(root), '--staging-run-id', '42', '--commit-sha', commit, '--host', 'loveanise.co.uk', '--root', '/livesiteftp/wwwroot', '--mode', 'check'], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('CHECK ONLY', result.stdout)

if __name__ == '__main__': unittest.main()
