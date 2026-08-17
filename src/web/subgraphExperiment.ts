import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CausalWeave } from "../core/causalWeave.js";
import type { CausalWeaveSnapshot } from "../core/causalTypes.js";
import type { Model, ModelOutput } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";

export type SubgraphArm = "flat" | "compound";
export type SubgraphRunStatus = "not_started" | "running" | "done" | "error";

type AtomStatus = "active" | "stale";
type AtomAuthority = "runtime" | "verified" | "claim";
type AtomSpec = { key: string; text: string; status?: AtomStatus; authority?: AtomAuthority };
type CompoundSpec = { id: string; label: string; anchor: string; members: string[] };
type LinkSpec = { from: string; to: string; relation: string };
type GoldSpec = { answers: string[]; requiredEvidence: string[]; forbiddenEvidence?: string[] };

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
  version: 1;
  experiment: "compound-node-ab-v1";
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
    if (parsed.version === 1 && parsed.experiment === "compound-node-ab-v1") this.state = parsed.status === "running" ? { ...parsed, status: "error", error: "The prior process stopped during the experiment." } : parsed;
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
    version: 1,
    experiment: "compound-node-ab-v1",
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
      "Ten independent cases; gold answers are never sent to either arm.",
      "Same provider, temperature zero, evidence atoms, causal links, question, and output contract.",
      "Flat uses the current CAUSAL_WEAVE/1 compiler. Compound uses COMPOUND_WEAVE/1 membership, expansion, and boundary ports.",
      "Arm order alternates across cases to reduce first-call bias.",
      "Deterministic scoring checks answer correctness and exact evidence keys; no LLM judge is used.",
      "Explicit compound membership is the tested primitive and is not available to the flat arm."
    ],
    cases: []
  };
}

async function runArm(model: Model, testCase: SubgraphCaseSpec, arm: SubgraphArm, order: number): Promise<SubgraphArmResult> {
  const prompt = arm === "flat" ? compileFlat(testCase) : compileCompound(testCase);
  const started = performance.now();
  const output = await model.complete({ prompt, mode: "text", system: providerSystem, parameters: { temperature: 0, maxTokens: 320 } });
  const latencyMs = Math.round(performance.now() - started);
  return scoreOutput(testCase, arm, order, prompt, output, latencyMs);
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
  return baseCases().map((testCase, index) => addDistractors(testCase, index));
}

function baseCases(): SubgraphCaseSpec[] {
  return [
    {
      id: "nested-sibling-join",
      title: "Sibling facts inside one compound",
      category: "within-compound synthesis",
      question: "For the Orchard release, how many sensors ship and to which city?",
      atoms: [
        atom("orchard_anchor", "Authoritative record for the Orchard release."),
        atom("orchard_city", "The destination city is Kyoto."),
        atom("orchard_crates", "The approved current crate count is 18."),
        atom("orchard_units", "Each crate contains 24 sensors."),
        atom("orchard_crates_draft", "An obsolete draft proposed 20 crates.", "stale", "claim")
      ],
      compounds: [compound("cmp_orchard", "Orchard release", "orchard_anchor", ["orchard_anchor", "orchard_city", "orchard_crates", "orchard_units", "orchard_crates_draft"])],
      links: [{ from: "orchard_crates_draft", to: "orchard_crates", relation: "superseded_by" }],
      gold: { answers: ["432 sensors to Kyoto", "432 to Kyoto"], requiredEvidence: ["orchard_city", "orchard_crates", "orchard_units"], forbiddenEvidence: ["orchard_crates_draft"] }
    },
    {
      id: "compound-to-atom-port",
      title: "Compound connected to an ordinary atom",
      category: "boundary traversal",
      question: "What is the minimum fuel budget for the Cedar trip, including reserve?",
      atoms: [
        atom("cedar_anchor", "Authoritative plan for the Cedar trip."),
        atom("cedar_distance", "Trip distance is 540 kilometers."),
        atom("cedar_efficiency", "Vehicle efficiency is 12 kilometers per liter."),
        atom("cedar_reserve", "Required fuel reserve is 5 liters."),
        atom("fuel_price", "Current fuel price is 1.80 dollars per liter.", "active", "verified")
      ],
      compounds: [compound("cmp_cedar", "Cedar trip", "cedar_anchor", ["cedar_anchor", "cedar_distance", "cedar_efficiency", "cedar_reserve"])],
      links: [{ from: "cedar_reserve", to: "fuel_price", relation: "priced_by" }],
      gold: { answers: ["$90", "90 dollars", "90"], requiredEvidence: ["cedar_distance", "cedar_efficiency", "cedar_reserve", "fuel_price"] }
    },
    {
      id: "compound-to-compound-join",
      title: "Crossing between two compounds",
      category: "cross-compound synthesis",
      question: "For Nimbus, choose the team with the higher score, then give its total capacity and deadline.",
      atoms: [
        atom("nimbus_selection_anchor", "Nimbus team selection board."),
        atom("nimbus_alpha_score", "Team Alpha score is 17."),
        atom("nimbus_beta_score", "Team Beta score is 22."),
        atom("nimbus_capacity_anchor", "Nimbus capacity schedule."),
        atom("nimbus_capacity_base", "Base capacity is 15 units."),
        atom("nimbus_alpha_multiplier", "Team Alpha multiplier is 3."),
        atom("nimbus_beta_multiplier", "Team Beta multiplier is 4."),
        atom("nimbus_deadline", "The capacity deadline is Tuesday.")
      ],
      compounds: [
        compound("cmp_nimbus_selection", "Nimbus team selection", "nimbus_selection_anchor", ["nimbus_selection_anchor", "nimbus_alpha_score", "nimbus_beta_score"]),
        compound("cmp_nimbus_capacity", "Nimbus capacity", "nimbus_capacity_anchor", ["nimbus_capacity_anchor", "nimbus_capacity_base", "nimbus_alpha_multiplier", "nimbus_beta_multiplier", "nimbus_deadline"])
      ],
      links: [{ from: "nimbus_selection_anchor", to: "nimbus_capacity_anchor", relation: "feeds" }],
      gold: { answers: ["60 units, Tuesday", "60, Tuesday", "Team Beta: 60 units by Tuesday"], requiredEvidence: ["nimbus_alpha_score", "nimbus_beta_score", "nimbus_capacity_base", "nimbus_beta_multiplier", "nimbus_deadline"] }
    },
    {
      id: "supersession-through-port",
      title: "Current value over stale history",
      category: "supersession",
      question: "What is Harbor's current holiday processing cap in orders per day?",
      atoms: [
        atom("harbor_anchor", "Harbor processing policy."),
        atom("harbor_limit_old", "The former cap was 80 orders per day.", "stale", "verified"),
        atom("harbor_limit_current", "The current cap is 65 orders per day.", "active", "verified"),
        atom("holiday_factor", "The holiday operating factor is 0.8.", "active", "verified")
      ],
      compounds: [compound("cmp_harbor", "Harbor policy", "harbor_anchor", ["harbor_anchor", "harbor_limit_old", "harbor_limit_current"])],
      links: [
        { from: "harbor_limit_old", to: "harbor_limit_current", relation: "superseded_by" },
        { from: "harbor_limit_current", to: "holiday_factor", relation: "scaled_by" }
      ],
      gold: { answers: ["52 orders per day", "52"], requiredEvidence: ["harbor_limit_current", "holiday_factor"], forbiddenEvidence: ["harbor_limit_old"] }
    },
    {
      id: "shared-atom-overlap",
      title: "One atom shared by two compounds",
      category: "overlapping membership",
      question: "For the Glassline route, is the operating temperature safe after the required margin, and by how much?",
      atoms: [
        atom("glass_design_anchor", "Glassline vessel design."),
        atom("glass_material", "The vessel material is borosilicate."),
        atom("glass_max_temp", "Maximum allowed material temperature is 180 Celsius.", "active", "verified"),
        atom("glass_route_anchor", "Glassline operating route."),
        atom("glass_operating_temp", "Expected operating temperature is 155 Celsius.", "active", "verified"),
        atom("glass_safety_margin", "Required safety margin is 20 Celsius.", "active", "verified")
      ],
      compounds: [
        compound("cmp_glass_design", "Glassline design", "glass_design_anchor", ["glass_design_anchor", "glass_material", "glass_max_temp", "glass_safety_margin"]),
        compound("cmp_glass_route", "Glassline route", "glass_route_anchor", ["glass_route_anchor", "glass_operating_temp", "glass_safety_margin"])
      ],
      links: [{ from: "glass_design_anchor", to: "glass_route_anchor", relation: "constrains" }],
      gold: { answers: ["Yes, safe by 5 Celsius", "safe by 5 C", "yes, 5 Celsius"], requiredEvidence: ["glass_max_temp", "glass_operating_temp", "glass_safety_margin"] }
    },
    {
      id: "verified-contradiction",
      title: "Verified evidence defeats a conflicting claim",
      category: "authority and contradiction",
      question: "After the Quartz outbound shipment, what is the verified remaining inventory?",
      atoms: [
        atom("quartz_anchor", "Quartz inventory audit."),
        atom("quartz_claim_count", "A manager claimed inventory was 240 units.", "active", "claim"),
        atom("quartz_verified_count", "The verified physical count is 228 units.", "active", "verified"),
        atom("quartz_outbound", "The confirmed outbound shipment contains 28 units.", "active", "verified")
      ],
      compounds: [compound("cmp_quartz", "Quartz audit", "quartz_anchor", ["quartz_anchor", "quartz_claim_count", "quartz_verified_count"])],
      links: [
        { from: "quartz_claim_count", to: "quartz_verified_count", relation: "contradicted_by" },
        { from: "quartz_verified_count", to: "quartz_outbound", relation: "reduced_by" }
      ],
      gold: { answers: ["200 units", "200"], requiredEvidence: ["quartz_verified_count", "quartz_outbound"], forbiddenEvidence: ["quartz_claim_count"] }
    },
    {
      id: "chronology-across-compounds",
      title: "Current chronology across compounds",
      category: "temporal traversal",
      question: "Did certification arrive before the current Meridian launch, and by how many days?",
      atoms: [
        atom("meridian_terms_anchor", "Meridian launch terms."),
        atom("meridian_launch_old", "The initial launch day was Monday.", "stale", "verified"),
        atom("meridian_launch_current", "The current launch day is Wednesday.", "active", "verified"),
        atom("meridian_cert_anchor", "Meridian certification schedule."),
        atom("meridian_cert_arrival", "Certification arrives Tuesday.", "active", "verified")
      ],
      compounds: [
        compound("cmp_meridian_terms", "Meridian launch", "meridian_terms_anchor", ["meridian_terms_anchor", "meridian_launch_old", "meridian_launch_current"]),
        compound("cmp_meridian_cert", "Meridian certification", "meridian_cert_anchor", ["meridian_cert_anchor", "meridian_cert_arrival"])
      ],
      links: [
        { from: "meridian_launch_old", to: "meridian_launch_current", relation: "superseded_by" },
        { from: "meridian_cert_anchor", to: "meridian_terms_anchor", relation: "gates" }
      ],
      gold: { answers: ["Yes, by 1 day", "yes, one day", "1 day before"], requiredEvidence: ["meridian_launch_current", "meridian_cert_arrival"], forbiddenEvidence: ["meridian_launch_old"] }
    },
    {
      id: "resource-lineage",
      title: "Resource result connected to an external benchmark",
      category: "resource lineage",
      question: "After the parser change, how many benchmark cases are unaffected by the remaining errors?",
      atoms: [
        atom("parser_anchor", "Parser change result."),
        atom("parser_errors_before", "Before the change there were 14 remaining errors.", "stale", "verified"),
        atom("parser_errors_after", "After the change there are 5 remaining errors.", "active", "verified"),
        atom("parser_cases_per_error", "Each remaining error affects 2 benchmark cases.", "active", "verified"),
        atom("benchmark_population", "The benchmark contains 300 cases.", "active", "verified")
      ],
      compounds: [compound("cmp_parser", "Parser change", "parser_anchor", ["parser_anchor", "parser_errors_before", "parser_errors_after", "parser_cases_per_error"])],
      links: [{ from: "parser_anchor", to: "benchmark_population", relation: "measured_against" }],
      gold: { answers: ["290 cases", "290"], requiredEvidence: ["parser_errors_after", "parser_cases_per_error", "benchmark_population"], forbiddenEvidence: ["parser_errors_before"] }
    },
    {
      id: "revoked-membership",
      title: "Revocation inside an access compound",
      category: "revocation",
      question: "Who currently has Meridian lab access?",
      atoms: [
        atom("access_anchor", "Meridian access plan."),
        atom("access_alice_grant", "Alice was granted lab access.", "stale", "verified"),
        atom("access_alice_revoke", "Alice's lab access was revoked.", "active", "verified"),
        atom("access_bob_archive", "Bob has archive access only.", "active", "verified"),
        atom("access_carol_lab", "Carol has active lab access.", "active", "verified")
      ],
      compounds: [compound("cmp_access", "Meridian access", "access_anchor", ["access_anchor", "access_alice_grant", "access_alice_revoke", "access_bob_archive", "access_carol_lab"])],
      links: [{ from: "access_alice_grant", to: "access_alice_revoke", relation: "revoked_by" }],
      gold: { answers: ["Carol", "Carol only"], requiredEvidence: ["access_alice_revoke", "access_carol_lab"] }
    },
    {
      id: "three-compound-aggregation",
      title: "Aggregation across three compounds",
      category: "global synthesis",
      question: "What is the total validated shipment count across Atlas East, Atlas West, and Atlas North after recalls and damage?",
      atoms: [
        atom("atlas_east_anchor", "Atlas East shipment."),
        atom("atlas_east_shipped", "Atlas East shipped 12 validated units.", "active", "verified"),
        atom("atlas_east_recalled", "Atlas East recalled 2 of those units.", "active", "verified"),
        atom("atlas_west_anchor", "Atlas West shipment."),
        atom("atlas_west_shipped", "Atlas West shipped 9 validated units.", "active", "verified"),
        atom("atlas_west_pending", "One separate Atlas West unit is pending and excluded from the validated count.", "active", "verified"),
        atom("atlas_north_anchor", "Atlas North shipment."),
        atom("atlas_north_shipped", "Atlas North shipped 8 validated units.", "active", "verified"),
        atom("atlas_north_damaged", "Atlas North marked 2 of those units as damaged.", "active", "verified")
      ],
      compounds: [
        compound("cmp_atlas_east", "Atlas East", "atlas_east_anchor", ["atlas_east_anchor", "atlas_east_shipped", "atlas_east_recalled"]),
        compound("cmp_atlas_west", "Atlas West", "atlas_west_anchor", ["atlas_west_anchor", "atlas_west_shipped", "atlas_west_pending"]),
        compound("cmp_atlas_north", "Atlas North", "atlas_north_anchor", ["atlas_north_anchor", "atlas_north_shipped", "atlas_north_damaged"])
      ],
      links: [
        { from: "atlas_east_anchor", to: "atlas_west_anchor", relation: "aggregates_with" },
        { from: "atlas_west_anchor", to: "atlas_north_anchor", relation: "aggregates_with" }
      ],
      gold: { answers: ["25 units", "25"], requiredEvidence: ["atlas_east_shipped", "atlas_east_recalled", "atlas_west_shipped", "atlas_west_pending", "atlas_north_shipped", "atlas_north_damaged"] }
    }
  ];
}

function addDistractors(testCase: SubgraphCaseSpec, caseIndex: number): SubgraphCaseSpec {
  const next = structuredClone(testCase);
  for (let group = 0; group < 8; group += 1) {
    const id = `cmp_noise_${caseIndex}_${group}`;
    const anchorKey = `noise_${caseIndex}_${group}_anchor`;
    const members = [anchorKey];
    next.atoms.push(atom(anchorKey, `Archived ${testCase.category} record ${group + 1}; unrelated to the named project in the question.`, "stale", "claim"));
    for (let item = 0; item < 5; item += 1) {
      const key = `noise_${caseIndex}_${group}_${item}`;
      members.push(key);
      next.atoms.push(atom(key, `Archived value ${caseIndex * 100 + group * 10 + item}; do not use for a current named-project answer.`, "stale", "claim"));
    }
    next.compounds.push(compound(id, `Archived ${testCase.category} ${group + 1}`, anchorKey, members));
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
  const answerCorrect = Boolean(parsed && testCase.gold.answers.some((answer) => normalizeAnswer(answer) === normalizeAnswer(parsed.answer)));
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
    latencyMs
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

function normalizeAnswer(value: string): string {
  return value.toLowerCase().replace(/\bone\b/g, "1").replace(/\byes\b/g, "yes").replace(/\bdollars?\b/g, "").replace(/\bunits?\b/g, "").replace(/\bcelsius\b/g, "c").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
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
      : `The exact two-sided paired sign-test p-value is ${pairedSignTestP.toFixed(4)}. Ten exploratory cases do not provide enough separation for a product decision; retain the result as directional evidence and run a larger preregistered set.`
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
