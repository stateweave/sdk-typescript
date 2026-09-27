def gate(summary):
    checks = {}
    n = summary['cases']
    checks['completeFrozenCohort'] = n == 196
    for arm in ['standard', 'lexical']:
        comparison = summary['comparisons'][arm]
        checks[arm + '.practical'] = comparison['difference'] >= .1
        checks[arm + '.t'] = comparison['pairedT'] is not None and comparison['pairedT'] >= 2.5
        checks[arm + '.multiplicity'] = comparison['holmAdjustedP'] < .05
        checks[arm + '.positiveCI'] = comparison['ci95'][0] > 0
        value = summary['allArmsCompleteSensitivity']['differences'][arm]
        checks[arm + '.completeArmPractical'] = value is not None and value >= .1
        factual = summary['nonPreferenceSensitivity']['differences'][arm]
        checks[arm + '.nonPreferencePractical'] = factual is not None and factual >= .1
        checks[arm + '.abstention'] = summary['arms']['native']['abstentionCorrect'] >= summary['arms'][arm]['abstentionCorrect']
    for arm in ['standard', 'lexical', 'native']:
        checks[arm + '.completion'] = summary['arms'][arm]['completed'] / n >= .98
    checks['native.fallback'] = summary['arms']['native']['recallFallbacks'] / n <= .05
    checks['nonSimulated'] = not summary['accounting']['simulated']
    checks['mainIdentity'] = summary['accounting']['providers']['main']['returnedModels'] == ['glm-5.3-flash']
    checks['integrity'] = summary['integrity']['cases'] == n
    return {'passed': all(checks.values()), 'checks': checks, 'meaning': 'A pass supports this frozen corpus/model configuration only. It does not authorize merge or deployment.'}
