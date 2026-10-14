"""Files corpus generation/gold tests; never invokes a model or head."""
import copy
import json
from pathlib import Path
import unittest

import build_files_quality as corpus


class FilesQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = json.loads((corpus.ROOT / 'evals/suite/source-inventory.json').read_bytes())
        cls.tasks = corpus.build(cls.inventory)

    def test_authentic_gold_and_independent_coverage(self):
        summary = corpus.validate(self.inventory, self.tasks)
        self.assertEqual(summary['development']['tasks'], 200)
        self.assertEqual(summary['holdout']['tasks'], 1000)
        self.assertEqual(summary['development']['sourceModules'], 160)
        self.assertGreaterEqual(summary['holdout']['sourceModules'], 790)
        source_sets = [{reference['source'] for task in tasks for reference in task['sourceFiles'].values()}
                       for tasks in self.tasks.values()]
        self.assertFalse(source_sets[0] & source_sets[1])
        symbols = [task['sourceSymbol'] for tasks in self.tasks.values() for task in tasks if task['sourceFiles']]
        self.assertEqual(len(symbols), len(set(symbols)))

    def test_gold_edit_is_rejected(self):
        altered = copy.deepcopy(self.tasks)
        altered['development'][0]['gold']['targetDefLine'] += ' fabricated'
        with self.assertRaisesRegex(ValueError, 'authentic source line'):
            corpus.validate(self.inventory, altered)

    def test_empty_search_must_be_empty(self):
        altered = copy.deepcopy(self.tasks)
        task = next(task for task in altered['development'] if task['family'] == 'search/empty')
        task['files']['README.md'] += task['gold']['expectedTerms'][0]
        with self.assertRaisesRegex(ValueError, 'Nonempty empty-result gold'):
            corpus.validate(self.inventory, altered)

    def test_multiple_term_gold_checks_each_named_symbol(self):
        for split, tasks in self.tasks.items():
            multiple = [task for task in tasks if task['family'] == 'search/multiple']
            self.assertEqual(len(multiple), corpus.SIZES[split][1])
            for task in multiple:
                self.assertEqual(len(task['gold']['expectedTerms']), 2)
                self.assertEqual(len(task['gold']['requiredText']), 2)
                for term in task['gold']['expectedTerms']:
                    self.assertTrue(any(term in evidence for evidence in task['gold']['requiredText']))

    def test_saved_tasks_are_exact_rebuild(self):
        for split, rows in self.tasks.items():
            saved = corpus.ROOT / 'evals/suite/quality' / split / 'files.json'
            self.assertEqual(saved.read_bytes(), corpus.json_bytes(rows))
            manifest = json.loads(saved.with_name('files.manifest.json').read_bytes())
            self.assertEqual(manifest['tasksSha256'], corpus.sha(saved.read_bytes()))
            self.assertEqual(manifest['builderSha256'], corpus.sha(Path(corpus.__file__).read_bytes()))


if __name__ == '__main__': unittest.main()
