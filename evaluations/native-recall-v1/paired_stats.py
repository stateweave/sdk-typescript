import math
import random
import statistics


def exact_p(wins, losses):
    discordant = wins + losses
    if not discordant:
        return 1.0
    return min(1.0, 2 * sum(math.comb(discordant, i) for i in range(min(wins, losses) + 1)) / 2 ** discordant)


def holm_adjust(values):
    result = {}
    previous = 0.0
    for rank, (name, value) in enumerate(sorted(values.items(), key=lambda item: (item[1], item[0]))):
        previous = max(previous, min(1.0, (len(values) - rank) * value))
        result[name] = previous
    return result


def beta_fraction(a, b, x):
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / max(d, 1e-300)
    h = d
    for m in range(1, 401):
        aa = m * (b - m) * x / ((qam + 2*m) * (a + 2*m))
        d = 1 + aa * d
        d = d if abs(d) > 1e-300 else 1e-300
        c = 1 + aa / c
        c = c if abs(c) > 1e-300 else 1e-300
        d = 1 / d
        h *= d*c
        aa = -(a+m)*(qab+m)*x/((a+2*m)*(qap+2*m))
        d = 1 + aa*d
        d = d if abs(d) > 1e-300 else 1e-300
        c = 1 + aa/c
        c = c if abs(c) > 1e-300 else 1e-300
        d = 1/d
        delta = d*c
        h *= delta
        if abs(delta-1) < 3e-14:
            return h
    raise ArithmeticError('Incomplete-beta continued fraction did not converge.')


def regularized_beta(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    factor = math.exp(math.lgamma(a+b)-math.lgamma(a)-math.lgamma(b)+a*math.log(x)+b*math.log1p(-x))
    if x < (a+1)/(a+b+2):
        return factor*beta_fraction(a,b,x)/a
    return 1-factor*beta_fraction(b,a,1-x)/b


def paired_stats(differences, groups, seed=20260927):
    assert len(differences) == len(groups) and len(differences) >= 2
    assert all(value in [-1, 0, 1] for value in differences)
    n = len(differences)
    mean = statistics.mean(differences)
    sd = statistics.stdev(differences)
    t = mean / (sd / math.sqrt(n)) if sd else (0.0 if not mean else None)
    t_p = regularized_beta((n-1)/2, .5, (n-1)/(n-1+t*t)) if t is not None else None
    wins, losses = differences.count(1), differences.count(-1)
    rng = random.Random(seed)
    strata = [[differences[index] for index, group in enumerate(groups) if group == name] for name in sorted(set(groups))]
    draws = sorted(sum(rng.choice(stratum) for stratum in strata for _ in stratum) / n for _ in range(10_000))
    return {'n': n, 'difference': mean, 'wins': wins, 'losses': losses, 'ties': n-wins-losses, 'pairedT': t, 'tDf': n-1, 'tTwoSidedP': t_p, 'exactMcNemarTwoSidedP': exact_p(wins, losses), 'ci95': [draws[249], draws[9749]], 'zeroObservedVariance': sd == 0}
