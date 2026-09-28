export type RecallWindow = { id: string; nodeId: string; kind: string; start: number; end: number; text: string; sourcePrefix: string; lexicalScore: number };
export type RecallIndex = { sourceNodeIds: string[]; candidates: RecallWindow[]; windows: number; omittedSourceNodes: number };
export type RecallProjection = { sourceNodeIds: string[]; windows: RecallWindow[] };
export type RecallRanking = { model: string; scores: { id: string; relevance: number }[]; inputTokens: number; outputTokens: number };
export type RecallDiagnostics = { status: 'empty' | 'small_state' | 'ranked' | 'fallback'; sourceNodes: number; candidateWindows: number; selectedWindows: number; omittedSourceNodes: number; latencyMs: number; ranking?: RecallRanking; reason?: string; visibleWindowIds?: string[] };
export type JevConfiguration = { apiKey?: string; model?: string; timeoutMs?: number; fetch?: typeof fetch };
export type JevRecallClient = { rank(query: string, candidates: RecallWindow[], signal?: AbortSignal): Promise<RecallRanking> };
