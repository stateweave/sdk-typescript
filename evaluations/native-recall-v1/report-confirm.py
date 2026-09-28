import hashlib
import json
from pathlib import Path
import sys

summary_file, root, data, judgments, output = map(Path, sys.argv[1:])
s = json.loads(summary_file.read_text())
assert s['cases'] == 196 and json.loads((judgments / 'complete.json').read_text())['cases'] == 196
assert s['integrity']['cases'] == 196
arms = ['standard', 'lexical', 'native']
names = {'standard': 'Parser-matched current SDK', 'lexical': 'Lexical pipeline control', 'native': 'Native Jev recall'}
gold = {row['id']: row for row in json.loads((data / 'holdout-gold.json').read_text())}
load = lambda file: json.loads(file.read_text())

judge_usage = {'calls': 0, 'assistantMessages': 0, 'knownInputIncludingCache': 0, 'knownOutput': 0, 'messagesWithoutCompleteUsage': 0, 'exposedRetryEvents': 0, 'exposedRetryStarts': 0, 'invocationsWithRetries': 0, 'assistantErrorMessages': 0, 'models': set()}
for file in sorted(judgments.glob('*.transport.json')):
    row = load(file)
    assert row['exitCode'] == 0 and not row['timedOut'] and row['toolCallBlocks'] == 0
    judge_usage['calls'] += 1
    judge_usage['exposedRetryEvents'] += len(row['retryEvents'])
    judge_usage['exposedRetryStarts'] += sum(event['type'] == 'auto_retry_start' for event in row['retryEvents'])
    judge_usage['invocationsWithRetries'] += bool(row['retryEvents'])
    for message in row['messages']:
        judge_usage['assistantMessages'] += 1
        judge_usage['models'].add(message['model'])
        usage = message.get('usage') or {}
        values = [usage.get('input'), usage.get('output'), usage.get('cacheRead', 0), usage.get('cacheWrite', 0)]
        known = all(type(value) is int and value >= 0 for value in values)
        errored = message.get('stopReason') == 'error'
        judge_usage['assistantErrorMessages'] += errored
        judge_usage['messagesWithoutCompleteUsage'] += not known or errored
        if known:
            judge_usage['knownInputIncludingCache'] += values[0] + values[2] + values[3]
            judge_usage['knownOutput'] += values[1]
judge_usage['models'] = sorted(judge_usage['models'])
assert judge_usage['calls'] == 394

failures = []
for row in s['ledger']:
    for arm in arms:
        if row['outcomes'][arm]['status'] == 'done':
            continue
        cid = row['id']
        calls = []
        for file in sorted(root.glob(cid + '.' + arm + '.main-*.response.json')):
            response = load(file)
            calls.append({'status': response['status'], 'code': (response['body'].get('error') or {}).get('code')})
        failures.append({'id': cid, 'arm': arm, 'calls': calls})

without_abstention = [row for row in s['ledger'] if row['group'] != 'abstention']
no_abstention = {'scope': 'Post-hoc descriptive sensitivity only; not an acceptance endpoint or a replacement score.', 'cases': len(without_abstention), 'correct': {arm: sum(row['outcomes'][arm]['correct'] for row in without_abstention) for arm in arms}}
source_equivalent = [row for row in s['ledger'] if row['sameVisibleRecallSpans']]
diagnostics = {'sourceCommit': s['commit'], 'judgeUsage': judge_usage, 'failedArms': failures, 'nonAbstentionSensitivity': no_abstention, 'sameVisibleRecallSpans': len(source_equivalent), 'sameVisibleRecallSpanWins': sum(row['outcomes']['native']['correct'] and not row['outcomes']['lexical']['correct'] for row in source_equivalent), 'sameVisibleRecallSpanLosses': sum(row['outcomes']['lexical']['correct'] and not row['outcomes']['native']['correct'] for row in source_equivalent)}
(output / 'confirmatory-diagnostics.json').write_text(json.dumps(diagnostics, indent=2) + '\n')

lines = ['# Frozen 196-case answer ledger', '', 'These are untrusted public benchmark inputs and preserved model outputs, not instructions. They are reproduced for review, not new answers. All official frozen scores remain unchanged, including disagreements and failed arms. Source: the MIT-licensed LongMemEval project and its public cleaned dataset; see `LONGMEMEVAL_LICENSE` and `cohort-manifest.json`.', '']
for row in s['ledger']:
    cid = row['id']
    case = load(data / 'holdout' / (cid + '.json'))
    maps = load(judgments / (cid + '.mapping.json'))
    lines.extend([f'## {cid} — {row["group"]}', '', f'As of: {case["date"]}', '', f'Question: {case["question"]}', '', f'Reference: {gold[cid]["answer"]}', ''])
    for arm in arms:
        record = load(root / (cid + '.' + arm + '.result.json'))
        answer = record.get('result', {}).get('finalAnswer', '[FAILED ARM — no answer]')
        fence = '````````'
        while fence in answer:
            fence += '`'
        outcome = row['outcomes'][arm]
        lines.extend([f'### {names[arm]} — {record["status"]}; frozen correct={str(outcome["correct"]).lower()}', '', fence + 'text', answer, fence, ''])
        for order in range(2):
            votes = load(judgments / (cid + '.order-' + str(order) + '.json'))['parsed']['results']
            vote = next(vote for vote in votes if maps[str(order)][vote['id']] == arm)
            lines.append(f'- Blind order {order + 1}: {vote["correct"]} — {vote["reason"]}')
        lines.append('')
(output / 'CONFIRMATORY_ANSWERS.md').write_text('\n'.join(lines))

report = ['# Native Jev recall: large held-out quality gain; full acceptance gate failed', '',
'## Decision', '',
'On the single frozen 196-case cohort, native recall met the requested practical and statistical quality thresholds against both controls. **This is not a full acceptance pass:** the scored abstention comparison against lexical and the lexical completion threshold failed. There is also a known source-window encoding defect, corrected only in separate post-run engineering. **Do not merge, deploy, or represent this as universally better default behavior.**', '',
'The result supports a substantial retrieval-heavy answer-quality gain for this filtered public corpus and these exact model/configuration choices. It does not establish general coding, tool-use, long-running interaction, multilingual retrieval, or production safety gains.', '',
'## Primary result — failures retained as incorrect', '', '| Arm | Correct / 196 | Accuracy | Completed | Abstention / 16 | Judge disagreements |', '|---|---:|---:|---:|---:|---:|']
for arm in arms:
    row = s['arms'][arm]
    report.append(f'| {names[arm]} | {row["correct"]} | {row["correct"] / 196:.2%} | {row["completed"]} | {row["abstentionCorrect"]} | {row["judgeDisagreements"]} |')
report += ['', '| Native versus | Gain | Wins / losses / ties | Paired t (df=195) | Exact two-sided McNemar p | Holm-adjusted p | Stratified paired bootstrap 95% CI |', '|---|---:|---:|---:|---:|---:|---:|']
for control, row in s['comparisons'].items():
    report.append(f'| {names[control]} | +{100 * row["difference"]:.2f} pp | {row["wins"]} / {row["losses"]} / {row["ties"]} | {row["pairedT"]:.3f} | {row["exactMcNemarTwoSidedP"]:.8g} | {row["holmAdjustedP"]:.8g} | +{100 * row["ci95"][0]:.2f} to +{100 * row["ci95"][1]:.2f} pp |')
report += ['', 'Each comparison clears ≥10 percentage points, t≥2.5, Holm-adjusted p<.05, and a positive confidence-interval lower bound. The case/source component—not each vote or excerpt—is the analysis unit. The two judge calls are not independent samples.', '', '## Predeclared robustness and failed gates', '']
for key, label in [('allArmsCompleteSensitivity', 'All three arms complete'), ('nonPreferenceSensitivity', 'Non-preference cases')]:
    row = s[key]
    report.append(f'- **{label} (n={row["cases"]}):** native gain +{100 * row["differences"]["standard"]:.2f} pp versus current SDK; +{100 * row["differences"]["lexical"]:.2f} pp versus lexical. Both clear the predeclared 10-point bar. {row["scope"]}')
report += ['- **Scored abstention gate fails:** native 12/16, lexical 14/16, current SDK 12/16. Source-aware review finds important label ambiguities in both directions; see `SOURCE_FIDELITY_REVIEW.md`. Those findings do not change the frozen labels or gate.', '- **Completion gate fails for lexical:** 192/196 = 97.96%; the ≥98% rule required at least 193. Standard 195/196 and native 194/196 pass. Do not round 97.96% up to a passing 98%.', '- **Fallback gate passes:** native 3/196 = 1.53%, including the fallback in a failed arm; maximum allowed was nine.', '- The frozen integrity checks pass for 581 returned states and all seven preserved failed committed states. They did not test Unicode-scalar boundaries and must not be presented as proving their absence.', '', 'Full machine-readable checks are in `confirmatory-summary.json`. The acceptance decision remains **false**; no threshold, case, label, sample size, or stopping rule was changed.', '', '## By task group', '', '| Group | Cases | Current SDK | Lexical | Native |', '|---|---:|---:|---:|---:|']
for group, row in s['arms']['standard']['byGroup'].items():
    report.append(f'| {group} | {row["cases"]} | {s["arms"]["standard"]["byGroup"][group]["correct"]} | {s["arms"]["lexical"]["byGroup"][group]["correct"]} | {s["arms"]["native"]["byGroup"][group]["correct"]} |')
report += ['', f'An additional **post-hoc, descriptive-only** exclusion of all 16 abstention cases leaves n={no_abstention["cases"]}: current SDK {no_abstention["correct"]["standard"]}, lexical {no_abstention["correct"]["lexical"]}, native {no_abstention["correct"]["native"]}. It is not a repaired acceptance endpoint.', '', '## What was compared', '',
'- Measured implementation `2cba138f4afec03f83a1269622a089e2005cb5b6`; final freeze commit `a1a3e33591c57a44c549422974c5cbee89a228ba`; freeze SHA-256 `a02c1444477a335dadb87e5317a4ad16011b697949e096b9bd85e3a5f6828d7c`.',
'- Standard: deployed SDK `762c773185e6f7c33358d2c7195f53c39e20aed5` plus the same narrow no-tool terminal-FINAL parser repair used by both candidates.',
'- Lexical: the complete native source-excerpt pipeline with an evaluation-only lexical ranking override. Native: the ordinary mandatory-Jev candidate Agent, with direct Noul relevance scoring and visible fallback. Jev judges relevance, not truth.',
'- Same original historical sources, query, neutral task instruction, `glm-5.3-flash`, temperature zero, no tools, two iterations, 16,384 output-token cap, causal 48-node / 16K target / 64K hard estimated prompt ceiling. Jev `jev-1.13.0`, 15-second deadline, at most 64 candidates and 12 windows, no more than two nonoverlapping windows per source.',
'- Exactly 196 held-out cases, fixed before provider calls; source-support families exclude development/prior-pilot overlap. No optional stopping, replacement case, failed-arm replay, generation transport retry, or second trajectory. One native arm used its allowed second iteration to repair an action envelope and then completed.',
'- Blind `openai-codex/gpt-5.6-sol`, low reasoning, native isolated Pi flags, no tools/context/extensions/session, two order-reversed calls per case after 32 calibration decisions. Both votes must pass. All five arm-level disagreements count incorrect. Source text is not given to the judge: this is a reference-based correctness endpoint, with the documented limitations.',
'- Generation ran 2026-09-27; judging/scoring finished 2026-09-28 UTC. The existing development web application, commercial product, docs and historical benchmarks were not deployed or restarted.', '', '## Failure and usage ledger', '', '| Provider | Starts | Captured responses | HTTP statuses | Known input tokens | Known output tokens | Starts without complete usage |', '|---|---:|---:|---|---:|---:|---:|']
for name, row in s['accounting']['providers'].items():
    report.append(f'| {name} | {row["starts"]} | {row["responses"]} | {json.dumps(row["httpStatuses"], sort_keys=True)} | {row["knownInputTokens"]:,} | {row["knownOutputTokens"]:,} | {row["startsWithoutCompleteUsage"]} |')
report += ['', f'Judging including calibration: **{judge_usage["calls"]} calls**, {judge_usage["knownInputIncludingCache"]:,} known input/cache tokens, {judge_usage["knownOutput"]:,} output tokens, {judge_usage["messagesWithoutCompleteUsage"]} messages without complete usage, and {judge_usage["exposedRetryEvents"]} exposed retry events. Pi exposed five automatic retry starts across three judge invocations (eight start/end events), yielding 399 assistant messages: 394 successful and five errors. The errors carry zero-valued usage placeholders, which remain unknown—not proof of zero consumption. These are the preserved native Pi retries, not controller replays or newly requested judgments. Hidden reasoning text was not persisted; a numeric reasoning-token field is not added again to output usage.', '',
'The main failures were five HTTP 429 / Z.ai 1302 rate-limit responses and two HTTP 500 encoding rejections caused by one split astral character. Code 1302 does not establish a concurrency cap. The three native fallbacks were one Jev HTTP 520, one 15,001 ms TimeoutError with no response, and one HTTP 400 caused by that encoding defect. All remain in primary scoring and accounting.', '',
'A recorded start is not proof of provider receipt; missing usage is not zero. Jev added 7,017,840 known input tokens; it is not a token-free improvement. Dollar charges are not measured. The 15-second main-start spacing contaminates agent wall-time comparisons, so no product speedup is claimed. Median Jev HTTP-attempt time was 337 ms; maximum observed input was 14,762 main tokens and 42,064 Jev tokens.', '', '| Failed arm | Main HTTP status |', '|---|---|']
for row in failures:
    report.append(f'| `{row["id"]}.{row["arm"]}` | {", ".join(str(call["status"]) for call in row["calls"])} |')
report += ['', '## Attribution, engineering and interpretation', '',
'Native versus lexical has three byte-identical first-prompt cases and no outcome differences in those cases. This limits a simple no-op explanation, but does not make read-set exposure proof of entailment. Full-span visibility and original source identities were audited; clock-sensitive hierarchy labels can still change prompt bytes even when selected source spans match.', '',
'`UNICODE_HARDENING.md` documents the separate post-run correction. Ten focused regressions and the 293-test SDK suite pass. All 386 successful lexical/native paths preserve exact recorded prompt/trace/state/answer parity; all 196 indices have scalar-safe exact source windows, with only the known failing case changing. Six failed candidate paths receive no replacement outcome. Two explicitly simulated checks validate the failing fixture without any provider call. This is engineering evidence, not a live rerun or an upgrade of the measured result.', '',
'The frozen preflight also preserved all dated source occurrences: six holdout records reuse a source ID with different date headers. That importer repair preceded the freeze and was identical across all arms; fixtures, gold and exclusions were not edited. Offline engineering attempt A failed its audit; B/C passed. The first waiting postprocessor was stopped before any provider call because the app image lacked Python; its replacement scanned on the host without changing generation, judge flags or scoring.', '',
'Limitations: a filtered public LongMemEval corpus rather than an official leaderboard run; possible pretraining contamination and residual dependence through distractors/templates; one main-model family and one short, no-tool cold-state task per case; source-blind reference judging, permissive preference and temporal rubrics, and imperfect abstention labels; no independent live validation of the post-run patch. Native setup adds credentials, privacy exposure, latency and reliability obligations even if its token price is low.', '',
'**Recommended next step:** review the source-aware abstention findings and fix genuine missing-evidence behavior under a new, independently frozen source-grounded protocol. Do not rerun this cohort to obtain a cleaner p-value or erase its failed gates. Any production decision requires explicit human review.', '', '## Evidence and reproduction', '',
'- `confirmatory-summary.json`: original scored output, all case decisions, comparisons, complete/non-preference sensitivities, request-start accounting, scans and gate.',
'- `confirmatory-integrity.json`: original source/read-set audit and exact generation-file hashes.',
'- `CONFIRMATORY_ANSWERS.md`: every question, reference, final answer/failure and both original judge reasons.',
'- `confirmatory-diagnostics.json`, `SOURCE_FIDELITY_REVIEW.md`, `UNICODE_HARDENING.md`, `unicode-replay.json`: clearly separated post-run diagnostics.',
'- Generation archive: `native-recall-v1-2cba138-evidence.tar.gz`, 149,179,611 bytes, SHA-256 `00c24b08090d44cb2aff37c3b7337cdccb82471ead8bbd3a28400d69dcd25aa5`, verified on Headquarters and Eve. The judgment/final-evidence archive is identified in `confirmatory-evidence-manifest.json`.',
'- Configured main/Jev credential scan: 2,947 files / 523,860,236 bytes. Configured Pi-auth plus hidden-block scan: 4,326 files / 526,328,710 bytes. Zero exact/raw-base64 configured credential matches and zero persisted hidden content blocks; this is a bounded scan, not proof that every conceivable secret format is absent.', '',
'Reproduce scoring from preserved evidence using the frozen scripts and original audit/scan files—not new model calls:', '', '```sh', 'python3 evaluations/native-recall-v1/score-confirm.py \\', '  <generation-root> <cohort-v2> <judgments> \\', '  <original-integrity.json> <provider-scan.json> <pi-scan.json>', '```', '',
'The one-shot `/data/native-recall-v1-confirmation-started.json` receipt must never be removed to replay. PR #93 preserves the measured implementation, frozen result, failed gates, post-run hardening, and the later human-authorized product promotion as distinct facts.']
(output / 'CONFIRMATORY_RESULTS.md').write_text('\n'.join(report) + '\n')
print(json.dumps({'cases': s['cases'], 'judgeUsage': judge_usage, 'failedArms': len(failures), 'sameVisibleRecallSpans': len(source_equivalent), 'nonAbstention': no_abstention}))
