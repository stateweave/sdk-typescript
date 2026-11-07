export class BudgetStop extends Error {
  constructor(message) { super(message); this.name = 'BudgetStop'; }
}

export class Budget {
  constructor({ maxCalls = 600, maxTokens = 3_000_000 } = {}) {
    this.maxCalls = maxCalls;
    this.maxTokens = maxTokens;
    this.calls = 0;
    this.knownTokens = 0;
    this.unresolvedReservedTokens = 0;
    this.unknownUsageCalls = 0;
  }
  reserve(body, provider) {
    const bytes = Buffer.byteLength(JSON.stringify(body));
    const output = provider === 'zai' ? body.max_tokens : 131_072;
    if (provider === 'zai' && (!Number.isInteger(output) || output < 1 || output > 1024)) throw new BudgetStop('Invalid output cap');
    const tokens = bytes + (provider === 'zai' ? 4096 : 65_536) + output;
    if (this.calls >= this.maxCalls || this.knownTokens + this.unresolvedReservedTokens + tokens > this.maxTokens) throw new BudgetStop('Call/token ceiling would be exceeded by the next reservation');
    this.calls++;
    this.unresolvedReservedTokens += tokens;
    return tokens;
  }
  settle(reservation, usage) {
    const fields = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
    if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens) || fields.some(k => usage[k] !== undefined && (!Number.isSafeInteger(usage[k]) || usage[k] < 0))) {
      this.unknownUsageCalls++;
      throw new BudgetStop('Provider usage unavailable: reservation retained; no further calls');
    }
    const tokens = fields.reduce((sum, key) => sum + (usage[key] ?? 0), 0);
    this.knownTokens += tokens;
    this.unresolvedReservedTokens -= reservation;
    if (tokens > reservation || this.knownTokens + this.unresolvedReservedTokens > this.maxTokens) throw new BudgetStop('Reported usage exceeded its conservative reservation; stopped');
  }
  snapshot() {
    return { calls: this.calls, knownTokens: this.knownTokens, unresolvedReservedTokens: this.unresolvedReservedTokens, unknownUsageCalls: this.unknownUsageCalls, maxCalls: this.maxCalls, maxTokens: this.maxTokens };
  }
}
