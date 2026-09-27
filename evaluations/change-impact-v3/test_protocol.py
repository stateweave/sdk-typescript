import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('summary_v2', HERE/'summarize.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class ProtocolTests(unittest.TestCase):
    def test_external_split_disjointness_and_fixed_count(self):
        cases = json.loads((HERE/'cases.json').read_text())
        gold = json.loads((HERE/'private-gold.json').read_text())
        prior = json.loads((HERE.parent/'change-impact-v1/cases.json').read_text())
        self.assertEqual(len(cases['cases']),128)
        self.assertEqual(len(cases['memories']),300)
        self.assertFalse({r['text'].lower() for r in prior['memories']} & {r['text'].lower() for r in cases['memories']})
        self.assertEqual(sum(bool(r['review']) for r in gold['cases']),51)
        self.assertEqual(sum(len(r['review']) for r in gold['cases']),55)
        seen = set(gold['excludedDevelopmentDocuments'])
        for row in gold['cases']:
            self.assertFalse(seen & set(row['clusterDocuments']))
            seen.update(row['clusterDocuments'])
        self.assertEqual(hashlib.sha256((HERE/'private-gold.json').read_bytes()).hexdigest(),(HERE/'gold.sha256').read_text().strip())
        for row in cases['cases']: self.assertEqual(set(row),{'id','source','rotation'})
        for row in cases['memories']: self.assertEqual(set(row),{'id','text'})
    def test_operational_repeat_preserves_data_and_semantic_runner(self):
        prior = HERE.parent/'change-impact-v2'
        for name in ['cases.json','private-gold.json','gold.sha256','prepare.py','summarize.py']:
            self.assertEqual((HERE/name).read_bytes(),(prior/name).read_bytes(),name)
        self.assertEqual((HERE/'run.mjs').read_text(),(prior/'run.mjs').read_text().replace('Array.from({ length: 4 },','Array.from({ length: 2 },'))
    def test_score_failure_and_false_alert(self):
        self.assertEqual(s.case_score([],[],False),0)
        self.assertEqual(s.case_score([],[]),1)
        self.assertEqual(s.case_score([],['a']),0)
        self.assertEqual(s.case_score(['a'],['a','b']),2/3)
    def test_student_and_exact_sign_reference(self):
        t,df = 2.7764451051977987,4
        self.assertAlmostEqual(s.regularized_beta(df/2,.5,df/(df+t*t)),.05,places=8)
        result = s.paired_stats([.5]*4+[0]*4,[True]*4+[False]*4)
        self.assertEqual(result['primaryOneSidedP'],1/16)
        self.assertGreater(result['pairedT'],0)

if __name__=='__main__': unittest.main()
