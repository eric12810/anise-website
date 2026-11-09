import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[2]
SCRIPT = ROOT / 'scripts/resolve-staging-release.py'

class ReleaseResolutionTests(unittest.TestCase):
    def run_resolver(self, **values):
        env = {'PATH': os.environ.get('PATH', ''), **values}
        with tempfile.TemporaryDirectory() as d:
            env['GITHUB_OUTPUT'] = str(Path(d) / 'out')
            return subprocess.run([sys.executable, str(SCRIPT)], env=env, text=True, capture_output=True)

    def test_invalid_run_id_is_rejected_before_api_access(self):
        result = self.run_resolver(GITHUB_REPOSITORY='eric12810/anise-website', GITHUB_TOKEN='x', STAGING_RUN_ID='not-a-number')
        self.assertNotEqual(result.returncode, 0)

    def test_missing_repository_context_is_rejected(self):
        result = self.run_resolver(STAGING_RUN_ID='123')
        self.assertNotEqual(result.returncode, 0)

if __name__ == '__main__':
    unittest.main()
