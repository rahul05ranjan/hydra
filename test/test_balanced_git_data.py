"""Guard the probe/evidence coverage omitted by the feasibility corpus."""
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'train'))
from full_finetune import load_examples


class BalancedGitDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows, cls.manifest = load_examples(ROOT / 'train/data-balanced-git/train.jsonl',
                                              ROOT / 'train/data-balanced-git/manifest.json', 'git')

    def test_previously_forgotten_probes_and_evidence_are_covered(self):
        probes = {json.loads(row['messages'][-1]['content'])['probes'][0]['probe']
                  for row in self.rows if 'probes' in json.loads(row['messages'][-1]['content'])}
        self.assertEqual(probes, {'status', 'log', 'diff', 'show', 'blame', 'branches',
                                 'remotes', 'stash', 'tags', 'worktrees'})
        self.assertTrue(any('lines' in json.loads(row['messages'][-1]['content']) for row in self.rows))
        self.assertFalse(self.manifest['developmentInputsUsed'])

    def test_arguments_are_grounded_in_questions_and_evidence_is_complete(self):
        for row in self.rows:
            target = json.loads(row['messages'][-1]['content'])
            question = row['messages'][1]['content']
            for probe in target.get('probes', []):
                for key in ('path', 'base', 'rev', 'author', 'grep'):
                    if key in probe:
                        self.assertIn(str(probe[key]), question)
            if row['intent'] in ('evidence_branch_files', 'evidence_commit_files'):
                expected = [int(number) for number, text in re.findall(r'^\[(\d+)\] (.*)$', question, re.M)
                            if re.search(r'\|\s*\d+\s*[+-]+$', text)]
                self.assertEqual(target['lines'], expected)
                self.assertEqual(len(expected), 2)

    def test_evidence_labels_do_not_learn_one_fixed_position(self):
        for intent in ('evidence_branch_files', 'evidence_commit_files', 'evidence_patch', 'evidence_attribution'):
            positions = {tuple(json.loads(row['messages'][-1]['content'])['lines'])
                         for row in self.rows if row['intent'] == intent}
            self.assertGreaterEqual(len(positions), 8)


if __name__ == '__main__':
    unittest.main()
