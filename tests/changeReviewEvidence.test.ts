import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'evaluations/change-impact-v3');
const json = (name: string) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('preserved change-review evidence', () => {
  it('binds frozen inputs and every evidence chunk without provider calls', () => {
    const summary = json('summary.json');
    expect(summary.manifest.offline).toBe(false);
    expect(summary.manifest.commit).toBe('f9ac05b5d4873fcffef5c81a3e29f3e3ac9b728b');
    for (const [name, hash] of Object.entries(summary.manifest.files)) {
      expect(sha(readFileSync(join(root, name)))).toBe(hash);
    }
    expect(sha(readFileSync(join(root, 'private-gold.json')))).toBe(summary.manifest.privateGoldSha256);
    const manifest = json('evidence/manifest.json');
    const combined = createHash('sha256');
    let size = 0;
    for (const part of manifest.parts) {
      const bytes = readFileSync(join(root, 'evidence', part.file));
      expect(bytes.length).toBe(part.bytes);
      expect(sha(bytes)).toBe(part.sha256);
      combined.update(bytes);
      size += bytes.length;
    }
    expect(size).toBe(95119164);
    expect(combined.digest('hex')).toBe(manifest.archiveSha256);
    expect(sha(readFileSync(join(root, 'evidence/frozen-runtime.tar.gz')))).toBe(manifest.runtimeSha256);
  });

  it('retains the failed practical gate despite significant primary comparisons', () => {
    const summary = json('summary.json');
    expect(summary.leapGatePassed).toBe(false);
    expect(summary.comparisons.standard.difference).toBeCloseTo(0.08810797046091164, 12);
    expect(summary.comparisons.lexical.difference).toBeCloseTo(0.061879297173414824, 12);
    expect(summary.comparisons.standard.primaryOneSidedP).toBeLessThan(0.025);
    expect(summary.comparisons.lexical.primaryOneSidedP).toBeLessThan(0.025);
    expect(summary.comparisons.lexical.pairedT).toBeLessThan(3);
    expect(summary.completeCaseSensitivity.lexical.n).toBe(113);
    expect(summary.completeCaseSensitivity.lexical.primaryOneSidedP).toBe(0.3125);
    expect(summary.jevFallbacks).toBe(2);
  });

  it('preserves operational failures, unknown usage and sidecar limitations', () => {
    const accounting = json('accounting.json');
    expect(accounting.startedArms).toBe(512);
    expect(accounting.terminalStatuses).toEqual({ done: 488, failed: 24 });
    expect(accounting.unreturnedArms).toBe(0);
    expect(accounting.requestsWithoutCompleteUsage).toHaveLength(12);
    expect(accounting.providers.main.maxReportedInputTokens).toBe(23344);
    const diagnostics = json('diagnostics.json');
    expect(diagnostics.counts.goldInCandidate64).toBe(55);
    expect(diagnostics.counts.nomineeTP).toBe(37);
    expect(diagnostics.counts.nomineeFP).toBe(6);
    expect(diagnostics.counts.nomineeFN).toBe(18);
    expect(diagnostics.noOpPairs).toHaveLength(79);
    expect(diagnostics.noOpPairs.every((row: { identicalFirstPrompt: boolean }) => row.identicalFirstPrompt)).toBe(true);
    expect(diagnostics.failureDiagnostics).toHaveLength(24);
    expect(diagnostics.failureDiagnostics.filter((row: { category: string }) => row.category === 'two_output_limit_responses_without_final_text')).toHaveLength(14);
    const attempts = json('all-attempts.json');
    expect(attempts.v1_engineering_abort.unreturnedArms).toBe(2);
    expect(attempts.v2_rate_limited_abort.unreturnedArms).toBe(4);
  });

  it('separates recorded-path replay from a new live efficacy claim', () => {
    const replay = json('lifecycle-live-record-replay.json');
    expect(replay.sourceEvidenceOffline).toBe(false);
    expect(replay.networkCalls).toBe(0);
    expect(replay.candidateRuntime).not.toEqual(replay.frozenRuntime);
    expect(replay.frozenRuntime).toEqual(json('summary.json').manifest.runtime);
    expect(replay.replayed).toBe(125);
    expect(replay.skipped).toHaveLength(3);
    expect(replay.recordedTracesReproduced).toBe(true);
    expect(replay.allTracesStatesAndAnswersIdentical).toBe(true);
    const audit = json('integrity.json');
    expect(audit.counts.completedSourcePrefixesAndReadSetsAudited).toBe(488);
    expect(audit.counts.fullLedgersAudited).toBe(122);
    expect(audit.counts.visibleNominees).toBe(42);
  });
});
