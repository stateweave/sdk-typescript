import { expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { z } from "zod";
import type { Model } from "../src/llm/model.js";

const respond = (text: string) => ({ complete: async () => ({ text }) }) as unknown as Model;
it("accepts a single terminal final after a no-tool model's prose preamble", async () => {
  const text = 'The source supports the assertion.\n\nFINAL: REVIEW: NONE';
  const result = await new Agent({ model: respond(text), tools: [], maxIterations: 1, enforceCompletionEvidence: false }).run("Assess assertions.");
  expect(result.finalAnswer).toBe("REVIEW: NONE");
  expect(result.trace[0]!.rawModelOutput).toBe(text);
  expect(result.trace[0]!.action).toBe("final");
});
it("accepts the ordinary structured final without stripping source output", async () => {
  const result = await new Agent({ model: respond('Brief preamble.\nFINAL {"answer":"Done."}'), tools: [], maxIterations: 1, enforceCompletionEvidence: false }).run("Assess assertions.");
  expect(result.finalAnswer).toBe("Done.");
});
it("never promotes fenced examples, multiple markers or embedded tool actions", async () => {
  for (const text of ['Example:\n```\nFINAL: NO\n```', 'Preface\nFINAL: A\nFINAL: B', 'TOOL_CALL {"name":"x","args":{}}\nFINAL: A', 'Preface mentions TOOL_CALL.\nFINAL: A', 'Preface\n> FINAL: A']) {
    await expect(new Agent({ model: respond(text), tools: [], maxIterations: 1, enforceCompletionEvidence: false }).run("Review the stored assertions.")).rejects.toThrow();
  }
});
it("does not relax the tool-enabled action boundary", async () => {
  const tool = { name: "noop", description: "No operation", schema: z.object({}), execute: async () => ({ ok: true }) };
  await expect(new Agent({ model: respond('Preface\nFINAL: Answer'), tools: [tool], maxIterations: 1, enforceCompletionEvidence: false }).run("Review the stored assertions.")).rejects.toThrow();
});
