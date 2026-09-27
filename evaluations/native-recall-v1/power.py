import json
import math
import numpy as np

n, simulations = 196, 100_000
rng = np.random.default_rng(20260927)
p = np.ones((n + 1, n + 1))
for discordant in range(1, n + 1):
    cdf = [sum(math.comb(discordant, k) for k in range(i + 1)) / 2 ** discordant for i in range(discordant // 2 + 1)]
    for wins in range(discordant + 1):
        p[discordant, wins] = min(1, 2 * cdf[min(wins, discordant - wins)])
rows = []
for discordance in [.3, .5]:
    for effect in [.1, .15, .2]:
        sample = rng.multinomial(n, [(discordance + effect) / 2, (discordance - effect) / 2, 1 - discordance], size=simulations)
        wins, losses = sample[:, 0], sample[:, 1]
        mean = (wins - losses) / n
        variance = (wins + losses - n * mean ** 2) / (n - 1)
        t = np.divide(mean, np.sqrt(variance / n), out=np.zeros_like(mean), where=variance > 0)
        passed = (mean >= .1) & (t >= 2.5) & (p[wins + losses, wins] < .025)
        probability = float(passed.mean())
        rows.append({'trueDifference': effect, 'discordance': discordance, 'perComparisonStatisticalGatePower': probability, 'monteCarloStandardError': math.sqrt(probability * (1 - probability) / simulations), 'jointTwoComparisonLowerBoundIfBothMeetAssumption': max(0, 2 * probability - 1)})
print(json.dumps({'cases': n, 'simulations': simulations, 'seed': 20260927, 'scope': 'Illustrative planning over paired binary differences, not observed efficacy. Uses conservative p<.025 for each comparison instead of the less conservative Holm rule. CI, abstention, complete-arm/non-preference sensitivities, integrity and reliability gates are not simulated; overall promotion power is lower. No independence between the two comparisons is assumed for the union-bound joint lower bound. The fixed cohort is not resized.', 'rows': rows}, indent=2))
