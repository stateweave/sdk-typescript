import type { Model, ModelInput } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";

export type NaiveMessage = { role: "system" | "user" | "assistant"; content: string };

export type NaiveTurnResult = {
  answer: string;
  tokenEstimate: number;
  latencyMs: number;
  messageCount: number;
};

// Honest messages[] baseline: the transcript grows every turn within a batch,
// the whole thing is resent to the model each turn, and it wipes at the batch
// boundary — exactly how a real agent with no persistent memory behaves.
// Context tokens climb linearly; this is the diverging line on the chart.
export class NaiveBaselineAgent {
  private model: Model;
  private systemPrompt: string;
  private messages: NaiveMessage[] = [];
  private maxContextTokens?: number;
  readonly variant: "full" | "windowed";

  constructor(args: { model: Model; systemPrompt?: string; maxContextTokens?: number; variant?: "full" | "windowed" }) {
    this.model = args.model;
    this.systemPrompt = args.systemPrompt ?? "You are a helpful, precise coding agent. Answer concretely and remember everything discussed so far.";
    this.maxContextTokens = args.maxContextTokens;
    this.variant = args.variant ?? "full";
  }

  wipe(): void {
    this.messages = [];
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  async run(prompt: string): Promise<NaiveTurnResult> {
    const startedAt = Date.now();
    if (this.messages.length === 0) this.messages.push({ role: "system", content: this.systemPrompt });
    this.messages.push({ role: "user", content: prompt });
    if (this.maxContextTokens) this.truncate();

    const serialized = serializeMessages(this.messages);
    const input: ModelInput = { prompt: serialized, mode: "text" };
    const output = await this.model.complete(input);
    const answer = output.text.trim();
    this.messages.push({ role: "assistant", content: answer });
    if (this.maxContextTokens) this.truncate();

    return {
      answer,
      tokenEstimate: estimateStateWeaveTokens(serializeMessages(this.messages)).estimatedTokens,
      latencyMs: Date.now() - startedAt,
      messageCount: this.messages.length
    };
  }

  private truncate(): void {
    if (!this.maxContextTokens) return;
    while (this.messages.length > 2 && serializeMessages(this.messages).length / 4 > this.maxContextTokens) {
      // keep system prompt + most recent; drop oldest non-system message
      this.messages = [this.messages[0], ...this.messages.slice(2)];
    }
  }
}

export function serializeMessages(messages: NaiveMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}
