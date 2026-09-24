import collections
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).parent
source = Path(sys.argv[1])
raw = source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c'
rows = json.loads(raw)
groups = collections.defaultdict(list)
def public_id(sid):
    return 'source-' + hashlib.sha256(('jev-quality-source:' + sid).encode()).hexdigest()[:16]
for row in rows:
    size = sum(len(turn['content']) for session in row['haystack_sessions'] for turn in session)
    turns = sum(len(session) for session in row['haystack_sessions'])
    sources = [{'id': f'{public_id(sid)}:{i}', 'sessionId': public_id(sid), 'date': date, 'role': t['role'], 'content': t['content']} for date, sid, session in zip(row['haystack_dates'], row['haystack_session_ids'], row['haystack_sessions']) for i, t in enumerate(session)]
    if size > 60000 or turns > 96 or len(json.dumps({'sources': sources}, ensure_ascii=False, separators=(',', ':'))) > 75000:
        continue
    group = 'abstention' if row['question_id'].endswith('_abs') else row['question_type']
    groups[group].append(row)
selected = []
for group in sorted(groups):
    count = 8 if group == 'abstention' else 4
    ordered = sorted(groups[group], key=lambda r: hashlib.sha256(('jev-quality-20260924:' + r['question_id']).encode()).hexdigest())
    assert len(ordered) >= count
    selected.extend((group, row) for row in ordered[:count])
selected.sort(key=lambda p: hashlib.sha256(('execution-order:' + p[1]['question_id']).encode()).hexdigest())
participants = []
private = []
for index, (group, row) in enumerate(selected):
    case_id = f'case-{index+1:02d}'
    sessions = []
    for date, sid, turns in zip(row['haystack_dates'], row['haystack_session_ids'], row['haystack_sessions']):
        sessions.append({'date': date, 'id': sid, 'turns': [{'role': t['role'], 'content': t['content']} for t in turns]})
    sessions.sort(key=lambda s: (s['date'], s['id']))
    source_map = {public_id(s['id']): s['id'] for s in sessions}
    sessions = [{**s, 'id': public_id(s['id'])} for s in sessions]
    participants.append({'id': case_id, 'sessions': sessions, 'question': row['question'], 'questionDate': row['question_date']})
    private.append({'id': case_id, 'sourceId': row['question_id'], 'group': group, 'questionType': row['question_type'], 'answer': row['answer'], 'answerSessionIds': row['answer_session_ids'], 'sourceSessionMap': source_map})
assert len(participants) == 32
for name, data in [('cases.json', participants), ('private-gold.json', private)]:
    target = root / name
    with target.open('x') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(name, hashlib.sha256(target.read_bytes()).hexdigest())
print('strata', dict(collections.Counter(g['group'] for g in private)))
print('turn counts', [sum(len(s['turns']) for s in p['sessions']) for p in participants])
