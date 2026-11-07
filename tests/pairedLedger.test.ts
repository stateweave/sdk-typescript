import { describe, expect, it } from "vitest";

const oracleUrl = new URL("../scripts/paired-ledger/ledger.mjs", import.meta.url);
const { createEpisode, reduceEvents, queryLedger, scoreAnswer } = await import(oracleUrl.href);
const assigned = (id: string, owner: string, quota: number, active = true) =>
  ({ op: "assign", id, values: { owner, quota, active } });
const manualState = () => reduceEvents(undefined, [assigned("b", "team", 10), assigned("a", "team", 20), assigned("c", "else", 50, false)]);

describe("offline paired ledger", () => {
  it("generates exactly 60 deterministic public turns and distinct seed namespaces", () => {
    const seeds = [-1, 0, 1, 2, 2 ** 32, Number.MAX_SAFE_INTEGER];
    const namespaces: Set<string>[] = [];
    for (const seed of seeds) {
      const episode = createEpisode(seed);
      expect(episode).toEqual(createEpisode(seed));
      expect(episode.seed).toBe(seed);
      expect(episode.turns).toHaveLength(60);
      let state = reduceEvents();
      episode.turns.forEach((turn: { turn: number; input: string; expected: unknown; category: string }, index: number) => {
        expect(turn.turn).toBe(index + 1);
        expect(turn.input.length).toBeLessThan(550);
        expect(turn.input).not.toMatch(/"expected"|gold|seed|episode/i);
        const [, eventText, queryText] = /Events: (.+)\nQuery: (.+)$/.exec(turn.input)!;
        const events = JSON.parse(eventText), query = JSON.parse(queryText);
        expect(events.length).toBeLessThanOrEqual(2);
        state = reduceEvents(state, events);
        expect(turn.expected).toEqual(queryLedger(state, query));
      });
      expect(state.records.size).toBe(8);
      for (const record of state.records.values()) {
        expect(typeof record.owner).toBe("string");
        expect(typeof record.quota).toBe("number");
        expect(typeof record.active).toBe("boolean");
      }
      const ids = new Set<string>(state.records.keys());
      for (const previous of namespaces) expect([...ids].some((id) => previous.has(id))).toBe(false);
      namespaces.push(ids);
      expect(new Set(episode.turns.map((turn: { category: string }) => turn.category))).toEqual(new Set([
        "assignment", "sum", "correction", "alias-correction", "revocation", "reactivation", "alias-chain", "filtered-sum", "owner-aggregate", "owner-join", "latest",
      ]));
    }
    expect(() => createEpisode(0.5)).toThrow();
  });

  it("applies corrections in order without mutating prior state", () => {
    const before = manualState();
    const after = reduceEvents(before, [{ op: "correct", id: "a", values: { quota: 7 } }, { op: "correct", id: "a", values: { quota: 9, owner: "else" } }]);
    expect(queryLedger(before, { op: "get", id: "a", field: "quota" })).toBe(20);
    expect(queryLedger(after, { op: "get", id: "a", field: "quota" })).toBe(9);
    expect(queryLedger(after, { op: "sum", owner: "else" })).toBe(59);
    expect(queryLedger(after, { op: "latest", field: "id" })).toBe("a");
  });

  it("distinguishes revoked quotas from active-filtered quotas and reactivates", () => {
    const revoked = reduceEvents(manualState(), [{ op: "revoke", id: "a" }]);
    expect(queryLedger(revoked, { op: "get", id: "a", field: "active" })).toBe(false);
    expect(queryLedger(revoked, { op: "sum" })).toBe(80);
    expect(queryLedger(revoked, { op: "sum", active: true })).toBe(10);
    const restored = reduceEvents(revoked, [{ op: "reactivate", id: "a" }]);
    expect(queryLedger(restored, { op: "sum", active: true })).toBe(30);
  });

  it("resolves alias chains, corrections and owner joins without treating aliases as records", () => {
    const linked = reduceEvents(manualState(), [{ op: "alias", alias: "x", id: "a" }, { op: "alias", alias: "y", id: "x" }]);
    expect(queryLedger(linked, { op: "ownerSum", id: "y" })).toBe(30);
    expect(queryLedger(linked, { op: "join", id: "y", active: true })).toEqual(["a", "b"]);
    expect(queryLedger(linked, { op: "latest", field: "id" })).toBe("c");
    const corrected = reduceEvents(linked, [{ op: "correct", id: "y", values: { owner: "else", quota: 7 } }]);
    expect(queryLedger(corrected, { op: "ownerSum", id: "y" })).toBe(57);
    expect(queryLedger(corrected, { op: "ownerSum", id: "y", active: true })).toBe(7);
    const rebound = reduceEvents(corrected, [{ op: "alias", alias: "x", id: "b" }]);
    expect(queryLedger(rebound, { op: "get", id: "y", field: "quota" })).toBe(10);
    expect(() => reduceEvents(linked, [{ op: "alias", alias: "x", id: "y" }])).toThrow(/cycle/);
  });

  it("uses explicit record-event order, reassignment and empty-result semantics", () => {
    const state = reduceEvents(manualState(), [assigned("a", "else", 4, false), { op: "correct", id: "b", values: { quota: 2 } }]);
    expect(queryLedger(state, { op: "latest", owner: "else", field: "quota" })).toBe(4);
    expect(queryLedger(state, { op: "latest", active: true, field: "id" })).toBe("b");
    expect(queryLedger(state, { op: "latest", owner: "absent", field: "id" })).toBeNull();
    expect(queryLedger(state, { op: "get", id: "absent", field: "quota" })).toBeNull();
    expect(queryLedger(state, { op: "sum", owner: "absent" })).toBe(0);
    expect(queryLedger(state, { op: "join", id: "absent" })).toEqual([]);
  });
});

describe("strict final-answer scoring", () => {
  it.each([0, 12, "12", true, false, null, [], ["a", "b"]])("accepts exact JSON answers: %j", (answer) => {
    expect(scoreAnswer(JSON.stringify({ answer }), answer)).toEqual({ correct: true, parseError: false, parsed: { answer } });
  });
  it("normalizes sorted query arrays but preserves values, types and duplicates", () => {
    expect(scoreAnswer('{"answer":["b","a"]}', ["a", "b"]).correct).toBe(true);
    for (const text of ['{"answer":["a"]}', '{"answer":["a","b","b"]}', '{"answer":[1,2]}']) {
      expect(scoreAnswer(text, ["a", "b"]).correct).toBe(false);
    }
    expect(scoreAnswer('{"answer":"12"}', 12).correct).toBe(false);
    expect(scoreAnswer('{"answer":12}', "12").correct).toBe(false);
  });
  it.each(["", " ", '{"answer":', 'prefix {"answer":12}', '{"answer":12} trailing', '```json\n{"answer":12}\n```', '{"nodes":[12]}', '{"answer":12,"graph":{}}', '{}', '12', 'null', '{"answer":{"value":12}}', '{"answer":1e999}', '{"answer":11}', '{"answer":[]}'])
    ("rejects empty, malformed, partial, wrong and graph-only controls: %s", (text) => expect(scoreAnswer(text, 12).correct).toBe(false));
  it("reports syntax failures separately from valid JSON with invalid schema", () => {
    expect(scoreAnswer("", 12)).toEqual({ correct: false, parseError: true, parsed: null });
    expect(scoreAnswer('{"graph":12}', 12)).toEqual({ correct: false, parseError: false, parsed: { graph: 12 } });
  });
});
