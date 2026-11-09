import importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location('production', Path(__file__).parents[2] / 'scripts/website-production-deploy.py')
production = importlib.util.module_from_spec(spec); spec.loader.exec_module(production)

class ProductionGuardTests(unittest.TestCase):
    def test_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'index.html').write_text('safe')
            (root/'release-manifest.json').write_text(json.dumps({'files': {'index.html': '0'*64}}))
            with self.assertRaises(ValueError): production.verify_bundle(root)
    def test_missing_approval_is_rejected(self):
        with mock.patch.object(production, 'EXPECTED_HOST', ''), mock.patch.object(production, 'EXPECTED_ROOT', ''):
            with self.assertRaises(ValueError): production.check_settings('example', '/root')

if __name__ == '__main__': unittest.main()
