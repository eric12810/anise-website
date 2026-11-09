import importlib.util, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))

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
            with self.assertRaisesRegex(ValueError, 'host/root secrets'):
                production.check_settings('example', '/root', False)

    def test_shared_server_with_separate_production_account_is_allowed(self):
        with mock.patch.object(production, 'EXPECTED_HOST', 'wsuk32.pronameserver.com'), mock.patch.object(production, 'EXPECTED_ROOT', '/livesiteftp/wwwroot'), mock.patch.dict(os.environ, {'PROD_FTPS_USERNAME': 'livesiteftp', 'STAGING_FTPS_HOST': 'wsuk32.pronameserver.com'}):
            production.check_settings('wsuk32.pronameserver.com', '/livesiteftp/wwwroot', False)

    def test_staging_root_and_wrong_root_are_rejected(self):
        with mock.patch.object(production, 'EXPECTED_HOST', 'wsuk32.pronameserver.com'), mock.patch.object(production, 'EXPECTED_ROOT', '/livesiteftp/wwwroot'), mock.patch.dict(os.environ, {'PROD_FTPS_USERNAME': 'livesiteftp', 'STAGING_FTPS_HOST': 'wsuk32.pronameserver.com'}):
            with self.assertRaises(ValueError): production.check_settings('wsuk32.pronameserver.com', '/stagesiteftp/wwwroot', False)
            with self.assertRaises(ValueError): production.check_settings('wsuk32.pronameserver.com', '/wrong', False)

    def test_workflow_uses_live_secrets(self):
        workflow = (Path(__file__).parents[2] / '.github/workflows/production-release.yml').read_text()
        for name in ('LIVE_FTPS_HOST', 'LIVE_FTPS_ROOT', 'LIVE_FTPS_USERNAME', 'LIVE_FTPS_PASSWORD'):
            self.assertIn('${{ secrets.' + name + ' }}', workflow)
        self.assertNotIn('vars.PROD_FTPS_HOST', workflow)
        self.assertNotIn('vars.PROD_FTPS_ROOT', workflow)

    def test_check_mode_verifies_without_connecting(self):
        commit = 'a' * 40
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            content = b'complete release'
            (root / 'index.html').write_bytes(content)
            digest = __import__('hashlib').sha256(content).hexdigest()
            (root / 'release-manifest.json').write_text(json.dumps({'files': {'index.html': digest}}))
            (root / 'staging-deployment-record.json').write_text(json.dumps({'status': 'verified', 'run_id': '42', 'commit_sha': commit, 'artifact_name': 'anise-website-staging-release-' + commit}))
            env = {**os.environ, 'PROD_FTPS_EXPECTED_HOST': 'loveanise.co.uk', 'PROD_FTPS_EXPECTED_ROOT': '/livesiteftp/wwwroot', 'PROD_FTPS_USERNAME': 'livesiteftp'}
            # Remote check behavior is tested with a fake FTP server separately.
            with mock.patch.object(production, 'EXPECTED_HOST', 'loveanise.co.uk'), mock.patch.object(production, 'EXPECTED_ROOT', '/livesiteftp/wwwroot'), mock.patch.dict(os.environ, env):
                production.check_settings('loveanise.co.uk', '/livesiteftp/wwwroot', False)
                self.assertEqual({'index.html': digest}, production.verify_bundle(root, '42', commit))

if __name__ == '__main__': unittest.main()
