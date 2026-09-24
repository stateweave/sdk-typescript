import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).parent

def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'))
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

judge=module('judge')
summary=module('summarize')

class ProtocolTests(unittest.TestCase):
    def test_exact_paired_statistics(self):
        self.assertEqual(summary.sign_test(0,0),1)
        self.assertEqual(summary.sign_test(7,0),0.015625)
        self.assertEqual(summary.sign_test(4,4),1)
        self.assertGreater(summary.sign_test(7,1),0.05)

    def test_case_bootstrap_is_reproducible(self):
        rows=[{'correct':{'baseline':i%2,'combined':1}} for i in range(32)]
        self.assertEqual(summary.bootstrap(rows,'combined'),summary.bootstrap(rows,'combined'))

    def test_official_rule_distinctions(self):
        self.assertIn('off-by-one',judge.rule({'group':'temporal-reasoning','questionType':'temporal-reasoning'}))
        self.assertIn('unknown',judge.rule({'group':'abstention','questionType':'single-session-user'}))
        self.assertIn('updated',judge.rule({'group':'knowledge-update','questionType':'knowledge-update'}))

    def test_judge_isolation_and_idempotent_complete_record(self):
        result={'results':[{'id':'a','correct':True,'reason':'Exact.'}]}
        event={'type':'message_end','message':{'role':'assistant','model':'gpt-5.6-sol','provider':'openai-codex','content':[{'type':'text','text':json.dumps(result)}],'usage':{'input':30,'output':10}}}
        packet={'responses':[{'id':'a','text':'value'}]}
        with tempfile.TemporaryDirectory() as directory, patch.object(judge.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(event))) as call:
            self.assertEqual(judge.invoke(Path(directory),'mock',judge.QA_SYSTEM,packet),result)
            args=call.call_args.args[0]
            for flag in ['--no-tools','--no-extensions','--no-skills','--no-context-files','--no-session','--no-prompt-templates','--no-themes']:
                self.assertIn(flag,args)
            self.assertEqual(args[args.index('--append-system-prompt')+1],' ')
            self.assertEqual(json.loads(call.call_args.kwargs['input']),packet)
            self.assertEqual(judge.invoke(Path(directory),'mock',judge.QA_SYSTEM,packet),result)
            self.assertEqual(call.call_count,1)

    def test_ambiguous_judge_attempt_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)
            judge.save(path/'mock.started.json',{'started':True})
            with self.assertRaisesRegex(RuntimeError,'no automatic replay'):
                judge.invoke(path,'mock',judge.QA_SYSTEM,{'responses':[]})

    def test_native_retry_events_remain_visible(self):
        self.assertIn('retryEvents',(ROOT/'judge.py').read_text())

if __name__=='__main__':
    unittest.main()
