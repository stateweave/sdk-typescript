import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../evaluations/jev-quality-v1/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));

describe('frozen Jev quality evidence', () => {
  it('binds the complete evidence archive and retains the unsuccessful promotion gate', () => {
    const archive = readFileSync(new URL('evidence/frozen-quality-pilot.tar.gz', root));
    expect(createHash('sha256').update(archive).digest('hex')).toBe('7d0262ef5cc4ced8f62eec5bc79e2672d69df1f22975a17de14e3c5fc8921b09');
    const summary = read('summary.json');
    expect(summary.cases).toBe(32);
    expect(summary.eligiblePairedCases).toBe(30);
    expect(['baseline', 'grounding', 'recovery', 'combined'].map(name => summary.arms[name].operationalCorrect)).toEqual([30, 28, 32, 31]);
    expect(summary.arms.recovery.exactTwoSidedP).toBe(0.5);
    expect(summary.arms.combined.exactTwoSidedP).toBe(1);
    expect(summary.largeGainGate.passed).toBe(false);
    expect(summary.memoryAudit).toMatchObject({ count: 234, supported: 203, unsupported: 31, falseRejections: 20, falseAcceptances: 18 });
    expect(summary.jevPhysicalUsage).toMatchObject({ calls: 136, inputTokens: 1095598, outputTokens: 16350 });
  });

  it('does not confuse preserved completed-run invariants or no-op variation with universal success', () => {
    const audit = read('integrity.json');
    expect(audit.runRecordsAudited).toBe(128);
    expect(audit.completedRunsAudited).toBe(126);
    expect(audit.completedSourceGraphsPreserved).toBe(true);
    expect(audit.completedReadSetsAndBudgetsPreserved).toBe(true);
    expect(audit.noOpRecoveryPromptsEqual).toBe(27);
    expect(audit.noOpRecoveryPromptsCompared).toBe(27);
    const report = readFileSync(new URL('REPORT.md', root), 'utf8');
    expect(report).toContain('byte-identical');
    expect(report).toContain('did **not** retain enough detail');
    expect(report).toContain('Nothing from this experiment was deployed');
  });
});
