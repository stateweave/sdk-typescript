import type { Model, ModelUsage } from "../llm/model.js";
import type { DualSessionView } from "./dualSessionTypes.js";

const maxTranscriptCharacters = 40_000;
const maxGeneratedPromptCharacters = 2_000;

export type LongHorizonPrompt = {
  prompt: string;
  usage?: ModelUsage;
};

export async function generateLongHorizonPrompt(model: Model, session: DualSessionView): Promise<LongHorizonPrompt> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const output = await model.complete({
      mode: "text",
      system: "You write standalone user tasks for a neutral long-horizon comparison between two agents. Follow the requested output format exactly.",
      prompt: buildLongHorizonDirectorPrompt(session),
      parameters: { maxTokens: 300, temperature: 0.9 }
    });
    try {
      const prompt = normalizeLongHorizonPrompt(output.text);
      if (session.turns.some((turn) => turn.input.trim().toLowerCase() === prompt.toLowerCase())) throw new Error("Long-horizon director repeated an existing user input.");
      return { prompt, ...(output.usage ? { usage: output.usage } : {}) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Long-horizon director could not generate a standalone prompt.");
}

export function buildLongHorizonDirectorPrompt(session: DualSessionView): string {
  const transcript = session.turns.map((turn) => [
    `TURN ${turn.turn}`,
    `USER: ${turn.input}`,
    `STATEWEAVE: ${turn.stateweave.answer ?? `[failed: ${turn.stateweave.error ?? "unknown"}]`}`,
    `TRADITIONAL: ${turn.traditional.answer ?? `[failed: ${turn.traditional.error ?? "unknown"}]`}`
  ].join("\n")).join("\n\n");
  const boundedTranscript = transcript.length > maxTranscriptCharacters ? transcript.slice(-maxTranscriptCharacters) : transcript;
  return [
    "LONG_HORIZON_DIRECTOR/1",
    "Generate exactly one new user input that will be sent unchanged to both agents.",
    "The transcript is provided only to avoid repetition and to understand the kinds of tests already used.",
    "Rules:",
    "- The input must be fully standalone and independently answerable.",
    "- Do not follow up on, reference, correct, compare, or depend on either prior answer.",
    "- Do not say 'as discussed', 'earlier', 'continue', 'update it', or refer to an existing file or artifact.",
    "- Pick a fresh generic topic. Vary among explanation, planning, writing, coding, data, creative, and self-contained file-creation tasks.",
    "- It may ask the agents to use tools, but every requirement and filename must be stated in this input.",
    "- Use 1-4 sentences and 20-120 words. Do not include a label, rationale, quotation marks, or formatting wrapper.",
    "- Return only the user input.",
    "",
    "PAIRED TRANSCRIPT:",
    boundedTranscript || "No prior turns."
  ].join("\n");
}

export function normalizeLongHorizonPrompt(value: string): string {
  let prompt = value.trim();
  const tagged = prompt.match(/<prompt>\s*([\s\S]*?)\s*<\/prompt>/i)?.[1];
  if (tagged) prompt = tagged.trim();
  prompt = prompt.replace(/^(?:FINAL|PROMPT|USER INPUT)\s*:\s*/i, "").trim();
  if ((prompt.startsWith('"') && prompt.endsWith('"')) || (prompt.startsWith("'") && prompt.endsWith("'"))) prompt = prompt.slice(1, -1).trim();
  prompt = prompt.replace(/\s+/g, " ").trim();
  if (!prompt) throw new Error("Long-horizon director returned an empty prompt.");
  if (prompt.length > maxGeneratedPromptCharacters) throw new Error("Long-horizon director prompt exceeded the 2,000-character limit.");
  if (/\b(?:as discussed|earlier|previously|previous (?:answer|message|response|task)|continue|follow[- ]?up|update it|existing (?:file|artifact)|both agents|stateweave|traditional agent|this conversation)\b/i.test(prompt)) {
    throw new Error("Long-horizon director returned a context-dependent prompt.");
  }
  return prompt;
}
