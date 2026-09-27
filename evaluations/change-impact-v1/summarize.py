import hashlib
import json
import math
import random
import statistics
import sys
from pathlib import Path

ARMS = ['standard', 'lexical', 'jev', 'full']

def case_score(expected, predicted, done=True):
    if not done:
        return 0.0
    expected, predicted = set(expected), set(predicted)
    if not expected:
        return float(not predicted)
    return 2 * len(expected & predicted) / (len(expected) + len(predicted))

def beta_fraction(a, b, x):
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / max(d, 1e-300)
    h = d
    for m in range(1, 401):
        aa = m * (b - m) * x / ((qam + 2*m) * (a + 2*m))
        d = 1 + aa * d; d = d if abs(d) > 1e-300 else 1e-300
        c = 1 + aa / c; c = c if abs(c) > 1e-300 else 1e-300
        d = 1/d; h *= d*c
        aa = -(a+m)*(qab+m)*x/((a+2*m)*(qap+2*m))
        d = 1 + aa*d; d = d if abs(d) > 1e-300 else 1e-300
        c = 1 + aa/c; c = c if abs(c) > 1e-300 else 1e-300
        d = 1/d; delta = d*c; h *= delta
        if abs(delta-1) < 3e-14:
            break
    return h

def regularized_beta(a, b, x):
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    factor = math.exp(math.lgamma(a+b)-math.lgamma(a)-math.lgamma(b)+a*math.log(x)+b*math.log1p(-x))
    if x < (a+1)/(a+b+2): return factor*beta_fraction(a,b,x)/a
    return 1-factor*beta_fraction(b,a,1-x)/b

def paired_stats(differences, positive, seed=20260927):
    n = len(differences)
    mean = statistics.mean(differences)
    sd = statistics.stdev(differences) if n > 1 else 0
    t = mean/(sd/math.sqrt(n)) if sd else (0.0 if not mean else None)
    tp = regularized_beta((n-1)/2, .5, (n-1)/(n-1+t*t)) if t is not None and n > 1 else None
    nonzero = [d for d in differences if abs(d) > 1e-12]
    observed = sum(differences)
    rng = random.Random(seed)
    trials = 100000
    if len(nonzero) <= 18:
        distribution = [0.0]
        for d in nonzero: distribution = [v+s*d for v in distribution for s in [-1,1]]
        p = sum(v >= observed-1e-12 for v in distribution)/len(distribution)
        method = 'exact one-sided paired sign-flip'
    else:
        exceed = 0
        for _ in range(trials):
            bits = rng.getrandbits(len(nonzero))
            value = sum(d if (bits >> i) & 1 else -d for i,d in enumerate(nonzero))
            exceed += value >= observed-1e-12
        p = (exceed+1)/(trials+1)
        method = '100000-draw one-sided paired sign-flip; plus-one correction'
    strata = [[i for i,value in enumerate(positive) if value == level] for level in [False, True]]
    draws = []
    for _ in range(10000):
        sample = [differences[rng.choice(group)] for group in strata for _ in group]
        draws.append(sum(sample)/n)
    draws.sort()
    return {'n': n, 'difference': mean, 'ci95': [draws[249], draws[9749]], 'pairedT': t, 'tDf': n-1, 'tTwoSidedP': tp, 'primaryOneSidedP': p, 'primaryMethod': method, 'wins': sum(d > 1e-12 for d in differences), 'losses': sum(d < -1e-12 for d in differences), 'ties': sum(abs(d) <= 1e-12 for d in differences)}

def summarize(root, gold_path):
    gold = json.loads(gold_path.read_text())['cases']
    manifest = json.loads((root/'manifest.json').read_text())
    assert not manifest['offline'], 'Offline mocks are not efficacy evidence'
    assert len(gold) == manifest['cases']
    positives = [bool(case['review']) for case in gold]
    pos_n, neg_n = sum(positives), len(gold)-sum(positives)
    weights = [len(gold)/(2*(pos_n if yes else neg_n)) for yes in positives]
    def compact_record(case, arm):
        row = json.loads((root/f"{case['id']}.{arm}.json").read_text())
        result = row.get('result')
        compact = {key: row.get(key) for key in ['status','predicted','durationMs','phase','errorName','errorCode']}
        compact['result'] = {'metadata': result['metadata']} if result else None
        return compact
    records = {arm: [compact_record(case, arm) for case in gold] for arm in ARMS}
    scores, arm_rows, ledger = {}, {}, []
    for arm in ARMS:
        scores[arm] = [case_score(case['review'], record.get('predicted', []), record['status']=='done') for case,record in zip(gold,records[arm])]
        done = [r for r in records[arm] if r['status']=='done']
        tp = sum(len(set(case['review']) & set(r.get('predicted', []))) for case,r in zip(gold,records[arm]) if r['status']=='done')
        fp = sum(len(set(r.get('predicted', []))-set(case['review'])) for case,r in zip(gold,records[arm]) if r['status']=='done')
        fn = sum(len(set(case['review'])-set(r.get('predicted', []))) if r['status']=='done' else len(case['review']) for case,r in zip(gold,records[arm]))
        arm_rows[arm] = {'completed': len(done), 'planned': len(gold), 'balancedScore': statistics.mean(s*w for s,w in zip(scores[arm],weights)), 'positiveMeanF1': statistics.mean(s for s,y in zip(scores[arm],positives) if y), 'negativeSuccess': sum(r['status']=='done' and not r['predicted'] for r,y in zip(records[arm],positives) if not y), 'negativeCases': neg_n, 'exactCorrect': sum(r['status']=='done' and sorted(r['predicted'])==sorted(case['review']) for case,r in zip(gold,records[arm])), 'tp': tp, 'fp': fp, 'fn': fn, 'medianSuccessfulMs': statistics.median(r['durationMs'] for r in done) if done else None, 'medianAllAttemptMs': statistics.median(r['durationMs'] for r in records[arm]), 'mainInputTokens': sum(r['result']['metadata']['totalInputTokens'] for r in done), 'mainOutputTokens': sum(r['result']['metadata']['outputTokens'] for r in done), 'failures': [{'id': case['id'], 'phase': r['phase'], 'errorName': r['errorName'], 'errorCode': r.get('errorCode')} for case,r in zip(gold,records[arm]) if r['status']!='done']}
    comparisons = {arm: paired_stats([(a-b)*w for a,b,w in zip(scores['jev'],scores[arm],weights)], positives) for arm in ['standard','lexical','full']}
    for i, case in enumerate(gold):
        ledger.append({'id': case['id'], 'expected': case['review'], 'outcomes': {arm: {'status': records[arm][i]['status'], 'predicted': records[arm][i].get('predicted'), 'score': scores[arm][i]} for arm in ARMS}})
    jev_requests = []
    main_requests = []
    for file in sorted(root.glob('*.http-*.response.json')):
        r = json.loads(file.read_text())
        body = r.get('body', {})
        if body.get('model') == 'jev-1.13.0': jev_requests.append(r)
        elif body.get('model') == 'glm-5.3-flash': main_requests.append(r)
    def usage(rows):
        return {'responses': len(rows), 'input': sum(r['body'].get('usage',{}).get('input_tokens',0)+r['body'].get('usage',{}).get('cache_read_input_tokens',0)+r['body'].get('usage',{}).get('cache_creation_input_tokens',0) for r in rows), 'output': sum(r['body'].get('usage',{}).get('output_tokens',0) for r in rows), 'missingUsage': sum('usage' not in r['body'] for r in rows)}
    complete = [i for i in range(len(gold)) if all(records[arm][i]['status']=='done' for arm in ARMS)]
    complete_sensitivity = {}
    if complete and any(positives[i] for i in complete) and any(not positives[i] for i in complete):
        cp = [positives[i] for i in complete]
        cw = [len(complete)/(2*(sum(cp) if yes else len(cp)-sum(cp))) for yes in cp]
        complete_sensitivity = {arm: paired_stats([(scores['jev'][i]-scores[arm][i])*w for i,w in zip(complete,cw)], cp) for arm in ['standard','lexical']}
    fallback_count = sum(r.get('result',{}).get('metadata',{}).get('changeReview',{}).get('status')=='fallback' for r in records['jev'] if r.get('result'))
    passed = all(comparisons[a]['difference'] >= .10 and comparisons[a]['primaryOneSidedP'] <= .025 and comparisons[a]['pairedT'] is not None and comparisons[a]['pairedT'] >= 3 for a in ['standard','lexical']) and comparisons['full']['ci95'][0] >= -.05 and all(arm_rows['jev']['negativeSuccess'] >= arm_rows[a]['negativeSuccess']-3 for a in ['standard','lexical']) and not any(row['failures'] for row in arm_rows.values()) and fallback_count == 0
    return {'manifest': manifest, 'scoring': 'Mean of positive-case F1 and no-refutation-case exact specificity, equally weighted; operational failures score zero.', 'arms': arm_rows, 'comparisons': comparisons, 'completeCaseSensitivity': complete_sensitivity, 'jevUsage': usage(jev_requests), 'mainUsage': usage(main_requests), 'jevFallbacks': fallback_count, 'leapGatePassed': passed, 'ledger': ledger}

if __name__ == '__main__':
    print(json.dumps(summarize(Path(sys.argv[1]), Path(__file__).with_name('private-gold.json')), indent=2))
