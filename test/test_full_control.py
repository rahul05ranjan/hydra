"""Submission must not accept Kaggle's previously ready input version."""
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'train/kaggle'))
import full_control


class FakeKaggle:
    def __init__(self, plan, status='ready', version=4):
        self.plan, self.status, self.version = plan, status, version
        self.downloads = []

    def dataset_status(self, dataset, format):
        return json.dumps({'status': self.status, 'current_version_number': self.version})

    def dataset_download_file(self, dataset, file_name, path, force, quiet):
        self.downloads.append(dataset)
        (Path(path) / file_name).write_bytes(self.plan)


class RemotePlanTests(unittest.TestCase):
    def test_previously_ready_version_is_rejected(self):
        api = FakeKaggle(b'previous plan', version=3)
        expected = hashlib.sha256(b'approved plan').hexdigest()
        with self.assertRaisesRegex(ValueError, 'approved frozen plan'):
            full_control.verified_dataset_source(api, 'owner/input', expected)
        self.assertEqual(api.downloads, ['owner/input/3'])

    def test_verified_plan_returns_immutable_source(self):
        api = FakeKaggle(b'approved plan')
        expected = hashlib.sha256(api.plan).hexdigest()
        self.assertEqual(full_control.verified_dataset_source(api, 'owner/input', expected), 'owner/input/4')

    def test_processing_version_is_rejected_without_download(self):
        api = FakeKaggle(b'approved plan', status='processing')
        with self.assertRaisesRegex(ValueError, 'not ready'):
            full_control.verified_dataset_source(api, 'owner/input', 'unused')
        self.assertEqual(api.downloads, [])


if __name__ == '__main__':
    unittest.main()
