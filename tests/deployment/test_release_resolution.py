import os
import json
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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

    def test_surrounding_whitespace_in_run_id_is_accepted(self):
        sha = 'a' * 40
        responses = [
            {'repository': {'full_name': 'eric12810/anise-website'}, 'head_branch': 'staging',
             'status': 'completed', 'conclusion': 'success', 'workflow_id': 1, 'head_sha': sha},
            {'path': '.github/workflows/staging-preview.yml', 'name': 'Staging file preview'},
            {'artifacts': [{'name': 'anise-website-staging-release-' + sha, 'expired': False}]},
        ]
        class Response:
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps(self.payload).encode()
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / 'out'
            env = {'GITHUB_REPOSITORY': 'eric12810/anise-website', 'GITHUB_TOKEN': 'test',
                   'STAGING_RUN_ID': '  44650470277  ', 'GITHUB_OUTPUT': str(output)}
            with mock.patch.dict(os.environ, env), mock.patch('urllib.request.urlopen', side_effect=[Response(x) for x in responses]):
                runpy.run_path(str(SCRIPT))
            self.assertIn('commit_sha=' + sha, output.read_text())

if __name__ == '__main__':
    unittest.main()
