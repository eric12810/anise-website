import importlib.util
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('staging_deploy', ROOT / 'scripts/website-staging-deploy.py')
staging_deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(staging_deploy)


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            source = dict(attrs).get('src')
            if source:
                self.sources.append(source)


class CheckoutAssetTests(unittest.TestCase):
    def test_checkout_scripts_are_in_staging_package(self):
        approved = set(staging_deploy.approved_files())
        for page in ('order.html', 'order-status.html', 'stripe-cancelled.html'):
            parser = Scripts()
            parser.feed((ROOT / page).read_text())
            for source in parser.sources:
                url = urlsplit(source)
                if url.scheme or url.netloc:
                    continue
                with self.subTest(page=page, script=source):
                    self.assertIn(url.path.lstrip('/'), approved)


if __name__ == '__main__':
    unittest.main()
