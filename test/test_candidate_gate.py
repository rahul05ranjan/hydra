import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'train/kaggle'))
from candidate_eval import sealed_gate


class CandidateGateTests(unittest.TestCase):
    def setUp(self):
        self.plan = {'sealedMinimumDevelopmentSolved': 0.95, 'includeExtendedDevelopment': True}
        self.results = {'candidate-q8-development': {'tasks': 200, 'solved': 0.98},
                        'candidate-q8-extended-development': {'tasks': 800, 'solved': 0.95}}

    def test_every_requested_development_set_must_pass(self):
        self.assertIsNone(sealed_gate(self.plan, self.results, 'candidate-q8'))
        self.results['candidate-q8-extended-development']['solved'] = 0.94
        self.assertEqual(sealed_gate(self.plan, self.results, 'candidate-q8')['reason'], 'Development gate not met')

    def test_partial_or_missing_results_do_not_enable_sealed_evaluation(self):
        for result in ({'tasks': 799, 'solved': 1}, {}):
            self.results['candidate-q8-extended-development'] = result
            with self.assertRaises(ValueError): sealed_gate(self.plan, self.results, 'candidate-q8')

    def test_invalid_thresholds_are_rejected(self):
        for threshold in (True, float('nan'), -0.1, 1.1, '0.95'):
            self.plan['sealedMinimumDevelopmentSolved'] = threshold
            with self.assertRaises(ValueError): sealed_gate(self.plan, self.results, 'candidate-q8')

    def test_existing_ungated_plans_retain_their_behavior(self):
        self.assertIsNone(sealed_gate({}, {}, 'candidate-q8'))


if __name__ == '__main__': unittest.main()
