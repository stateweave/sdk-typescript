import copy
import json
from pathlib import Path
import tempfile
import unittest
from confirmation_gate import gate
from results import bound_judgment
from judge import MODEL, packet_hash, judge_command
from scan_evidence import scan
from accounting import summarize as account

class ConfirmationTests(unittest.TestCase):
    def fixture(self):
        return {'cases': 196, 'comparisons': {arm: {'difference': .15, 'pairedT': 3, 'holmAdjustedP': .02, 'ci95': [.05, .25]} for arm in ['standard', 'lexical']}, 'allArmsCompleteSensitivity': {'differences': {'standard': .15, 'lexical': .15}}, 'nonPreferenceSensitivity': {'differences': {'standard': .15, 'lexical': .15}}, 'arms': {arm: {'completed': 196, 'abstentionCorrect': 16, 'recallFallbacks': 0} for arm in ['standard', 'lexical', 'native']}, 'accounting': {'simulated': False, 'providers': {'main': {'returnedModels': ['glm-5.3-flash']}}}, 'integrity': {'cases': 196}}

    def test_every_statistical_and_practical_condition_is_required(self):
        self.assertTrue(gate(self.fixture())['passed'])
        for key, bad in [('difference', .099), ('pairedT', 2.49), ('pairedT', None), ('holmAdjustedP', .05), ('ci95', [0, .2])]:
            row = self.fixture()
            row['comparisons']['lexical'][key] = bad
            self.assertFalse(gate(row)['passed'])
        row = self.fixture()
        row['allArmsCompleteSensitivity']['differences']['lexical'] = .099
        self.assertFalse(gate(row)['passed'])
        row = self.fixture()
        row['nonPreferenceSensitivity']['differences']['lexical'] = .099
        self.assertFalse(gate(row)['passed'])

    def test_failures_fallbacks_abstentions_and_simulation_cannot_be_hidden(self):
        for arm, key, value in [('standard', 'completed', 192), ('native', 'recallFallbacks', 10), ('native', 'abstentionCorrect', 15)]:
            row = self.fixture()
            row['arms'][arm][key] = value
            self.assertFalse(gate(row)['passed'])
        row = self.fixture()
        row['accounting']['simulated'] = True
        self.assertFalse(gate(row)['passed'])

    def test_votes_bind_both_packet_and_original_provider_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet = {'tasks': [{'responses': [{'id': 'reply-0', 'text': 'A'}]}]}
            parsed = {'results': [{'id': 'reply-0', 'correct': True, 'reason': 'Matches.'}]}
            def save(name, value):
                (root / ('case.' + name + '.json')).write_text(json.dumps(value))
            save('order', {'requestHash': packet_hash(packet), 'parsed': parsed})
            save('order.started', {'requestHash': packet_hash(packet), 'packet': packet, 'flags': judge_command()[1:]})
            save('order.transport', {'exitCode': 0, 'timedOut': False, 'messages': [{'provider': 'openai-codex', 'model': MODEL, 'content': [{'type': 'text', 'text': json.dumps(parsed)}]}]})
            self.assertTrue(bound_judgment(root, 'case.order', packet)[0]['correct'])
            changed = copy.deepcopy(packet)
            changed['tasks'][0]['responses'][0]['text'] = 'B'
            with self.assertRaises(AssertionError):
                bound_judgment(root, 'case.order', changed)
            save('order.started', {'requestHash': packet_hash(packet), 'packet': packet, 'flags': [flag for flag in judge_command()[1:] if flag != '--no-context-files']})
            with self.assertRaises(AssertionError):
                bound_judgment(root, 'case.order', packet)
            save('order.started', {'requestHash': packet_hash(packet), 'packet': packet, 'flags': judge_command()[1:]})
            parsed['results'][0]['correct'] = False
            save('order', {'requestHash': packet_hash(packet), 'parsed': parsed})
            with self.assertRaises(AssertionError):
                bound_judgment(root, 'case.order', packet)

    def test_malformed_usage_and_observed_status_without_body_are_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'commit': 'fixture', 'phase': 'offline-harness', 'simulated': True}))
            for index in [1, 2]:
                name = f'c_fixture.native.main-{index}'
                (root / (name + '.request.json')).write_text(json.dumps({'startedAt': 'fixture', 'body': {'model': 'glm-5.3-flash'}}))
            (root / 'c_fixture.native.main-1.response.json').write_text(json.dumps({'status': 200, 'body': {'usage': None}}))
            (root / 'c_fixture.native.main-2.error.json').write_text(json.dumps({'observedHttpStatus': 200, 'elapsedMs': 1}))
            result = account(root)['providers']['main']
            self.assertEqual((result['starts'], result['responses'], result['httpStatusObserved'], result['startsWithoutCompleteUsage']), (2, 1, 2, 2))
            self.assertEqual(result['httpStatuses'], {'200': 2})

    def test_secret_scan_is_byte_bound_without_returning_the_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = 'only-a-synthetic-scan-fixture'
            file = root / 'example.json'
            file.write_text(json.dumps({'value': key}))
            result = scan({'generation': root}, [key], ['fixture'])
            self.assertEqual(result['credentialMatches'], 1)
            self.assertNotIn(key, json.dumps(result))
            file.write_text('{}')
            clean = scan({'generation': root}, [key], ['fixture'])
            self.assertEqual(clean['credentialMatches'], 0)
            self.assertNotEqual(result['digests'], clean['digests'])

if __name__ == '__main__':
    unittest.main()
