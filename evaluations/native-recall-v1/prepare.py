import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
import ijson

SEED = 'stateweave-native-recall-20260927-v1'

def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()

def norm(text):
    return re.sub(r'_abs(?=_|$)', '', text.removeprefix('answer_'))

def prepare(source, old_gold, output):
    old = json.loads(old_gold.read_text())
    excluded_questions = set(old['excludedQuestionFamilies']) if isinstance(old, dict) else {row['sourceId'].replace('_abs', '') for row in old}
    excluded_sessions = set(old['excludedSourceFamilies']) if isinstance(old, dict) else {norm(value) for row in old for value in row['sourceSessionMap'].values()}
    meta = []
    with source.open('rb') as stream:
        for row in ijson.items(stream, 'item'):
            if row['question_id'].replace('_abs', '') in excluded_questions or any(norm(sid) in excluded_sessions for sid in row['answer_session_ids']):
                continue
            meta.append({'id': row['question_id'], 'group': 'abstention' if row['question_id'].endswith('_abs') else row['question_type'], 'support': sorted(norm(sid) for sid in row['answer_session_ids'])})
    parent = {row['id']: row['id'] for row in meta}
    def find(key):
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key
    owner = {}
    for row in meta:
        for sid in row['support']:
            if sid in owner:
                parent[find(row['id'])] = find(owner[sid])
            else:
                owner[sid] = row['id']
    used = set()
    selected = {}
    groups = ['abstention', 'single-session-user', 'single-session-assistant', 'single-session-preference', 'multi-session', 'temporal-reasoning', 'knowledge-update']
    for group in groups:
        pool = sorted((row for row in meta if row['group'] == group), key=lambda row: digest(SEED + ':' + row['id']))
        for split, count in [('development', 4), ('holdout', 16 if group == 'abstention' else 20 if group == 'single-session-preference' else 32)]:
            chosen = 0
            for row in pool:
                component = find(row['id'])
                if component in used:
                    continue
                used.add(component)
                cid = 'c_' + digest(SEED + ':public:' + row['id'])[:16]
                selected[row['id']] = {**row, 'caseId': cid, 'split': split}
                chosen += 1
                if chosen == count:
                    break
            assert chosen == count, (group, split, chosen, count)
    selected_support = {sid for pick in selected.values() for sid in pick['support']}
    output.mkdir(parents=True, exist_ok=False)
    gold = defaultdict(list)
    manifest = {'seed': SEED, 'sourceSha256': hashlib.file_digest(source.open('rb'), 'sha256').hexdigest(), 'excludedPreviousQuestions': len(excluded_questions), 'excludedPreviousSessions': len(excluded_sessions), 'files': {}, 'counts': {}}
    with source.open('rb') as stream:
        for row in ijson.items(stream, 'item'):
            pick = selected.get(row['question_id'])
            if not pick:
                continue
            sources, mapping = [], {}
            blocked = excluded_sessions | (selected_support - set(pick['support']))
            for sid, date, turns in zip(row['haystack_session_ids'], row['haystack_dates'], row['haystack_sessions']):
                if norm(sid) in blocked:
                    continue
                opaque = 's_' + digest(SEED + ':source:' + sid)[:20]
                text = f'Conversation recorded: {date}\n\n' + '\n\n'.join(f'[{turn["role"].upper()}]\n{turn["content"]}' for turn in turns)
                sources.append({'id': opaque, 'text': text})
                mapping[sid] = opaque
            assert all(sid in mapping for sid in row['answer_session_ids'])
            participant = {'id': pick['caseId'], 'question': row['question'], 'date': row['question_date'], 'sources': sources}
            root = output / pick['split']; root.mkdir(exist_ok=True)
            file = root / (pick['caseId'] + '.json')
            data = json.dumps(participant, ensure_ascii=False, separators=(',', ':')).encode()
            file.write_bytes(data)
            manifest['files'][str(file.relative_to(output))] = hashlib.sha256(data).hexdigest()
            gold[pick['split']].append({'id': pick['caseId'], 'originalId': row['question_id'], 'group': pick['group'], 'answer': row['answer'], 'answerSources': [mapping[sid] for sid in row['answer_session_ids']], 'originalSourceMap': mapping})
    for split, rows in gold.items():
        rows.sort(key=lambda row: row['id'])
        file = output / (split + '-gold.json')
        file.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
        file.chmod(0o600)
        manifest[split + 'GoldSha256'] = hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()
        manifest['counts'][split] = {group: sum(row['group'] == group for row in rows) for group in groups}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'counts': manifest['counts'], 'files': len(manifest['files']), 'sourceSha256': manifest['sourceSha256']}, indent=2))

if __name__ == '__main__':
    prepare(*(Path(value) for value in sys.argv[1:]))
