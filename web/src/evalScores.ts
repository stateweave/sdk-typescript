export type EvalPrimitive = "regular" | "stateweave";
export type EvalVote = "a" | "b" | "both" | "neither";
export type ScoreBreakdown = { stateweave: number; regular: number; both: number; neither: number; completed: number };

export type ScoredEvalRecord = {
  a: EvalPrimitive;
  b: EvalPrimitive;
  vote?: EvalVote;
};

export function scoreEvalRecords(records: ScoredEvalRecord[]): ScoreBreakdown {
  return records.reduce<ScoreBreakdown>((scores, record) => {
    if (!record.vote) return scores;
    scores.completed += 1;

    if (record.vote === "both") {
      scores.both += 1;
    } else if (record.vote === "neither") {
      scores.neither += 1;
    } else {
      scores[record[record.vote]] += 1;
    }

    return scores;
  }, { stateweave: 0, regular: 0, both: 0, neither: 0, completed: 0 });
}
