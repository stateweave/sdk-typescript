export type StateWeaveTokenEstimate = {
  estimatedTokens: number;
  messageCount: 0;
};

export function estimateStateWeaveTokens(text: string): StateWeaveTokenEstimate {
  return { estimatedTokens: Math.ceil(text.length / 4), messageCount: 0 };
}
