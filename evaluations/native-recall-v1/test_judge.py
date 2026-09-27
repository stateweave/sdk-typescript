import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch
import judge

class JudgeTests(unittest.TestCase):
    def packet(self):
        return {'tasks': [{'question': 'Code?', 'reference': 'LARCH-29', 'rule': judge.BASE_RULE, 'responses': [{'id': 'reply-0', 'text': 'LARCH-29'}]}]}

    def response(self):
        message = {'role': 'assistant', 'model': judge.MODEL, 'provider': 'openai-codex', 'content': [{'type': 'thinking', 'thinking': 'PRIVATE_THOUGHT_MUST_NOT_PERSIST'}, {'type': 'text', 'text': json.dumps({'results': [{'id': 'reply-0', 'correct': True, 'reason': 'Exact requested code.'}]})}], 'usage': {'input': 40, 'output': 12}}
        return types.SimpleNamespace(stdout=json.dumps({'type': 'message_end', 'message': message}), returncode=0)

    def test_isolation_flags_and_no_thinking_persistence(self):
        with tempfile.TemporaryDirectory() as temporary, patch('judge.subprocess.run', return_value=self.response()) as run:
            root = Path(temporary)
            judge.invoke(root, 'case', self.packet())
            args = run.call_args.args[0]
            for flag in ['--no-tools', '--no-extensions', '--no-skills', '--no-context-files', '--no-session', '--no-approve']:
                self.assertIn(flag, args)
            self.assertEqual(args[args.index('--append-system-prompt') + 1], ' ')
            self.assertEqual(run.call_args.kwargs['cwd'], '/tmp')
            self.assertFalse(any('PRIVATE_THOUGHT_MUST_NOT_PERSIST' in file.read_text() for file in root.iterdir()))

    def test_success_cache_is_packet_bound_and_does_not_repeat(self):
        with tempfile.TemporaryDirectory() as temporary, patch('judge.subprocess.run', return_value=self.response()) as run:
            root = Path(temporary)
            self.assertEqual(judge.invoke(root, 'case', self.packet()), judge.invoke(root, 'case', self.packet()))
            self.assertEqual(run.call_count, 1)
            packet = self.packet()
            packet['tasks'][0]['reference'] = 'changed'
            with self.assertRaisesRegex(AssertionError, 'another packet'):
                judge.invoke(root, 'case', packet)
            self.assertEqual(run.call_count, 1)

    def test_ambiguous_start_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as temporary, patch('judge.subprocess.run') as run:
            root = Path(temporary)
            (root / 'case.started.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'Ambiguous prior'):
                judge.invoke(root, 'case', self.packet())
            run.assert_not_called()

    def test_timeout_is_preserved_and_cannot_be_replayed(self):
        with tempfile.TemporaryDirectory() as temporary, patch('judge.subprocess.run', side_effect=subprocess.TimeoutExpired('pi', 180)) as run:
            root = Path(temporary)
            with self.assertRaises(AssertionError):
                judge.invoke(root, 'case', self.packet())
            self.assertTrue(json.loads((root / 'case.transport.json').read_text())['timedOut'])
            with self.assertRaises(RuntimeError):
                judge.invoke(root, 'case', self.packet())
            self.assertEqual(run.call_count, 1)

    def test_official_rubric_distinctions_remain_explicit(self):
        self.assertIn('off-by-one', judge.rule('temporal-reasoning'))
        self.assertIn('need not reflect every point', judge.rule('single-session-preference'))
        self.assertIn('unknown', judge.rule('abstention'))
        self.assertIn('updated answer', judge.rule('knowledge-update'))

if __name__ == '__main__':
    unittest.main()
