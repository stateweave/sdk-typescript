import math
import unittest
from paired_stats import paired_stats, exact_p, holm_adjust, regularized_beta
from accounting import usage_record

class StatisticsTests(unittest.TestCase):
    def test_exact_paired_binary_test(self):
        self.assertEqual(exact_p(0, 0), 1)
        self.assertEqual(exact_p(5, 0), .0625)
        self.assertEqual(exact_p(0, 5), .0625)
        self.assertEqual(exact_p(6, 0), .03125)
        self.assertEqual(exact_p(4, 4), 1)

    def test_holm_is_monotone_and_caps_at_one(self):
        self.assertEqual(holm_adjust({'a': .01, 'b': .03}), {'a': .02, 'b': .03})
        self.assertEqual(holm_adjust({'a': .03, 'b': .04}), {'a': .06, 'b': .06})
        self.assertEqual(holm_adjust({'a': .7, 'b': .8}), {'a': 1, 'b': 1})

    def test_student_tail_matches_closed_form_distributions(self):
        self.assertAlmostEqual(regularized_beta(.5, .5, .5), .5, places=12)
        self.assertAlmostEqual(regularized_beta(1, .5, .5), 1 - 1 / math.sqrt(2), places=12)

    def test_paired_t_and_bootstrap_are_reproducible(self):
        differences = [1] * 6 + [0] * 22
        groups = ['fixture'] * 28
        first = paired_stats(differences, groups)
        self.assertAlmostEqual(first['pairedT'], math.sqrt(6 * 27 / 22), places=12)
        self.assertEqual(first, paired_stats(differences, groups))
        self.assertEqual(paired_stats([0] * 28, groups)['exactMcNemarTwoSidedP'], 1)
        self.assertEqual(paired_stats([1] * 28, groups)['pairedT'], None)

    def test_missing_or_partial_usage_is_not_complete(self):
        self.assertFalse(usage_record({}, 'main')['complete'])
        value = usage_record({'usage': {'input_tokens': 20, 'cache_read_input_tokens': 30}}, 'main')
        self.assertEqual(value['knownInput'], 50)
        self.assertFalse(value['complete'])
        self.assertTrue(usage_record({'usage': {'input_tokens': 20, 'output_tokens': 3}}, 'jev')['complete'])
        self.assertFalse(usage_record({'usage': {'input_tokens': True, 'output_tokens': 3}}, 'jev')['complete'])

if __name__ == '__main__':
    unittest.main()
