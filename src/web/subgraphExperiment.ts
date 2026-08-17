import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CausalWeave } from "../core/causalWeave.js";
import type { CausalWeaveSnapshot } from "../core/causalTypes.js";
import type { Model, ModelOutput } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import { hardSubgraphCases } from "./subgraphHardCases.js";

export type SubgraphArm = "flat" | "compound";
export type SubgraphRunStatus = "not_started" | "running" | "done" | "error";

export type AtomStatus = "active" | "stale";
export type AtomAuthority = "runtime" | "verified" | "claim";
export type AtomSpec = { key: string; text: string; status?: AtomStatus; authority?: AtomAuthority };
export type CompoundSpec = { id: string; label: string; anchor: string; members: string[] };
export type LinkSpec = { from: string; to: string; relation: string };
export type GoldSpec = { answers: string[]; answerContains: string[]; answerExcludes?: string[]; requiredEvidence: string[]; forbiddenEvidence?: string[] };

export type SubgraphCaseSpec = {
  id: string;
  title: string;
  category: string;
  question: string;
  atoms: AtomSpec[];
  compounds: CompoundSpec[];
  links: LinkSpec[];
  gold: GoldSpec;
};

export type SubgraphArmResult = {
  arm: SubgraphArm;
  order: number;
  promptTokens: number;
  providerInputTokens?: number;
  outputTokens?: number;
  rawOutput: string;
  answer?: string;
  evidence: string[];
  formatValid: boolean;
  answerCorrect: boolean;
  evidenceComplete: boolean;
  evidenceClean: boolean;
  fullPass: boolean;
  latencyMs: number;
  providerAttempts: number;
};

export type SubgraphCaseResult = {
  id: string;
  title: string;
  category: string;
  question: string;
  goldAnswer: string;
  requiredEvidence: string[];
  order: SubgraphArm[];
  flat: SubgraphArmResult;
  compound: SubgraphArmResult;
  winner: "flat" | "compound" | "both" | "neither";
};

export type SubgraphAggregate = {
  cases: number;
  flatAnswerCorrect: number;
  compoundAnswerCorrect: number;
  flatFullPass: number;
  compoundFullPass: number;
  pairedWins: { flat: number; compound: number; tiesBoth: number; tiesNeither: number };
  averagePromptTokens: { flat: number; compound: number };
  averageLatencyMs: { flat: number; compound: number };
  pairedSignTestP: number;
  conclusion: "compound_better" | "flat_better" | "no_clear_difference";
  enoughToConclude: boolean;
  reason: string;
};

export type SubgraphExperimentState = {
  version: 3;
  experiment: "compound-node-hard-ab-v3";
  status: SubgraphRunStatus;
  provider: string;
  model: string;
  fixtureSha256: string;
  hypothesis: string;
  primitive: {
    name: "COMPOUND_WEAVE/1";
    definition: string;
    down: string;
    up: string;
    across: string;
  };
  method: string[];
  calibrationNote: string;
  plannedCases: number;
  cases: SubgraphCaseResult[];
  aggregate?: SubgraphAggregate;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

const outputInstruction = "Return exactly one line: FINAL: {\"answer\":\"<short answer>\",\"evidence\":[\"exact-evidence-key\"]}. Use only supplied evidence. Evidence keys must be copied exactly. Do not include analysis or markdown.";
const providerSystem = "You are evaluating two graph-context languages. Treat both as equally capable. Use only supplied evidence, calculate carefully, and follow the requested output format exactly.";

export class SubgraphExperimentHarness {
  private state: SubgraphExperimentState;
  private running?: Promise<void>;

  constructor(private readonly args: { model: Model; statePath: string; provider: string; modelName: string }) {
    this.state = initialState(args.provider, args.modelName);
  }

  async initialize(): Promise<void> {
    const raw = await readFile(this.args.statePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as SubgraphExperimentState;
    if (parsed.version === 3 && parsed.experiment === "compound-node-hard-ab-v3") this.state = parsed.status === "running" ? { ...parsed, status: "error", error: "The prior process stopped during the experiment." } : parsed;
  }

  publicState(): SubgraphExperimentState {
    return structuredClone(this.state);
  }

  start(): { status: number; body: { ok: boolean; state: SubgraphExperimentState; message?: string } } {
    if (this.running || this.state.status === "running") return { status: 409, body: { ok: false, state: this.publicState(), message: "Experiment is already running." } };
    if (this.state.status === "done") return { status: 200, body: { ok: true, state: this.publicState(), message: "The frozen experiment is already complete." } };
    this.state = { ...initialState(this.args.provider, this.args.modelName), status: "running", startedAt: new Date().toISOString() };
    this.running = this.run().finally(() => { this.running = undefined; });
    return { status: 202, body: { ok: true, state: this.publicState() } };
  }

  private async run(): Promise<void> {
    try {
      await this.persist();
      for (const [index, testCase] of subgraphExperimentCases().entries()) {
        const order: SubgraphArm[] = index % 2 === 0 ? ["flat", "compound"] : ["compound", "flat"];
        const results = new Map<SubgraphArm, SubgraphArmResult>();
        for (const [position, arm] of order.entries()) results.set(arm, await runArm(this.args.model, testCase, arm, position + 1));
        const flat = results.get("flat")!;
        const compound = results.get("compound")!;
        this.state.cases.push({
          id: testCase.id,
          title: testCase.title,
          category: testCase.category,
          question: testCase.question,
          goldAnswer: testCase.gold.answers[0]!,
          requiredEvidence: testCase.gold.requiredEvidence,
          order,
          flat,
          compound,
          winner: pairedWinner(flat, compound)
        });
        await this.persist();
      }
      this.state.aggregate = aggregateResults(this.state.cases);
      this.state.status = "done";
      this.state.completedAt = new Date().toISOString();
      await this.persist();
    } catch (error) {
      this.state.status = "error";
      this.state.error = error instanceof Error ? error.message : String(error);
      this.state.completedAt = new Date().toISOString();
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.args.statePath), { recursive: true });
    const temporary = `${this.args.statePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2));
    await rename(temporary, this.args.statePath);
  }
}

function initialState(provider: string, modelName = "configured default"): SubgraphExperimentState {
  return {
    version: 3,
    experiment: "compound-node-hard-ab-v3",
    status: "not_started",
    provider,
    model: modelName,
    fixtureSha256: fixtureDigest(),
    hypothesis: "A compound node that is both an outer node and an expandable subgraph will improve exact cross-context answers and evidence attribution over the current flat Causal Weave projection under the same model and evidence.",
    primitive: {
      name: "COMPOUND_WEAVE/1",
      definition: "A COMPOUND_NODE participates in the outer MAP like any node. Its EXPANDED block contains member atoms and internal bonds. PORT edges connect the compound to ordinary atoms or other compounds.",
      down: "Expand a COMPOUND_NODE into its member atoms.",
      up: "Collapse the expanded members back into the same outer node.",
      across: "Follow a PORT edge from a compound to another compound or an ordinary atom."
    },
    method: [
      "Twenty-two new difficult independent cases were frozen before the first GLM 5.3 answer; gold answers are never sent to either arm.",
      "Same provider, temperature zero, evidence atoms, causal links, question, and output contract.",
      "Flat uses the current CAUSAL_WEAVE/1 compiler. Compound uses COMPOUND_WEAVE/1 membership, expansion, and boundary ports.",
      "Arm order alternates across cases to reduce first-call bias.",
      "Deterministic semantic-token scoring checks answer correctness and exact evidence keys; no LLM judge is used.",
      "Each arm receives the same 1,024-token output ceiling and the same bounded retry policy for transient provider overloads.",
      "Explicit compound membership is the tested primitive and is not available to the flat arm.",
      "The preregistered decision statistic is the exact two-sided paired sign test over non-tied full-pass winners at alpha 0.05; this run is reported once regardless of significance."
    ],
    calibrationNote: "The prior ten-case GLM 5.2 and GLM 5.3 pilots informed difficulty design but are excluded from this confirmatory run. This is one frozen 22-case run with no optional stopping, case replacement, or rerun for significance.",
    plannedCases: subgraphExperimentCases().length,
    cases: []
  };
}

async function runArm(model: Model, testCase: SubgraphCaseSpec, arm: SubgraphArm, order: number): Promise<SubgraphArmResult> {
  const prompt = arm === "flat" ? compileFlat(testCase) : compileCompound(testCase);
  const started = performance.now();
  const { output, attempts } = await completeWithRetry(model, prompt);
  const latencyMs = Math.round(performance.now() - started);
  return { ...scoreOutput(testCase, arm, order, prompt, output, latencyMs), providerAttempts: attempts };
}

async function completeWithRetry(model: Model, prompt: string): Promise<{ output: ModelOutput; attempts: number }> {
  const delays = [10_000, 30_000, 60_000];
  for (let attempt = 1; attempt <= delays.length + 1; attempt += 1) {
    try {
      const output = await model.complete({ prompt, mode: "text", system: providerSystem, parameters: { temperature: 0, maxTokens: 1_024 } });
      return { output, attempts: attempt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt > delays.length || !/\b(?:429|529)\b|overload|temporar/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
    }
  }
  throw new Error("Provider retry loop ended unexpectedly.");
}

export function compileFlat(testCase: SubgraphCaseSpec): string {
  const snapshot = buildSnapshot(testCase);
  const compiled = new CausalWeave(snapshot).compile({ query: testCase.question, maxTokens: 12_000, targetTokens: 8_000, maxNodes: 48 });
  return `${compiled.prompt}\n\nOUTPUT CONTRACT\n${outputInstruction}`;
}

export function compileCompound(testCase: SubgraphCaseSpec): string {
  const selected = selectCompounds(testCase);
  const memberOwners = compoundOwners(testCase.compounds);
  const relevantOrdinary = new Set<string>();
  for (const link of testCase.links) {
    const fromOwner = endpointCompound(link.from, memberOwners, testCase.compounds);
    const toOwner = endpointCompound(link.to, memberOwners, testCase.compounds);
    if (fromOwner && selected.has(fromOwner) && !toOwner) relevantOrdinary.add(link.to);
    if (toOwner && selected.has(toOwner) && !fromOwner) relevantOrdinary.add(link.from);
  }
  for (const atom of testCase.atoms) if (!memberOwners.has(atom.key) && queryScore(`${atom.key} ${atom.text}`, testCase.question) > 0) relevantOrdinary.add(atom.key);

  const lines = [
    "COMPOUND_WEAVE/1",
    "This is one graph at two resolutions. A COMPOUND_NODE is a normal node in MAP and an expandable subgraph in EXPANDED. PORT edges may connect a compound to another compound or to an ordinary ATOM.",
    "Use only visible atoms. Status=active overrides status=stale. authority=verified outranks authority=claim.",
    "",
    "<MAP>"
  ];
  for (const compound of testCase.compounds) lines.push(`COMPOUND_NODE ${compound.id} label=${quoted(compound.label)} members=${compound.members.length}${selected.has(compound.id) ? " EXPANDED" : ""}`);
  for (const key of relevantOrdinary) {
    const atom = atomByKey(testCase, key);
    if (atom) lines.push(renderAtom(atom, "ATOM"));
  }
  for (const link of testCase.links) {
    const from = endpointCompound(link.from, memberOwners, testCase.compounds) ?? `atom:${link.from}`;
    const to = endpointCompound(link.to, memberOwners, testCase.compounds) ?? `atom:${link.to}`;
    lines.push(`PORT ${from} --${link.relation}--> ${to}`);
  }
  lines.push("</MAP>", "");

  const renderedAtoms = new Set<string>();
  for (const compound of testCase.compounds.filter((candidate) => selected.has(candidate.id))) {
    lines.push(`<EXPANDED id=${quoted(compound.id)} label=${quoted(compound.label)}>`);
    for (const key of compound.members) {
      const atom = atomByKey(testCase, key);
      if (!atom) continue;
      if (renderedAtoms.has(key)) lines.push(`ATOM_REF ${key}`);
      else {
        lines.push(renderAtom(atom, "ATOM"));
        renderedAtoms.add(key);
      }
    }
    for (const link of testCase.links) {
      if (compound.members.includes(link.from) && compound.members.includes(link.to)) lines.push(`BOND atom:${link.from} --${link.relation}--> atom:${link.to}`);
    }
    lines.push("</EXPANDED>", "");
  }

  lines.push("<QUESTION>", testCase.question, "</QUESTION>", "", "OUTPUT CONTRACT", outputInstruction);
  const prompt = lines.join("\n");
  if (estimateStateWeaveTokens(prompt).estimatedTokens > 12_000) throw new Error(`Compound prompt exceeded budget for ${testCase.id}.`);
  return prompt;
}

export function subgraphExperimentCases(): SubgraphCaseSpec[] {
  return hardSubgraphCases().map((testCase, index) => addDistractors(testCase, index));
}

function addDistractors(testCase: SubgraphCaseSpec, caseIndex: number): SubgraphCaseSpec {
  const next = structuredClone(testCase);
  for (let group = 0; group < 8; group += 1) {
    const id = `cmp_noise_${caseIndex}_${group}`;
    const anchorKey = `noise_${caseIndex}_${group}_anchor`;
    const members = [anchorKey];
    next.atoms.push(atom(anchorKey, `Archived unrelated record group ${group + 1}; never part of a named active project.`, "stale", "claim"));
    for (let item = 0; item < 5; item += 1) {
      const key = `noise_${caseIndex}_${group}_${item}`;
      members.push(key);
      next.atoms.push(atom(key, `Archived value ${caseIndex * 100 + group * 10 + item}; do not use for a current named-project answer.`, "stale", "claim"));
    }
    next.compounds.push(compound(id, `Unrelated archive ${group + 1}`, anchorKey, members));
  }
  return next;
}

function buildSnapshot(testCase: SubgraphCaseSpec): CausalWeaveSnapshot {
  const weave = new CausalWeave();
  const system = weave.append({ kind: "system", payload: outputInstruction, parents: [], advance: false });
  const ids = new Map<string, string>();
  const anchors = new Set(testCase.compounds.map((compoundSpec) => compoundSpec.anchor));
  for (const atomSpec of testCase.atoms.filter((candidate) => anchors.has(candidate.key))) {
    const node = weave.append({ kind: "semantic", payload: atomPayload(atomSpec), parents: [system.id], advance: false });
    ids.set(atomSpec.key, node.id);
  }
  const owners = compoundOwners(testCase.compounds);
  for (const atomSpec of testCase.atoms.filter((candidate) => !anchors.has(candidate.key))) {
    const parents = [...(owners.get(atomSpec.key) ?? [])].map((owner) => ids.get(testCase.compounds.find((compoundSpec) => compoundSpec.id === owner)!.anchor)!).filter(Boolean);
    const node = weave.append({ kind: "semantic", payload: atomPayload(atomSpec), parents: parents.length ? parents : [system.id], advance: false });
    ids.set(atomSpec.key, node.id);
  }
  for (const [index, link] of testCase.links.entries()) {
    const from = ids.get(link.from);
    const to = ids.get(link.to);
    if (!from || !to) continue;
    weave.append({
      kind: "semantic",
      payload: { type: "relation", key: `relation-${index}`, content: `${link.from} ${link.relation} ${link.to}`, evidenceKey: `relation_${index}`, relation: link.relation },
      parents: [from, to],
      advance: false
    });
  }
  weave.append({ kind: "goal", payload: testCase.question, parents: [system.id], advance: true });
  return weave.snapshot();
}

function selectCompounds(testCase: SubgraphCaseSpec): Set<string> {
  const ranked = testCase.compounds
    .map((compoundSpec) => ({ id: compoundSpec.id, score: queryScore(`${compoundSpec.label} ${atomByKey(testCase, compoundSpec.anchor)?.text ?? ""}`, testCase.question) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = new Set(ranked.filter((candidate) => candidate.score > 0).slice(0, 3).map((candidate) => candidate.id));
  if (!selected.size && ranked[0]) selected.add(ranked[0].id);
  const owners = compoundOwners(testCase.compounds);
  for (let hop = 0; hop < 2 && selected.size < 4; hop += 1) {
    for (const link of testCase.links) {
      const from = endpointCompound(link.from, owners, testCase.compounds);
      const to = endpointCompound(link.to, owners, testCase.compounds);
      if (from && selected.has(from) && to) selected.add(to);
      if (to && selected.has(to) && from) selected.add(from);
      if (selected.size >= 4) break;
    }
  }
  return selected;
}

function queryScore(value: string, query: string): number {
  const queryTerms = terms(query);
  const valueTerms = terms(value);
  let score = 0;
  for (const term of queryTerms) if (valueTerms.has(term)) score += term.length >= 6 ? 3 : 1;
  return score;
}

function terms(value: string): Set<string> {
  const stop = new Set(["what", "which", "after", "before", "current", "give", "from", "with", "into", "have", "does", "their", "those", "across", "including", "required", "total", "validated"]);
  return new Set((value.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []).filter((term) => !stop.has(term)));
}

function compoundOwners(compounds: CompoundSpec[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const compoundSpec of compounds) {
    for (const member of compoundSpec.members) owners.set(member, [...(owners.get(member) ?? []), compoundSpec.id]);
  }
  return owners;
}

function endpointCompound(key: string, owners: Map<string, string[]>, compounds: CompoundSpec[]): string | undefined {
  if (compounds.some((compoundSpec) => compoundSpec.id === key)) return key;
  return owners.get(key)?.[0];
}

function atomPayload(atomSpec: AtomSpec): Record<string, unknown> {
  return {
    type: "fact",
    key: atomSpec.key,
    evidenceKey: atomSpec.key,
    status: atomSpec.status ?? "active",
    authority: atomSpec.authority ?? "runtime",
    content: atomSpec.text
  };
}

function renderAtom(atomSpec: AtomSpec, prefix: string): string {
  return `${prefix} ${atomSpec.key} status=${atomSpec.status ?? "active"} authority=${atomSpec.authority ?? "runtime"} text=${quoted(atomSpec.text)}`;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function atomByKey(testCase: SubgraphCaseSpec, key: string): AtomSpec | undefined {
  return testCase.atoms.find((atomSpec) => atomSpec.key === key);
}

function atom(key: string, text: string, status: AtomStatus = "active", authority: AtomAuthority = "runtime"): AtomSpec {
  return { key, text, status, authority };
}

function compound(id: string, label: string, anchor: string, members: string[]): CompoundSpec {
  return { id, label, anchor, members };
}

export function scoreOutput(testCase: SubgraphCaseSpec, arm: SubgraphArm, order: number, prompt: string, output: ModelOutput, latencyMs: number): SubgraphArmResult {
  const parsed = parseFinal(output.text);
  const evidence = parsed?.evidence ?? [];
  const answerCorrect = Boolean(parsed && semanticAnswerMatch(parsed.answer, testCase.gold));
  const evidenceSet = new Set(evidence);
  const evidenceComplete = testCase.gold.requiredEvidence.every((key) => evidenceSet.has(key));
  const evidenceClean = !(testCase.gold.forbiddenEvidence ?? []).some((key) => evidenceSet.has(key));
  return {
    arm,
    order,
    promptTokens: estimateStateWeaveTokens(prompt).estimatedTokens,
    ...(output.usage ? { providerInputTokens: output.usage.inputTokens, outputTokens: output.usage.outputTokens } : {}),
    rawOutput: output.text,
    answer: parsed?.answer,
    evidence,
    formatValid: Boolean(parsed),
    answerCorrect,
    evidenceComplete,
    evidenceClean,
    fullPass: answerCorrect && evidenceComplete && evidenceClean,
    latencyMs,
    providerAttempts: 1
  };
}

function parseFinal(value: string): { answer: string; evidence: string[] } | undefined {
  const marker = value.match(/FINAL\s*:\s*/i);
  if (!marker || marker.index === undefined) return undefined;
  const remainder = value.slice(marker.index + marker[0].length).trim();
  const start = remainder.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < remainder.length; index += 1) {
    const character = remainder[index]!;
    if (escaped) { escaped = false; continue; }
    if (quoted && character === "\\") { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(remainder.slice(start, index + 1)) as { answer?: unknown; evidence?: unknown };
        if (typeof parsed.answer !== "string" || !Array.isArray(parsed.evidence)) return undefined;
        const evidence = parsed.evidence.filter((item): item is string => typeof item === "string");
        return { answer: parsed.answer.trim(), evidence };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function semanticAnswerMatch(value: string, gold: GoldSpec): boolean {
  const tokens = answerTokens(value);
  return gold.answerContains.every((term) => tokens.has(term.toLowerCase()))
    && !(gold.answerExcludes ?? []).some((term) => tokens.has(term.toLowerCase()));
}

function answerTokens(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/\bone\b/g, "1");
  return new Set(normalized.match(/[a-z0-9]+/g) ?? []);
}

function pairedWinner(flat: SubgraphArmResult, compound: SubgraphArmResult): SubgraphCaseResult["winner"] {
  if (flat.fullPass && compound.fullPass) return "both";
  if (flat.fullPass) return "flat";
  if (compound.fullPass) return "compound";
  if (flat.answerCorrect && compound.answerCorrect) return "both";
  if (flat.answerCorrect) return "flat";
  if (compound.answerCorrect) return "compound";
  return "neither";
}

function aggregateResults(results: SubgraphCaseResult[]): SubgraphAggregate {
  const pairedWins = {
    flat: results.filter((result) => result.winner === "flat").length,
    compound: results.filter((result) => result.winner === "compound").length,
    tiesBoth: results.filter((result) => result.winner === "both").length,
    tiesNeither: results.filter((result) => result.winner === "neither").length
  };
  const flatFullPass = results.filter((result) => result.flat.fullPass).length;
  const compoundFullPass = results.filter((result) => result.compound.fullPass).length;
  const advantage = pairedWins.compound - pairedWins.flat;
  const pairedSignTestP = twoSidedSignTest(pairedWins.compound, pairedWins.flat);
  const enoughToConclude = advantage !== 0 && pairedSignTestP <= 0.05;
  const conclusion = advantage >= 2 ? "compound_better" : advantage <= -2 ? "flat_better" : "no_clear_difference";
  return {
    cases: results.length,
    flatAnswerCorrect: results.filter((result) => result.flat.answerCorrect).length,
    compoundAnswerCorrect: results.filter((result) => result.compound.answerCorrect).length,
    flatFullPass,
    compoundFullPass,
    pairedWins,
    averagePromptTokens: { flat: average(results.map((result) => result.flat.promptTokens)), compound: average(results.map((result) => result.compound.promptTokens)) },
    averageLatencyMs: { flat: average(results.map((result) => result.flat.latencyMs)), compound: average(results.map((result) => result.compound.latencyMs)) },
    pairedSignTestP,
    conclusion,
    enoughToConclude,
    reason: enoughToConclude
      ? `The non-tied paired result favors ${advantage > 0 ? "the compound primitive" : "the flat primitive"} with an exact two-sided sign-test p-value of ${pairedSignTestP.toFixed(4)}. This is enough to justify a larger preregistered follow-up, not immediate product promotion.`
      : `The exact two-sided paired sign-test p-value is ${pairedSignTestP.toFixed(4)}. This frozen ${results.length}-case run does not provide enough separation at alpha 0.05; report the null result without adding or replacing cases.`
  };
}

function twoSidedSignTest(compoundWins: number, flatWins: number): number {
  const n = compoundWins + flatWins;
  if (!n) return 1;
  const extreme = Math.min(compoundWins, flatWins);
  let tail = 0;
  for (let successes = 0; successes <= extreme; successes += 1) tail += chooseCount(n, successes) / 2 ** n;
  return Math.min(1, Number((2 * tail).toFixed(6)));
}

function chooseCount(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - index + 1) / index;
  return result;
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

export function fixtureDigest(): string {
  return createHash("sha256").update(JSON.stringify(subgraphExperimentCases())).digest("hex");
}
