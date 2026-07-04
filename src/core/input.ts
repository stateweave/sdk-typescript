export type TaskInput = string | { input: string; objective?: string };

export type NormalizedTask = {
  objective: string;
  input: string;
};

export function normalizeTaskInput(input: TaskInput): NormalizedTask {
  if (typeof input !== "string") return { objective: input.objective ?? deriveObjective(input.input), input: input.input };
  return { objective: deriveObjective(input), input };
}

function deriveObjective(input: string): string {
  const firstLine = input.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? input.trim();
  const firstSentence = firstLine.match(/^[^.!?]+[.!?]?/)?.[0] ?? firstLine;
  return firstSentence.slice(0, 120).trim() || "StateWeave task";
}
