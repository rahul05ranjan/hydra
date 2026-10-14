import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'train'))
from cloudflare_dev import configuration, load_request, request_json, ROOT


class CloudflareDevelopmentTests(unittest.TestCase):
    def test_missing_names_without_network_or_secret_echo(self):
        config = configuration({})
        self.assertEqual(config['missing'], ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'])
        with patch('urllib.request.urlopen') as remote:
            with self.assertRaises(ValueError): request_json(config, [])
            remote.assert_not_called()

    def test_default_cloudflare_endpoint_and_model(self):
        config = configuration({'CLOUDFLARE_ACCOUNT_ID': 'a' * 32, 'CLOUDFLARE_API_TOKEN': 'private-value'})
        self.assertTrue(config['base'].endswith('/accounts/' + 'a' * 32 + '/ai/v1'))
        self.assertEqual(config['model'], '@cf/zai-org/glm-5.3')

    def test_endpoint_and_token_validation(self):
        for base in ('http://api.cloudflare.com/ai/v1', 'https://other.example/v1', 'https://user:secret@api.cloudflare.com/v1', 'https://api.cloudflare.com/v1?token=private'):
            with self.assertRaises(ValueError): configuration({'CLOUDFLARE_DEVELOPMENT_BASE_URL': base})
        with self.assertRaisesRegex(ValueError, 'single-line'):
            configuration({'CLOUDFLARE_API_TOKEN': 'private\nvalue'})

    def test_secret_and_heldout_paths_are_rejected_before_reading(self):
        for name in (ROOT / '.env', ROOT / 'evals/git1/tasks.jsonl', ROOT / 'evals/suite/quality/holdout/files.json'):
            with self.assertRaises(ValueError): load_request(name)

    def test_input_budget_and_roles_are_validated(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'request.json'
            for messages in ([{'role': 'tool', 'content': 'data'}], [{'role': 'user', 'content': 'x' * 64001}]):
                file.write_text(json.dumps({'messages': messages}))
                with self.assertRaises(ValueError): load_request(file)


if __name__ == '__main__': unittest.main()
