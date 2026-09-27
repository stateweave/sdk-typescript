import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('summary', Path(__file__).with_name('summarize.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class StatisticsTests(unittest.TestCase):
    def test_set_scoring_and_failure(self):
        self.assertEqual(s.case_score([], []), 1)
        self.assertEqual(s.case_score([], [], False), 0)
        self.assertEqual(s.case_score(['a'], ['a', 'b']), 2/3)
        self.assertEqual(s.case_score(['a'], []), 0)
    def test_student_reference(self):
        t, df = 2.7764451051977987, 4
        self.assertAlmostEqual(s.regularized_beta(df/2, .5, df/(df+t*t)), .05, places=8)
    def test_paired_swap_and_exact_probability(self):
        d = [.5,.5,.5,.5,0,0,0,0]
        result = s.paired_stats(d, [True]*4+[False]*4)
        self.assertEqual(result['primaryOneSidedP'], 1/16)
        self.assertGreater(result['pairedT'], 0)
        reverse = s.paired_stats([-x for x in d], [True]*4+[False]*4)
        self.assertEqual(reverse['primaryOneSidedP'], 1)
        self.assertAlmostEqual(result['pairedT'], -reverse['pairedT'])
    def test_frozen_independent_cases(self):
        import json
        p = Path(__file__).parent
        cases = json.loads((p/'cases.json').read_text())
        gold = json.loads((p/'private-gold.json').read_text())
        self.assertEqual(len(cases['cases']), 164)
        self.assertEqual(len(cases['memories']), 300)
        seen = set()
        for case in gold['cases']:
            self.assertFalse(seen & set(case['clusterDocuments']))
            seen.update(case['clusterDocuments'])
        self.assertEqual(sum(bool(x['review']) for x in gold['cases']), 62)
        self.assertEqual(sum(len(x['review']) for x in gold['cases']), 64)
        for case in cases['cases']:
            self.assertEqual(set(case), {'id','source','rotation'})
        for memory in cases['memories']:
            self.assertEqual(set(memory), {'id','text'})

if __name__ == '__main__':
    unittest.main()
