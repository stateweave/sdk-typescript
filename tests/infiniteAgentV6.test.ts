import { expect, it } from "vitest";
import { GraphFrameAgent } from "../src/agent/graphFrameAgent.js";
import { createInitialGraphFrame } from "../src/core/graph.js";
import { serializeGraphFrame } from "../src/core/serialize.js";
import { AgenticBaseline } from "../src/evals/agenticBaseline.js";
import {
  completionGatedScore,
  entitySearchIsConnected,
  summaryFrontendIsConnected,
  entityRouteBlock,
  entityRouteCount,
  INFINITE_AGENT_BLIND_PROVIDER_SYSTEM,
  orderForTurn,
  qualityValue
} from "../src/evals/infiniteAgentHarness.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";

class CapturingParticipantModel implements Model {
  systems: Array<string | undefined> = [];

  async complete(input: ModelInput): Promise<ModelOutput> {
    this.systems.push(input.system);
    return { text: "FINAL: Done." };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    this.systems.push(input.system);
    yield { type: "token", token: 'SWX/1\n@final "Done."' };
  }
}

const forbiddenIdentity = /StateWeave|\bnative\b|\bbaseline\b|\bchallenger\b|\bexperiment\b|evaluat|\bscor(?:e|ing)\b|\bgrader\b|other (?:possible )?runs?/i;

it("removes experiment and implementation identity from the blinded graph prompt", () => {
  const frame = createInitialGraphFrame({
    objective: "Maintain RelayDesk",
    systemPrompt: "You are a senior software engineer in one private RelayDesk workspace.",
    input: "Read PRODUCT.md and implement the requested route.",
    availableActions: ["read_file", "edit_file"]
  });

  const prompt = serializeGraphFrame(frame, { blindIdentity: true });

  expect(prompt).toContain("SWX/1");
  expect(prompt).toContain("graph-structured persistent working memory");
  expect(prompt).not.toMatch(forbiddenIdentity);
  expect(INFINITE_AGENT_BLIND_PROVIDER_SYSTEM).not.toMatch(forbiddenIdentity);
});

it("uses the exact same neutral provider system for both participant runtimes", async () => {
  const graphModel = new CapturingParticipantModel();
  const transcriptModel = new CapturingParticipantModel();
  const graph = new GraphFrameAgent({
    model: graphModel,
    tools: [],
    maxIterations: 2,
    systemPrompt: "Maintain RelayDesk.",
    blindIdentity: true,
    providerSystem: INFINITE_AGENT_BLIND_PROVIDER_SYSTEM
  });
  const transcript = new AgenticBaseline({
    model: transcriptModel,
    tools: [],
    systemPrompt: "Maintain RelayDesk.",
    providerSystem: INFINITE_AGENT_BLIND_PROVIDER_SYSTEM
  });

  await graph.run("Report that you are ready.");
  await transcript.run("Report that you are ready.");

  expect(graphModel.systems).toEqual([INFINITE_AGENT_BLIND_PROVIDER_SYSTEM]);
  expect(transcriptModel.systems).toEqual([INFINITE_AGENT_BLIND_PROVIDER_SYSTEM]);
});

it("balances randomized execution order inside every release block", () => {
  for (let block = 0; block < 100; block++) {
    const orders = Array.from({ length: 8 }, (_, offset) => orderForTurn(block * 8 + offset + 1, 20260713));
    expect(orders.filter((order) => order === "stateweave-first")).toHaveLength(4);
    expect(orders.filter((order) => order === "native-first")).toHaveLength(4);
  }
});

it("matches exact method routes instead of a prefix-related summary route", () => {
  const server = `
    if (url.pathname === "/api/incidents/summary" && request.method === "GET") {
      return json(response, 200, { total: 0 });
    }
    if (url.pathname === "/api/incidents" && request.method === "GET") {
      const q = url.searchParams.get("q");
      return json(response, 200, db.prepare("SELECT * FROM incidents WHERE LOWER(title) LIKE LOWER(?)").all(\`%\${q}%\`));
    }
    if (request.method === "POST" && url.pathname === "/api/incidents") {
      return json(response, 201, { ok: true });
    }
  `;

  const route = entityRouteBlock(server, "incidents", "GET");

  expect(route).toContain('searchParams.get("q")');
  expect(route).not.toContain("/api/incidents/summary");
  expect(entityRouteCount(server, "incidents", "GET")).toBe(1);
  expect(entityRouteCount(server, "incidents", "POST")).toBe(1);
  expect(entityRouteCount(server, "incidents/summary", "GET")).toBe(1);
});

it("rejects duplicate exact route handlers", () => {
  const route = 'if (url.pathname === "/api/incidents" && request.method === "GET") return json(response, 200, []);';
  expect(entityRouteCount(`${route}\n${route}`, "incidents", "GET")).toBe(2);
});

it("accepts behaviorally equivalent search and summary frontend wiring", () => {
  const searchHtml = `<form id="incident-search-form"><label for="incident-search">Search</label><input id="incident-search" type="search"></form>`;
  const submitWiring = `document.querySelector('#incident-search-form').addEventListener('submit', async (event) => { const q = document.getElementById('incident-search').value; await fetch('/api/incidents?q=' + encodeURIComponent(q)); });`;
  const summaryWiring = `const target = document.getElementById('incident-summary'); fetch('/api/incidents/summary').then(r => r.json()).then(data => target.innerHTML = render(data));`;

  expect(entitySearchIsConnected(searchHtml, submitWiring, "incident")).toBe(true);
  expect(summaryFrontendIsConnected(summaryWiring, "incidents", "incident")).toBe(true);
});

it("scores agent exhaustion as zero regardless of partial workspace checks", () => {
  const verifiedWorkspace = { score: "pass" as const, passed: 6, total: 6, details: [] as string[] };
  const completed = completionGatedScore(verifiedWorkspace, true);
  const exhausted = completionGatedScore(verifiedWorkspace, false, "Recursion limit reached");

  expect(qualityValue(completed)).toBe(1);
  expect(exhausted).toMatchObject({ score: "fail", completed: false, passed: 6, total: 6 });
  expect(qualityValue(exhausted)).toBe(0);
});
