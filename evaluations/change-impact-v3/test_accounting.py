import json
import tempfile
import unittest
from pathlib import Path

from accounting import accounting


class AccountingTests(unittest.TestCase):
    def test_rejected_and_unreturned_usage_is_unknown_not_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def save(name, value):
                (root / name).write_text(json.dumps(value))
            save('manifest.json', {'offline': False, 'commit': 'f' * 40, 'cases': 1, 'arms': ['standard', 'lexical', 'jev', 'full']})
            for arm in ['standard', 'jev']:
                save(f'c_aaaaaaaaaaaa.{arm}.started.json', {})
            save('c_aaaaaaaaaaaa.standard.json', {'status': 'failed', 'phase': 'agent', 'result': None})
            save('c_aaaaaaaaaaaa.standard.http-1.request.json', {'url': 'https://api.z.ai/api/anthropic/v1/messages', 'body': {}})
            save('c_aaaaaaaaaaaa.standard.http-1.response.json', {'status': 429, 'body': {'error': {'code': '1302'}}})
            save('c_aaaaaaaaaaaa.jev.http-1.request.json', {'url': 'https://api.typesafe.ai/v1/systemone', 'body': {}})
            save('c_aaaaaaaaaaaa.jev.http-1.error.json', {'name': 'TimeoutError'})
            result = accounting(root)
            self.assertEqual(result['unreturnedArms'], 1)
            self.assertEqual(result['unstartedArms'], 2)
            self.assertEqual(len(result['requestsWithoutCompleteUsage']), 2)
            self.assertNotIn('knownInputTokens', result['providers']['main'])
            self.assertEqual(result['transportErrors']['jev']['TimeoutError'], 1)

    def test_reported_cache_and_partial_usage_are_distinguished(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def save(name, value):
                (root / name).write_text(json.dumps(value))
            save('manifest.json', {'offline': False, 'commit': 'f' * 40, 'cases': 1, 'arms': ['standard', 'lexical', 'jev', 'full']})
            for number, usage in enumerate([
                {'input_tokens': 10, 'cache_read_input_tokens': 20, 'cache_creation_input_tokens': 5, 'output_tokens': 3},
                {'output_tokens': 4}
            ]):
                prefix = f'c_aaaaaaaaaaaa.standard.http-{number}'
                save(prefix + '.request.json', {'url': 'https://api.z.ai/api/anthropic/v1/messages', 'body': {}})
                save(prefix + '.response.json', {'status': 200, 'durationMs': 50, 'body': {'usage': usage}})
            result = accounting(root)['providers']['main']
            self.assertEqual(result['knownInputTokens'], 35)
            self.assertEqual(result['knownOutputTokens'], 7)
            self.assertEqual(result['maxReportedInputTokens'], 35)
            self.assertEqual(result['responsesWithCompleteUsage'], 1)
            self.assertEqual(result['requestsWithoutCompleteUsage'], 1)


if __name__ == '__main__':
    unittest.main()
