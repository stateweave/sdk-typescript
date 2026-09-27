import hashlib
import json
import os
import re
import unittest
from pathlib import Path

HERE = Path(__file__).parent
DATA = Path(os.environ['NATIVE_RECALL_COHORT_DIR'])

def norm(value):
    return re.sub(r'_abs(?=_|$)', '', value.removeprefix('answer_'))

class ProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((HERE / 'cohort-manifest.json').read_text())
        cls.gold = {split: json.loads((DATA / (split + '-gold.json')).read_text()) for split in ['development', 'holdout']}

    def test_fixed_counts_and_gold_hashes(self):
        self.assertEqual(len(self.gold['development']), 28)
        self.assertEqual(len(self.gold['holdout']), 196)
        for split in self.gold:
            self.assertEqual(hashlib.sha256((DATA / (split + '-gold.json')).read_bytes()).hexdigest(), self.manifest[split + 'GoldSha256'])

    def test_all_participants_match_sealed_bytes_and_schema(self):
        self.assertEqual(len(self.manifest['files']), 224)
        for relative, expected in self.manifest['files'].items():
            data = (DATA / relative).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), expected)
            row = json.loads(data)
            self.assertEqual(set(row), {'id', 'question', 'date', 'sources'})
            self.assertRegex(row['id'], r'^c_[a-f0-9]{16}$')
            self.assertTrue(row['sources'])
            for source in row['sources']:
                self.assertEqual(set(source), {'id', 'text'})
                self.assertRegex(source['id'], r'^s_[a-f0-9]{20}$')
                self.assertIsInstance(source['text'], str)

    def test_answer_sources_are_disjoint_even_from_other_case_distractors(self):
        owners = {}
        for rows in self.gold.values():
            for row in rows:
                expected = set(row['answerSources'])
                for original, opaque in row['originalSourceMap'].items():
                    if opaque in expected:
                        self.assertNotIn(norm(original), owners)
                        owners[norm(original)] = row['id']
        for rows in self.gold.values():
            for row in rows:
                for original in row['originalSourceMap']:
                    self.assertIn(owners.get(norm(original)), [None, row['id']])

    def test_prior_question_and_answer_families_are_excluded(self):
        exclusions = json.loads((HERE / 'prior-exclusions.json').read_text())
        for rows in self.gold.values():
            for row in rows:
                self.assertNotIn(row['originalId'].replace('_abs', ''), exclusions['excludedQuestionFamilies'])
                self.assertTrue(set(map(norm, row['originalSourceMap'])).isdisjoint(exclusions['excludedSourceFamilies']))

    def test_every_own_supporting_source_is_retained(self):
        for split, rows in self.gold.items():
            for row in rows:
                participant = json.loads((DATA / split / (row['id'] + '.json')).read_text())
                self.assertTrue(set(row['answerSources']) <= {source['id'] for source in participant['sources']})

    def test_development_transport_never_opens_heldout_gold(self):
        source = (HERE / 'develop.mjs').read_text()
        self.assertNotIn('holdout-gold', source)
        self.assertNotIn('development-gold', source)
        self.assertIn("path.basename(cohort) !== 'development'", source)
        self.assertIn('Existing attempt: no automatic replay', source)
        self.assertIn("redirect: 'error'", source)
        self.assertIn('nonTextBlocksOmitted', source)

if __name__ == '__main__':
    unittest.main()
