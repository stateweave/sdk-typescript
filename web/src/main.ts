import type { GraphFrame, GraphOp, StateGraph, StateWeaveRunMetadata, StateWeaveStreamEvent, TraceStep, WorkerRunSummary } from "../../src/core/types.js";
import { renderMarkdown } from "./markdown.js";
import { scoreEvalRecords, type EvalPrimitive as Primitive, type EvalVote as Vote, type ScoreBreakdown } from "./evalScores.js";
import { promptFiveCases, promptFiveCategoryOrder, type PromptFiveCategory } from "./promptFive.js";
import { promptSixCases, promptSixCategoryOrder, promptSixHypothesis, type PromptSixCategory, type PromptSixHypothesis } from "./promptSix.js";
import { oneShotPromptStats, oneShotSdkBuildPrompt } from "../../src/evals/oneShotSdkBenchmark.js";
import "./styles.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ModelMessage = { role: "user" | "assistant"; content: string };

type StateWeavePayload = {
  inputFrame?: GraphFrame;
  frameAfter?: GraphFrame;
  output: string;
  trace: TraceStep[];
  graph: StateGraph;
  metadata?: StateWeaveRunMetadata;
};

type StateWeaveResponse = { stateweave: StateWeavePayload };
type CompareResponse = StateWeaveResponse & {
  traditional: {
    messages: ModelMessage[];
    rawModelInput: string;
    output: string;
    history: ChatMessage[];
  };
};

type PageName = "state" | "quickstart" | "ab" | "sdk-build" | "infinite" | "prompt-one" | "prompt-two" | "prompt-three" | "prompt-four" | "prompt-five" | "prompt-six";
type SdkBuildEnvironment = { slot: number; status: string; progress?: { iteration: number; phase: string; modelCalls: number; toolCalls: number; detail: string; updatedAt: string } };
type SdkBuildCandidate = { status: string; finalAnswer?: string; error?: string; previewReady: boolean };
type SdkBuildPublicState = {
  status: string;
  underlyingStatus?: string;
  message: string;
  canStart: boolean;
  canStop: boolean;
  workerOnline?: boolean;
  runId?: string;
  environments: SdkBuildEnvironment[];
  candidates?: { a: SdkBuildCandidate; b: SdkBuildCandidate };
  judgement?: {
    scoreA: number;
    scoreB: number;
    notes: string;
    submittedAt: string;
    reveal: { a: string; b: string };
    metrics?: { a?: Record<string, number>; b?: Record<string, number> };
  };
};
type SuiteId = "prompt-one" | "prompt-two" | "prompt-three" | "prompt-four" | "prompt-five" | "prompt-six";
type EvalCategory = "memory" | "logical" | "holistic" | PromptFiveCategory | PromptSixCategory;
type MultiCase = { prompt: string; expect: string; categories?: EvalCategory[] };
type PromptSuite = { id: SuiteId; title: string; description: string; readyTitle: string; readyCopy: string; expectLabel: string; mode?: "manual" | "judge"; cases: MultiCase[]; hypothesis?: PromptSixHypothesis };
type JudgeDecision = { id: string; vote: Vote; reason: string; raw: string };
type JudgeResponse = { judges: JudgeDecision[]; agreement?: Vote };
type MultiRecord = {
  index: number;
  prompt: string;
  expect: string;
  categories: EvalCategory[];
  a: Primitive;
  b: Primitive;
  regular: string;
  stateweave: string;
  vote?: Vote;
  proposedVote?: Vote;
  pauseReason?: "confirm" | "disagreement";
  judgedBy?: "judges" | "human";
  judges?: JudgeDecision[];
  error?: string;
};

type EvalRun = {
  id: string;
  suiteId: SuiteId;
  suiteTitle: string;
  status: "queued" | "running" | "paused" | "done" | "error" | "stopped";
  confirmJudges: boolean;
  currentIndex: number;
  cases: MultiCase[];
  records: MultiRecord[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type GraphPosition = { x: number; y: number; vx: number; vy: number; pinned: boolean };
type GraphViewState = { selectedNodeId?: string; animationFrame?: number; positions: Map<string, GraphPosition> };
type ToolInfo = { name: string; description: string };
type WorkspaceFile = { path: string; size: number; updatedAt: string; mime: string; renderable: boolean };
type WorkspaceFileContent = WorkspaceFile & { content: string };
type TransferMode = "export" | "import";
type WorkspaceViewName = "graph" | "tools" | "files";
type AgentSettings = { systemPrompt: string; nodeTypes: string[]; maxIterations: number };
type LiveStepStatus = "streaming" | "parsed" | "retrying" | "rejected" | "committed";
type LiveWorker = WorkerRunSummary & { tokens: string; ops?: GraphOp[] };
type LiveStreamStep = {
  step: number;
  status: LiveStepStatus;
  rawModelOutput: string;
  tokenEstimate?: number;
  parsedOps?: GraphOp[];
  error?: string;
  retryable?: boolean;
  modelMetadata: Record<string, unknown>[];
  workers: Map<string, LiveWorker>;
  nodeCount?: number;
  edgeCount?: number;
};
type LiveStreamLog = { metadata?: StateWeaveRunMetadata; steps: Map<number, LiveStreamStep>; events: string[]; prompt?: string; latestStep?: number; finalAnswer?: string };

let activePage: PageName = pageFromHash();
let sdkBuildState: SdkBuildPublicState | undefined;
let sdkBuildPollTimer: number | undefined;
let sdkBuildPreviewRunId: string | undefined;
let multiSuiteId: SuiteId = suiteIdForPage(activePage) ?? "prompt-one";
let stateFrame: GraphFrame | undefined;
let abStateFrame: GraphFrame | undefined;
let abRegularHistory: ChatMessage[] = [];
let multiStateFrame: GraphFrame | undefined;
let multiRegularHistory: ChatMessage[] = [];
let multiIndex = 0;
let multiRunning = false;
let multiRecords: MultiRecord[] = [];
let multiRun: EvalRun | undefined;
let multiRunPollTimer: number | undefined;
let stateRunning = false;
let abRunning = false;
let copyCounter = 0;
let artifactPreviewCounter = 0;
let transferMode: TransferMode = "export";
let selectedFilePath: string | undefined;
let workspaceFiles: WorkspaceFile[] = [];

const defaultAgentSettings: AgentSettings = {
  systemPrompt: "StateWeave system root. The graph is the runtime state; compile GraphFrame from the graph instead of provider messages.",
  nodeTypes: ["intent", "constraint", "artifact", "decision", "fact", "hypothesis", "risk", "question", "wisdom"],
  maxIterations: 30
};
const agentSettingsStorageKey = "stateweave.agentSettings.v1";
const stateChatStorageKey = "stateweave.chat.v1";
let agentSettings = loadAgentSettings();
const primaryGraphViewState: GraphViewState = { positions: new Map<string, GraphPosition>() };
const copyPayloads = new Map<string, string>();
const artifactPreviews = new Map<string, string>();
const categoryOrder: EvalCategory[] = ["memory", "logical", "holistic", ...promptFiveCategoryOrder, ...promptSixCategoryOrder];
const autoJudgePreviewMs = 2000;
const promptSuites: Record<SuiteId, PromptSuite> = {
  "prompt-one": {
    id: "prompt-one",
    title: "Prompt one",
    description: "Ten connected prompts test memory, constraint retention, topic switching, and correction handling.",
    readyTitle: "Ready for a harder test.",
    readyCopy: "This sequence tests memory, constraint retention, topic switching, and corrections over ten turns.",
    expectLabel: "Expected",
    cases: [
      {
        prompt: "For this test, remember: project name is LumaGarden, audience is teachers, tone is calm, visual style is black and white only, no gradients, and the mascot is an owl. Reply ready and do not design yet.",
        expect: "Should acknowledge readiness and preserve all six facts/constraints for later turns."
      },
      {
        prompt: "Create a one-sentence tagline using the project name and audience.",
        expect: "Should include LumaGarden, target teachers, and a calm/educational feeling."
      },
      {
        prompt: "Give a three-bullet UI style guide obeying my visual constraints.",
        expect: "Should retain black-and-white only, no gradients, calm tone, and avoid adding unrelated colors."
      },
      {
        prompt: "Switch topic briefly: explain in one sentence what a graph database is.",
        expect: "Should answer the new topic directly without losing the brand context for later."
      },
      {
        prompt: "Back to the project: create an SVG logo. It must follow all prior visual constraints.",
        expect: "Should make an SVG for LumaGarden using black/white, no gradients, and the owl/classroom context."
      },
      {
        prompt: "Revise the logo concept so it feels more classroom-friendly, but keep every visual constraint.",
        expect: "Should improve classroom fit while preserving black/white only, no gradients, and the existing brand context."
      },
      {
        prompt: "What constraints have I given so far? List only constraints and durable facts, not your outputs.",
        expect: "Should list name LumaGarden, teachers, calm tone, black/white only, no gradients, and owl mascot."
      },
      {
        prompt: "Create a homepage hero title and subtitle. Do not mention the mascot explicitly.",
        expect: "Should use the brand/audience/tone but not mention owl or mascot."
      },
      {
        prompt: "I changed one thing: the mascot is now a lantern, not an owl. Confirm and give one logo direction.",
        expect: "Should update the mascot to lantern, avoid owl, and keep prior visual constraints."
      },
      {
        prompt: "Final task: produce a concise brand card with name, audience, tone, visual rules, mascot, and one CTA.",
        expect: "Should include LumaGarden, teachers, calm tone, black/white, no gradients, lantern mascot, and a CTA."
      }
    ]
  },
  "prompt-two": {
    id: "prompt-two",
    title: "Prompt two",
    description: "Twenty-five blind math/physics questions with hidden gold answers. The gold answer is shown only in the UI, never sent to either variant.",
    readyTitle: "Ready for gold-answer math.",
    readyCopy: "This sequence tests exactness under growing context: arithmetic, modular arithmetic, probability, geometry, and basic physics.",
    expectLabel: "Gold answer",
    cases: [
      { prompt: "Compute 37 × 43 − 41². Return the final value and one short justification.", expect: "-90" },
      { prompt: "Find the smallest positive integer n such that n leaves remainders 2, 3, and 4 when divided by 3, 5, and 7 respectively.", expect: "53" },
      { prompt: "What are the last two digits of 7^222?", expect: "49" },
      { prompt: "Add all integers from 1 to 100 that are divisible by 3 or 5, but exclude numbers divisible by both 3 and 5.", expect: "2103" },
      { prompt: "If x + 1/x = 5, what is x² + 1/x²?", expect: "23" },
      { prompt: "Find the remainder when 2^1000 is divided by 17.", expect: "1" },
      { prompt: "How many trailing zeros are in 100! ?", expect: "24" },
      { prompt: "A standard deck has 52 cards. What is the probability of drawing two aces in a row without replacement?", expect: "1/221" },
      { prompt: "A fair coin is flipped 5 times. What is the probability of getting exactly 3 heads?", expect: "5/16" },
      { prompt: "A car starts from rest and accelerates at 3 m/s² for 8 seconds. How far does it travel?", expect: "96 m" },
      { prompt: "A projectile is launched straight up at 20 m/s. Use g = 10 m/s². What maximum height does it reach?", expect: "20 m" },
      { prompt: "What is the equivalent resistance of 6Ω and 3Ω resistors connected in parallel?", expect: "2 Ω" },
      { prompt: "How much work is required to lift a 2 kg mass by 5 m? Use g = 10 m/s².", expect: "100 J" },
      { prompt: "A 0.5 kg object moves at 12 m/s. What is its kinetic energy?", expect: "36 J" },
      { prompt: "Solve 9x ≡ 6 (mod 21). Give all residue classes modulo 21.", expect: "x ≡ 3, 10, or 17 (mod 21)" },
      { prompt: "Find gcd(252, 198) and lcm(252, 198).", expect: "gcd = 18, lcm = 2772" },
      { prompt: "What is the sum of the first 20 positive odd integers?", expect: "400" },
      { prompt: "Solve for positive x: log₂(x) + log₂(x/4) = 6.", expect: "x = 16" },
      { prompt: "For the arithmetic sequence 7, 11, 15, ..., what is the 30th term?", expect: "123" },
      { prompt: "How many subsets of {1,2,3,4,5,6,7,8} contain 1 but do not contain 2?", expect: "64" },
      { prompt: "Simplify 3^12 / 9^5.", expect: "9" },
      { prompt: "If today is Tuesday, what day of the week is it 100 days from now?", expect: "Thursday" },
      { prompt: "A right triangle has hypotenuse 13 and one leg 5. What is its area?", expect: "30" },
      { prompt: "If f(x) = 2x² − 3x + 1, compute f(−2).", expect: "15" },
      { prompt: "What is the units digit of 13^57?", expect: "3" }
    ]
  },
  "prompt-three": {
    id: "prompt-three",
    title: "Prompt three",
    description: "Thirty harder gold-answer questions: modular arithmetic, combinatorics, exact physics, geometry, and algebra. Gold answers are shown only in the UI and never sent to either variant.",
    readyTitle: "Ready for the stress test.",
    readyCopy: "This sequence is intentionally more confusing. Vote against the gold answer, not style. Both variants see only the prompt, not the gold.",
    expectLabel: "Gold answer",
    cases: [
      { prompt: "Compute the least nonnegative residue of 17^2025 modulo 1000. Return the final answer and one short justification.", expect: "57" },
      { prompt: "Find the least nonnegative x such that 37x ≡ 1 (mod 1000). Return the final answer and one short justification.", expect: "973" },
      { prompt: "How many integer triples (x,y,z) satisfy x+y+z=50 with 0≤x≤20, 5≤y≤25, and z≥10? Return the count and one short justification.", expect: "426" },
      { prompt: "What are the last three digits of 13^137? Return the final answer and one short justification.", expect: "333" },
      { prompt: "What is the coefficient of x^7 in (1+x+x²)^10? Return the final answer and one short justification.", expect: "4740" },
      { prompt: "How many binary strings of length 12 contain exactly five 1s and no two 1s adjacent? Return the final answer and one short justification.", expect: "56" },
      { prompt: "What is the sum of the positive divisors of 720? Return the final answer and one short justification.", expect: "2418" },
      { prompt: "Find the smallest positive n such that n≡1 (mod 4), n≡2 (mod 9), and n≡3 (mod 11). Return the final answer and one short justification.", expect: "245" },
      { prompt: "Compute S = sum from k=1 to 50 of floor(k²/7). Return the final answer and one short justification.", expect: "6118" },
      { prompt: "Solve 12x ≡ 8 (mod 35). Give the least nonnegative residue and one short justification.", expect: "24" },
      { prompt: "Let F_0=0 and F_1=1. Find F_100 modulo 1000. Return the final answer and one short justification.", expect: "75" },
      { prompt: "Sum all three-digit positive integers divisible by 7 but not by 5. Return the final answer and one short justification.", expect: "56231" },
      { prompt: "How many lattice paths from (0,0) to (6,6), using only right and up steps, never go above the diagonal y=x? Return the final answer and one short justification.", expect: "132" },
      { prompt: "Three fair six-sided dice are rolled. What is the probability that the sum is 10 and at least one die is 4? Return the final probability and one short justification.", expect: "1/18" },
      { prompt: "A right triangle has legs 9 and 12. What is the inradius? Return the final answer and one short justification.", expect: "3" },
      { prompt: "A regular hexagon has area 54√3. What is its side length? Return the final answer and one short justification.", expect: "6" },
      { prompt: "A 4Ω resistor and a 6Ω resistor are connected in parallel; that combination is then connected in series with 3Ω. What is the equivalent resistance? Return the final answer and one short justification.", expect: "27/5 Ω" },
      { prompt: "An object starts at 10 m/s and has constant acceleration −2 m/s² until it stops. How far does it travel? Return the final answer and one short justification.", expect: "25 m" },
      { prompt: "For an ideal gas with fixed amount n, pressure is doubled and volume is tripled. By what factor does absolute temperature change? Return the final answer and one short justification.", expect: "6" },
      { prompt: "Compute the determinant of the matrix [[2,1,3],[0,-1,4],[5,2,0]]. Return the final answer and one short justification.", expect: "19" },
      { prompt: "Find the remainder when x^100 + x^50 + 1 is divided by x² − 1. Return the polynomial remainder and one short justification.", expect: "3" },
      { prompt: "Find the coefficient of x^4 in (2x − x^{-1})^8. Return the final answer and one short justification.", expect: "1792" },
      { prompt: "How many positive divisors does 75600 have? Return the final answer and one short justification.", expect: "120" },
      { prompt: "How many distinct arrangements are there of the letters in STATEWEAVE? Return the final answer and one short justification.", expect: "151200" },
      { prompt: "How many ordered integer pairs (a,b) with 1≤a≤20 and 1≤b≤20 have a+b divisible by 6? Return the final answer and one short justification.", expect: "66" },
      { prompt: "Solve log_3(x) + log_9(x) = 9 for positive x. Return the final answer and one short justification.", expect: "729" },
      { prompt: "Find the smallest positive x satisfying x≡2 (mod 6) and x≡5 (mod 9). Return the final answer and one short justification.", expect: "14" },
      { prompt: "How many integers from 1 to 1000 inclusive are divisible by exactly one of 6, 10, and 15? Return the final answer and one short justification.", expect: "233" },
      { prompt: "Let a_0=1 and a_n=3a_{n-1}+2. Find a_5. Return the final answer and one short justification.", expect: "485" },
      { prompt: "If sin(θ)=3/5 and θ is in quadrant II, compute cos(2θ). Return the final answer and one short justification.", expect: "7/25" }
    ]
  },
  "prompt-four": {
    id: "prompt-four",
    title: "Prompt four",
    description: "One hundred auto-judged questions: memory, logic, and holistic cross-reference challenges. Two independent LLM judges score each case against the gold answer; disagreements pause for human review.",
    readyTitle: "Ready for 100 auto-judged cases.",
    readyCopy: "This sequence runs automatically one case at a time. It pauses only when the two judges disagree and need a human vote.",
    expectLabel: "Gold answer",
    mode: "judge",
    cases: promptFourCases()
  },
  "prompt-five": {
    id: "prompt-five",
    title: "Prompt five",
    description: "One hundred adversarial auto-judged cases: pure logic controls, distractors, corrections, revocations, conflicts, entity confusion, chronology, needle retrieval, multihop links, and exact formatting.",
    readyTitle: "Ready for adversarial prompt five.",
    readyCopy: "This sequence is balanced across ten primary categories. It should challenge StateWeave instead of only testing long memory.",
    expectLabel: "Gold answer",
    mode: "judge",
    cases: promptFiveCases()
  },
  "prompt-six": {
    id: "prompt-six",
    title: "Prompt six",
    description: "Three hundred long-context regression cases testing whether memory accuracy degrades as conversational state grows: ancient anchors, latest-over-stale updates, revocations/restores, chronology edits, and cross-reference joins.",
    readyTitle: "Ready for long-context regression.",
    readyCopy: "This is a paper-style hypothesis test. It runs in background and buckets results over time to show whether either variant regresses as context grows.",
    expectLabel: "Gold answer",
    mode: "judge",
    cases: promptSixCases(),
    hypothesis: promptSixHypothesis
  }
};


function promptFourCases(): MultiCase[] {
  const cases: MultiCase[] = [];
  const add = (prompt: string, expect: string, categories: EvalCategory[]): void => {
    cases.push({ prompt, expect, categories });
  };
  const memory: EvalCategory[] = ["memory"];
  const logical: EvalCategory[] = ["logical"];
  const holistic: EvalCategory[] = ["memory", "logical", "holistic"];

  add("Memory setup A: Store the Atlas ledger exactly: city=Quito, animal=lynx, prime=47, offset=18, color=teal, code=MIRROR-73. Reply READY-ATLAS only.", "READY-ATLAS", memory);
  add("Memory setup B: Store the Boreal ledger exactly: station=Boreal Gate, moon=Io, crates=38, loss=7, multiplier=9, metal=silver. Reply READY-BOREAL only.", "READY-BOREAL", memory);
  add("Memory setup C: Store the Cedar ledger exactly: route=Cedar Loop, stops=14, passengers=126, drop=19, add=8, phrase=silent river. Reply READY-CEDAR only.", "READY-CEDAR", memory);
  add("Memory setup D: Store the Delta ledger exactly: lab=Delta Room, sampleA=23, sampleB=31, sampleC=44, reagent=argon, checksum=902. Reply READY-DELTA only.", "READY-DELTA", memory);
  add("Memory setup E: Store the Ember ledger exactly: ship=Ember Kite, speed=17, duration=36, delay=11, port=Valencia, cargo=ceramics. Reply READY-EMBER only.", "READY-EMBER", memory);

  add("From Atlas, give city and animal only.", "Quito and lynx", memory);
  add("From Boreal, give station and moon only.", "Boreal Gate and Io", memory);
  add("From Cedar, give route and phrase only.", "Cedar Loop and silent river", memory);
  add("From Delta, give lab and reagent only.", "Delta Room and argon", memory);
  add("From Ember, give ship and cargo only.", "Ember Kite and ceramics", memory);
  add("Compute Atlas prime plus Atlas offset.", "65", holistic);
  add("Compute Boreal crates after loss.", "31", holistic);
  add("Compute Cedar passengers per stop if evenly divided.", "9", holistic);
  add("Compute Delta sampleA + sampleB + sampleC.", "98", holistic);
  add("Compute Ember speed times duration.", "612", holistic);
  add("Give Atlas code and Boreal metal, in that order.", "MIRROR-73 and silver", memory);
  add("Give Ember port and Delta checksum, in that order.", "Valencia and 902", memory);
  add("Compute Boreal multiplier times Cedar stops.", "126", holistic);
  add("Compute Delta checksum minus Ember distance from speed times duration.", "290", holistic);
  add("Which stored ledger uses the phrase silent river?", "Cedar ledger", memory);
  add("Which stored ledger has the moon Io?", "Boreal ledger", memory);
  add("Compute Atlas prime times Boreal multiplier plus Cedar add.", "431", holistic);
  add("Compute Ember delay plus Delta sampleB minus Atlas offset.", "24", holistic);
  add("Give the color from Atlas and the metal from Boreal.", "teal and silver", memory);
  add("Compute Delta checksum mod Atlas prime.", "9", holistic);

  for (const [base, exp, mod] of [[17, 2025, 1000], [13, 137, 1000], [29, 81, 97], [7, 222, 100], [11, 333, 1000], [19, 64, 101], [23, 45, 1000], [31, 29, 77], [5, 123, 97], [41, 57, 1000]] as const) {
    add(`Compute the least nonnegative residue of ${base}^${exp} modulo ${mod}.`, String(powMod(base, exp, mod)), logical);
  }
  for (const [a, m, b, n] of [[1, 4, 2, 9], [2, 6, 5, 9], [3, 7, 4, 11], [5, 8, 9, 13], [4, 9, 7, 10], [6, 11, 8, 17], [10, 13, 3, 19], [12, 25, 7, 18]] as const) {
    add(`Find the smallest positive x satisfying x≡${a} (mod ${m}) and x≡${b} (mod ${n}).`, String(crt2(a, m, b, n)), logical);
  }
  for (const [n, k] of [[12, 5], [14, 6], [16, 4], [18, 7], [20, 10], [22, 3], [24, 5], [26, 8]] as const) {
    add(`Compute C(${n},${k}) exactly.`, String(choose(n, k)), logical);
  }
  for (const [n, answer] of [[720, sigma(720)], [75600, divisorCount(75600)], [5040, sigma(5040)], [83160, divisorCount(83160)], [3600, sigma(3600)], [9240, divisorCount(9240)]] as const) {
    add(n === 720 || n === 5040 || n === 3600 ? `What is the sum of positive divisors of ${n}?` : `How many positive divisors does ${n} have?`, String(answer), logical);
  }
  add("How many binary strings of length 15 contain exactly six 1s and no two 1s adjacent?", String(choose(15 - 6 + 1, 6)), logical);
  add("How many lattice paths from (0,0) to (7,7), using only right and up steps, never go above y=x?", String(catalan(7)), logical);
  add("Three fair dice are rolled. What is the probability that the sum is 11 and at least one die is 5?", diceProbability(11, 5), logical);
  add("A right triangle has legs 20 and 21. What is its inradius?", "6", logical);
  add("A regular hexagon has area 96√3. What is its side length?", "8", logical);
  add("An object starts at 18 m/s and decelerates at 3 m/s² until it stops. How far does it travel?", "54 m", logical);
  add("A 5Ω resistor and a 20Ω resistor are in parallel, then connected in series with 6Ω. What is the equivalent resistance?", "10 Ω", logical);
  add("If sin(θ)=5/13 and θ is in quadrant II, compute cos(2θ).", "119/169", logical);
  add("Find the coefficient of x^6 in (2x - x^-1)^10.", String(coefficientLaurent(10, 6)), logical);
  add("Find F_120 modulo 1000, where F_0=0 and F_1=1.", String(fibMod(120, 1000)), logical);
  add("Compute the determinant of [[3,2,1],[4,0,-1],[2,5,6]].", String(det3([[3, 2, 1], [4, 0, -1], [2, 5, 6]])), logical);

  add("Using the stored ledgers, compute (Atlas prime + Delta sampleA) × Boreal multiplier.", "630", holistic);
  add("Using the stored ledgers, compute Ember distance minus Cedar passengers.", "486", holistic);
  add("Using the stored ledgers, compute Delta checksum minus Boreal crates after loss.", "871", holistic);
  add("Using the stored ledgers, give the ledger whose numeric field equals Boreal multiplier × Cedar stops.", "Cedar passengers", holistic);
  add("Using the stored ledgers, compute Atlas offset + Boreal loss + Cedar add + Ember delay.", "44", holistic);
  add("Using the stored ledgers, compute (Delta sampleC − Delta sampleA) × Cedar stops.", "294", holistic);
  add("Using the stored ledgers, which is larger: Ember distance or Delta checksum? Give the larger value.", "Delta checksum, 902", holistic);
  add("Using the stored ledgers, compute Atlas prime × Ember delay − Boreal crates.", "479", holistic);
  add("Using the stored ledgers, concatenate Atlas code, Cedar phrase, and Ember port with slashes.", "MIRROR-73/silent river/Valencia", ["memory", "holistic"]);
  add("Using the stored ledgers, compute gcd(Delta checksum, Ember distance).", String(gcd(902, 612)), holistic);
  add("Using the stored ledgers, compute lcm(Atlas prime, Boreal multiplier).", String(lcm(47, 9)), holistic);
  add("Using the stored ledgers, compute (Cedar passengers / Cedar stops) + Delta sampleB.", "40", holistic);
  add("Using the stored ledgers, compute Boreal crates × Cedar add − Delta sampleA.", "281", holistic);
  add("Using the stored ledgers, identify the stored animal and the ship name that contains an animal word; give each associated location.", "lynx: Quito; Ember Kite: Valencia", ["memory", "holistic"]);
  add("Using the stored ledgers, compute (Ember speed + Atlas offset)^2 mod 100.", "25", holistic);
  add("Using the stored ledgers, compute Delta sample total minus Atlas prime.", "51", holistic);
  add("Using the stored ledgers, compute Boreal multiplier^Cedar add mod 100.", String(powMod(9, 8, 100)), holistic);
  add("Using the stored ledgers, compute the number of letters in Atlas animal plus Boreal metal plus Delta reagent.", "14", holistic);
  add("Using the stored ledgers, compute Ember duration minus Boreal crates after loss.", "5", holistic);
  add("Using the stored ledgers, give the cargo and the route, in that order.", "ceramics and Cedar Loop", ["memory", "holistic"]);
  add("Using the stored ledgers, compute (Atlas prime + Boreal multiplier + Cedar stops + Delta sampleA + Ember speed).", "110", holistic);
  add("Using the stored ledgers, compute Delta checksum divided by the number of letters in the Delta reagent, integer quotient only.", "180", holistic);
  add("Using the stored ledgers, compute the least positive x with x≡Atlas offset (mod 47) and x≡Boreal loss (mod 9).", String(crt2(18, 47, 7, 9)), holistic);
  add("Using the stored ledgers, compute C(Cedar stops, Boreal loss).", String(choose(14, 7)), holistic);
  add("Using the stored ledgers, give the color, metal, reagent, and cargo in that order.", "teal, silver, argon, ceramics", ["memory", "holistic"]);

  add("Recall the Atlas code from setup A. Do not infer; answer exactly.", "MIRROR-73", memory);
  add("Recall the Boreal station from setup B. Do not infer; answer exactly.", "Boreal Gate", memory);
  add("Recall the Cedar phrase from setup C. Do not infer; answer exactly.", "silent river", memory);
  add("Recall the Delta reagent from setup D. Do not infer; answer exactly.", "argon", memory);
  add("Recall the Ember cargo from setup E. Do not infer; answer exactly.", "ceramics", memory);
  add("Final holistic check: using all five ledgers, compute Atlas prime + Boreal crates + Cedar stops + Delta sampleC + Ember delay.", "154", holistic);
  add("Final exact answer: which stored location is paired with the cargo ceramics?", "Valencia", memory);

  if (cases.length !== 100) throw new Error(`Prompt four expected 100 cases, got ${cases.length}`);
  return cases;
}

function powMod(base: number, exp: number, mod: number): number {
  let result = 1 % mod;
  let value = base % mod;
  for (let power = exp; power > 0; power = Math.floor(power / 2)) {
    if (power % 2) result = (result * value) % mod;
    value = (value * value) % mod;
  }
  return result;
}

function crt2(a: number, m: number, b: number, n: number): number {
  const limit = m * n;
  for (let x = 1; x <= limit; x++) if (x % m === ((a % m) + m) % m && x % n === ((b % n) + n) % n) return x;
  return 0;
}

function choose(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

function sigma(n: number): number {
  let sum = 0;
  for (let d = 1; d <= n; d++) if (n % d === 0) sum += d;
  return sum;
}

function divisorCount(n: number): number {
  let count = 0;
  for (let d = 1; d <= n; d++) if (n % d === 0) count += 1;
  return count;
}

function catalan(n: number): number {
  return choose(2 * n, n) / (n + 1);
}

function diceProbability(sum: number, required: number): string {
  let count = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    if (a + b + c === sum && (a === required || b === required || c === required)) count += 1;
  }
  const divisor = gcd(count, 216);
  return `${count / divisor}/${216 / divisor}`;
}

function coefficientLaurent(power: number, exponent: number): number {
  for (let j = 0; j <= power; j++) {
    if (power - 2 * j === exponent) return choose(power, j) * 2 ** (power - j) * (-1) ** j;
  }
  return 0;
}

function fibMod(n: number, mod: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, (a + b) % mod];
  return a;
}

function det3(m: number[][]): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const stateTab = element<HTMLButtonElement>("state-tab");
const quickstartTab = element<HTMLButtonElement>("quickstart-tab");
const abTab = element<HTMLButtonElement>("ab-tab");
const multiTab = element<HTMLButtonElement>("multi-tab");
const multiTwoTab = element<HTMLButtonElement>("multi-two-tab");
const multiThreeTab = element<HTMLButtonElement>("multi-three-tab");
const multiFourTab = element<HTMLButtonElement>("multi-four-tab");
const multiFiveTab = element<HTMLButtonElement>("multi-five-tab");
const multiSixTab = element<HTMLButtonElement>("multi-six-tab");
const sdkBuildTab = element<HTMLButtonElement>("sdk-build-tab");
const infiniteTab = element<HTMLButtonElement>("infinite-tab");
const statePage = element<HTMLElement>("state-page");
const quickstartPage = element<HTMLElement>("quickstart-page");
const abPage = element<HTMLElement>("ab-page");
const multiPage = element<HTMLElement>("multi-page");
const sdkBuildPage = element<HTMLElement>("sdk-build-page");
const infinitePage = element<HTMLElement>("infinite-page");
const sdkBuildPrompt = element<HTMLElement>("sdk-build-prompt");
const sdkBuildPromptStats = element<HTMLElement>("sdk-build-prompt-stats");
const sdkBuildCopy = element<HTMLButtonElement>("sdk-build-copy");
const sdkBuildLiveBadge = element<HTMLElement>("sdk-build-live-badge");
const sdkBuildMessage = element<HTMLElement>("sdk-build-message");
const sdkBuildStart = element<HTMLButtonElement>("sdk-build-start");
const sdkBuildStop = element<HTMLButtonElement>("sdk-build-stop");
const sdkBuildEnvironmentOne = element<HTMLElement>("sdk-build-environment-1");
const sdkBuildEnvironmentTwo = element<HTMLElement>("sdk-build-environment-2");
const sdkBuildReview = element<HTMLElement>("sdk-build-review");
const sdkBuildPreviewA = element<HTMLIFrameElement>("sdk-build-preview-a");
const sdkBuildPreviewB = element<HTMLIFrameElement>("sdk-build-preview-b");
const sdkBuildOpenA = element<HTMLAnchorElement>("sdk-build-open-a");
const sdkBuildOpenB = element<HTMLAnchorElement>("sdk-build-open-b");
const sdkBuildAnswerA = element<HTMLElement>("sdk-build-answer-a");
const sdkBuildAnswerB = element<HTMLElement>("sdk-build-answer-b");
const sdkBuildScoreForm = element<HTMLFormElement>("sdk-build-score-form");
const sdkBuildScoreA = element<HTMLInputElement>("sdk-build-score-a");
const sdkBuildScoreB = element<HTMLInputElement>("sdk-build-score-b");
const sdkBuildScoreNotes = element<HTMLTextAreaElement>("sdk-build-score-notes");
const sdkBuildSubmitScore = element<HTMLButtonElement>("sdk-build-submit-score");
const sdkBuildReveal = element<HTMLElement>("sdk-build-reveal");
const infiniteLiveBadge = element<HTMLElement>("infinite-live-badge");
const infiniteMetrics = element<HTMLElement>("infinite-metrics");
const infiniteTurns = element<HTMLElement>("infinite-turns");
const infiniteTurnNumber = element<HTMLInputElement>("infinite-turn-number");
const infiniteTurnOpen = element<HTMLButtonElement>("infinite-turn-open");
const infiniteTurnLatest = element<HTMLButtonElement>("infinite-turn-latest");
const infiniteTurnDetail = element<HTMLElement>("infinite-turn-detail");
const infiniteStatistics = element<HTMLElement>("infinite-statistics");
const infiniteClusters = element<HTMLElement>("infinite-clusters");
const infiniteOpenGraph = element<HTMLButtonElement>("infinite-open-graph");
const challengerLibraryTldr = element<HTMLElement>("challenger-library-tldr");
const challengerLibraryCount = element<HTMLElement>("challenger-library-count");
const challengerScenarioList = element<HTMLElement>("challenger-scenario-list");
const challengerScenarioHeading = element<HTMLElement>("challenger-scenario-heading");
const challengerScenarioContent = element<HTMLElement>("challenger-scenario-content");
// The Infinite tab polls the server-owned agent harness through one state endpoint.
const chat = element<HTMLElement>("chat");
const form = element<HTMLFormElement>("composer");
const input = element<HTMLTextAreaElement>("input");
const send = element<HTMLButtonElement>("send");
const reset = element<HTMLButtonElement>("reset");
const status = element<HTMLElement>("status");
const provider = element<HTMLElement>("provider");
const agentSystemPrompt = element<HTMLTextAreaElement>("agent-system-prompt");
const agentNodeTypes = element<HTMLInputElement>("agent-node-types");
const agentMaxIterations = element<HTMLInputElement>("agent-max-iterations");
const resetAgentSettings = element<HTMLButtonElement>("reset-agent-settings");
const stateInput = element<HTMLElement>("state-input");
const stateOutput = element<HTMLElement>("state-output");
const graphViewTab = element<HTMLButtonElement>("graph-view-tab");
const toolsViewTab = element<HTMLButtonElement>("tools-view-tab");
const filesViewTab = element<HTMLButtonElement>("files-view-tab");
const graphView = element<HTMLElement>("graph-view");
const toolsView = element<HTMLElement>("tools-view");
const filesView = element<HTMLElement>("files-view");
const graph = element<HTMLElement>("graph");
const toolList = element<HTMLElement>("tool-list");
const toolCount = element<HTMLElement>("tool-count");
const fileList = element<HTMLElement>("file-list");
const fileCount = element<HTMLElement>("file-count");
const fileViewer = element<HTMLElement>("file-viewer");
const refreshFiles = element<HTMLButtonElement>("refresh-files");
const rebootFiles = element<HTMLButtonElement>("reboot-files");
const exportGraph = element<HTMLButtonElement>("export-graph");
const importGraph = element<HTMLButtonElement>("import-graph");
const transferModal = element<HTMLElement>("graph-transfer-modal");
const transferTitle = element<HTMLElement>("graph-transfer-title");
const transferHelp = element<HTMLElement>("graph-transfer-help");
const transferText = element<HTMLTextAreaElement>("graph-transfer-text");
const closeTransfer = element<HTMLButtonElement>("close-transfer");
const copyTransfer = element<HTMLButtonElement>("copy-transfer");
const applyImport = element<HTMLButtonElement>("apply-import");
const abForm = element<HTMLFormElement>("ab-composer");
const abInput = element<HTMLTextAreaElement>("ab-input");
const abSend = element<HTMLButtonElement>("ab-send");
const abStatus = element<HTMLElement>("ab-status");
const abResults = element<HTMLElement>("ab-results");
const multiStart = element<HTMLButtonElement>("multi-start");
const multiTitle = element<HTMLElement>("multi-title");
const multiDescription = element<HTMLElement>("multi-description");
const multiProgress = element<HTMLElement>("multi-progress");
const multiLiveScore = element<HTMLElement>("multi-live-score");
const multiConfirmWrap = element<HTMLElement>("multi-confirm-wrap");
const multiConfirmJudges = element<HTMLInputElement>("multi-confirm-judges");
const multiSteps = element<HTMLElement>("multi-steps");
const multiStage = element<HTMLElement>("multi-stage");

sdkBuildPrompt.textContent = oneShotSdkBuildPrompt;
const sdkPromptStats = oneShotPromptStats();
sdkBuildPromptStats.textContent = `${sdkPromptStats.words.toLocaleString()} words · ${sdkPromptStats.characters.toLocaleString()} characters · fixed for both participants`;

setActivePage(activePage, false);
renderAgentSettings();
renderMultiProgress();
void loadHealth();
void loadTools();
void loadWorkspaceFiles();
restoreStateChat();

stateTab.addEventListener("click", () => setActivePage("state"));
quickstartTab.addEventListener("click", () => setActivePage("quickstart"));
abTab.addEventListener("click", () => setActivePage("ab"));
multiTab.addEventListener("click", () => setActivePage("prompt-one"));
multiTwoTab.addEventListener("click", () => setActivePage("prompt-two"));
multiThreeTab.addEventListener("click", () => setActivePage("prompt-three"));
multiFourTab.addEventListener("click", () => setActivePage("prompt-four"));
multiFiveTab.addEventListener("click", () => setActivePage("prompt-five"));
multiSixTab.addEventListener("click", () => setActivePage("prompt-six"));
sdkBuildTab.addEventListener("click", () => setActivePage("sdk-build"));
infiniteTab.addEventListener("click", () => setActivePage("infinite"));
sdkBuildCopy.addEventListener("click", () => void copyText(oneShotSdkBuildPrompt, sdkBuildCopy));
sdkBuildStart.addEventListener("click", () => void startSdkBuildBenchmark());
sdkBuildStop.addEventListener("click", () => void stopSdkBuildBenchmark());
sdkBuildScoreForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitSdkBuildScores();
});
infiniteOpenGraph.addEventListener("click", () => void openInfiniteGraph());
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendStateWeaveMessage();
});
abForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runAbTest();
});
reset.addEventListener("click", () => {
  if (activePage === "state") resetStateWeaveChat();
  else if (activePage === "quickstart") setActivePage("state");
  else if (activePage === "ab") resetAbTests();
  else if (activePage === "sdk-build") setActivePage("state");
  else void resetCurrentMultiTest();
});
input.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void sendStateWeaveMessage();
  }
});
agentSystemPrompt.addEventListener("input", saveAgentSettingsFromForm);
agentNodeTypes.addEventListener("input", saveAgentSettingsFromForm);
agentMaxIterations.addEventListener("input", saveAgentSettingsFromForm);
resetAgentSettings.addEventListener("click", () => {
  agentSettings = structuredClone(defaultAgentSettings);
  saveAgentSettings();
  renderAgentSettings();
  stateFrame = applyAgentSettingsToFrame(stateFrame);
  if (stateFrame) renderGraph(stateFrame.graph);
});
abInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void runAbTest();
  }
});
multiStart.addEventListener("click", () => {
  if (currentSuite().mode === "judge") {
    void startBackgroundEvalRun();
    return;
  }
  if (!multiRecords.length && multiIndex === 0) resetMultiTest(false);
  void runNextMultiCase();
});
multiConfirmJudges.addEventListener("change", () => {
  void updateBackgroundEvalOptions(multiConfirmJudges.checked);
});
graphViewTab.addEventListener("click", () => setWorkspaceView("graph"));
toolsViewTab.addEventListener("click", () => setWorkspaceView("tools"));
filesViewTab.addEventListener("click", () => setWorkspaceView("files"));
refreshFiles.addEventListener("click", () => void loadWorkspaceFiles());
rebootFiles.addEventListener("click", () => void rebootWorkspaceFiles());
exportGraph.addEventListener("click", () => openGraphTransfer("export"));
importGraph.addEventListener("click", () => openGraphTransfer("import"));
closeTransfer.addEventListener("click", closeGraphTransfer);
copyTransfer.addEventListener("click", () => void copyText(transferText.value, copyTransfer));
applyImport.addEventListener("click", applyGraphImport);
transferModal.addEventListener("click", (event) => {
  if (event.target === transferModal) closeGraphTransfer();
});
fileList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-file-path]") : undefined;
  if (!target?.dataset.filePath) return;
  void openWorkspaceFile(target.dataset.filePath);
});
fileViewer.addEventListener("click", (event) => {
  if (handleArtifactPreviewClick(event)) return;
  const target = event.target instanceof Element ? event.target : undefined;
  if (target?.closest("[data-file-back]")) {
    closeWorkspaceFile();
    return;
  }
  const copyButton = target?.closest<HTMLButtonElement>("button[data-copy-id]");
  const copyId = copyButton?.dataset.copyId;
  if (copyButton && copyId) {
    const value = copyPayloads.get(copyId);
    if (value) void copyText(value, copyButton);
  }
});
chat.addEventListener("click", (event) => {
  if (handleArtifactPreviewClick(event)) return;
});
chat.addEventListener("toggle", handleStreamAccordionToggle, true);
abResults.addEventListener("click", (event) => {
  if (handleArtifactPreviewClick(event)) return;
  const target = event.target instanceof Element ? event.target : undefined;
  const button = target?.closest<HTMLButtonElement>("button[data-copy-id]");
  if (!button?.dataset.copyId) return;
  const value = copyPayloads.get(button.dataset.copyId);
  if (value) void copyText(value, button);
});
multiStage.addEventListener("click", (event) => {
  if (handleArtifactPreviewClick(event)) return;
  const target = event.target instanceof Element ? event.target : undefined;
  const voteButton = target?.closest<HTMLButtonElement>("button[data-vote]");
  if (!voteButton?.dataset.vote) return;
  if (currentSuite().mode === "judge" && multiRun) void voteBackgroundEvalRun(voteButton.dataset.vote as Vote);
  else voteMulti(voteButton.dataset.vote as Vote);
});
setupCopyableLog(stateInput, "GraphFrame");
setupCopyableLog(stateOutput, "GraphOps");

function pageFromHash(): PageName {
  if (location.hash === "#quick-start") return "quickstart";
  if (location.hash === "#ab") return "ab";
  if (location.hash === "#sdk-build") return "sdk-build";
  if (location.hash === "#infinite") return "infinite";
  if (location.hash === "#prompt-one") return "prompt-one";
  if (location.hash === "#prompt-two") return "prompt-two";
  if (location.hash === "#prompt-three") return "prompt-three";
  if (location.hash === "#prompt-four") return "prompt-four";
  if (location.hash === "#prompt-five") return "prompt-five";
  if (location.hash === "#prompt-six") return "prompt-six";
  return "state";
}

function suiteIdForPage(page: PageName): SuiteId | undefined {
  if (page === "prompt-one" || page === "prompt-two" || page === "prompt-three" || page === "prompt-four" || page === "prompt-five" || page === "prompt-six") return page;
  return undefined;
}

function loadAgentSettings(): AgentSettings {
  const raw = localStorage.getItem(agentSettingsStorageKey);
  if (!raw) return structuredClone(defaultAgentSettings);
  try {
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    return {
      systemPrompt: typeof parsed.systemPrompt === "string" && parsed.systemPrompt.trim() ? parsed.systemPrompt : defaultAgentSettings.systemPrompt,
      nodeTypes: normalizeNodeTypes(Array.isArray(parsed.nodeTypes) ? parsed.nodeTypes : defaultAgentSettings.nodeTypes),
      maxIterations: normalizeMaxIterations(parsed.maxIterations)
    };
  } catch {
    return structuredClone(defaultAgentSettings);
  }
}

function saveAgentSettings(): void {
  localStorage.setItem(agentSettingsStorageKey, JSON.stringify(agentSettings));
}

function persistStateChat(): void {
  try {
    if (!stateFrame) {
      localStorage.removeItem(stateChatStorageKey);
      return;
    }
    localStorage.setItem(stateChatStorageKey, JSON.stringify({ frame: stateFrame, chatHtml: chat.innerHTML, savedAt: new Date().toISOString() }));
  } catch {
    status.textContent = "Chat is too large for browser persistence; export the graph to preserve it.";
  }
}

function restoreStateChat(): void {
  const raw = localStorage.getItem(stateChatStorageKey);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as { frame?: unknown; chatHtml?: unknown; savedAt?: unknown };
    if (!isGraphFrameLike(saved.frame) || typeof saved.chatHtml !== "string") throw new Error("Invalid saved chat");
    const restored = applyAgentSettingsToFrame(saved.frame);
    if (!restored) throw new Error("Invalid saved chat");
    stateFrame = restored;
    chat.innerHTML = saved.chatHtml;
    renderGraph(restored.graph);
    stateInput.textContent = compactFrame(restored);
    stateOutput.textContent = "Restored the browser-persisted StateGraph. Continue the chat or export it.";
    status.textContent = `Restored · ${restored.graph.nodes.length} nodes / ${restored.graph.edges.length} edges`;
  } catch {
    localStorage.removeItem(stateChatStorageKey);
  }
}

function renderAgentSettings(): void {
  agentSystemPrompt.value = agentSettings.systemPrompt;
  agentNodeTypes.value = agentSettings.nodeTypes.join(", ");
  agentMaxIterations.value = String(agentSettings.maxIterations);
}

function saveAgentSettingsFromForm(): void {
  agentSettings = {
    systemPrompt: agentSystemPrompt.value.trim() || defaultAgentSettings.systemPrompt,
    nodeTypes: normalizeNodeTypes(agentNodeTypes.value.split(",")),
    maxIterations: normalizeMaxIterations(agentMaxIterations.value)
  };
  saveAgentSettings();
  stateFrame = applyAgentSettingsToFrame(stateFrame);
  abStateFrame = applyAgentSettingsToFrame(abStateFrame);
}

function applyAgentSettingsToFrame(frame: GraphFrame | undefined): GraphFrame | undefined {
  if (!frame) return undefined;
  const next = structuredClone(frame);
  next.frame.nodeTypes = agentSettings.nodeTypes;
  const root = next.graph.nodes.find((node) => node.id === "system_root" && node.type === "system");
  if (root) {
    root.text = agentSettings.systemPrompt;
    root.data = { ...root.data, activeSystemNodeId: "system_root", systemPrompt: agentSettings.systemPrompt };
  }
  return next;
}

function normalizeNodeTypes(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => /^[a-z][a-z0-9_-]{0,63}$/.test(value)))];
}

function normalizeMaxIterations(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return defaultAgentSettings.maxIterations;
  return numeric;
}

function setWorkspaceView(view: WorkspaceViewName): void {
  const items = [
    { name: "graph", tab: graphViewTab, panel: graphView },
    { name: "tools", tab: toolsViewTab, panel: toolsView },
    { name: "files", tab: filesViewTab, panel: filesView }
  ] as const;
  for (const item of items) {
    const active = item.name === view;
    item.tab.classList.toggle("active", active);
    item.tab.setAttribute("aria-selected", String(active));
    item.panel.classList.toggle("active", active);
    item.panel.hidden = !active;
  }
  if (view === "files") void loadWorkspaceFiles();
}

function currentSuite(): PromptSuite {
  return promptSuites[multiSuiteId];
}

function setActivePage(page: PageName, updateHash = true): void {
  activePage = page;
  const isState = page === "state";
  const isQuickstart = page === "quickstart";
  const isAb = page === "ab";
  const isSdkBuild = page === "sdk-build";
  const nextSuiteId = suiteIdForPage(page);
  const isMulti = Boolean(nextSuiteId);
  if (nextSuiteId && (nextSuiteId !== multiSuiteId || (!multiRun && !multiRecords.length && multiIndex === 0))) {
    multiSuiteId = nextSuiteId;
    resetMultiTest(false);
  }

  const suite = currentSuite();
  stateTab.classList.toggle("active", isState);
  stateTab.setAttribute("aria-selected", String(isState));
  quickstartTab.classList.toggle("active", isQuickstart);
  quickstartTab.setAttribute("aria-selected", String(isQuickstart));
  abTab.classList.toggle("active", isAb);
  abTab.setAttribute("aria-selected", String(isAb));
  multiTab.classList.toggle("active", page === "prompt-one");
  multiTab.setAttribute("aria-selected", String(page === "prompt-one"));
  multiTwoTab.classList.toggle("active", page === "prompt-two");
  multiTwoTab.setAttribute("aria-selected", String(page === "prompt-two"));
  multiThreeTab.classList.toggle("active", page === "prompt-three");
  multiThreeTab.setAttribute("aria-selected", String(page === "prompt-three"));
  multiFourTab.classList.toggle("active", page === "prompt-four");
  multiFourTab.setAttribute("aria-selected", String(page === "prompt-four"));
  multiFiveTab.classList.toggle("active", page === "prompt-five");
  multiFiveTab.setAttribute("aria-selected", String(page === "prompt-five"));
  multiSixTab.classList.toggle("active", page === "prompt-six");
  multiSixTab.setAttribute("aria-selected", String(page === "prompt-six"));
  sdkBuildTab.classList.toggle("active", isSdkBuild);
  sdkBuildTab.setAttribute("aria-selected", String(isSdkBuild));
  const isInfinite = page === "infinite";
  infiniteTab.classList.toggle("active", isInfinite);
  infiniteTab.setAttribute("aria-selected", String(isInfinite));
  statePage.hidden = !isState;
  statePage.classList.toggle("active", isState);
  quickstartPage.hidden = !isQuickstart;
  quickstartPage.classList.toggle("active", isQuickstart);
  abPage.hidden = !isAb;
  abPage.classList.toggle("active", isAb);
  multiPage.hidden = !isMulti;
  multiPage.classList.toggle("active", isMulti);
  sdkBuildPage.hidden = !isSdkBuild;
  sdkBuildPage.classList.toggle("active", isSdkBuild);
  infinitePage.hidden = !isInfinite;
  infinitePage.classList.toggle("active", isInfinite);
  multiTitle.textContent = suite.title;
  multiDescription.textContent = suite.description;
  reset.textContent = isState ? "Reset" : isQuickstart || isSdkBuild ? "Back to chat" : isAb ? "Reset A/B" : isInfinite ? "Reset harness" : `Reset ${suite.title.toLowerCase()}`;
  syncMultiModeControls();
  if (updateHash) history.replaceState(null, "", isState ? location.pathname : isQuickstart ? "#quick-start" : isAb ? "#ab" : isSdkBuild ? "#sdk-build" : isInfinite ? "#infinite" : `#${suite.id}`);
  if (isMulti) void resumeStoredEvalRun();
  else stopBackgroundPoll();
  if (isInfinite) {
    startSwLoopPoll();
    void loadChallengerScenarioLibrary();
  } else {
    stopSwLoopPoll();
  }
  if (isSdkBuild) startSdkBuildPoll();
  else stopSdkBuildPoll();
  if (isState) input.focus();
  else if (isAb) abInput.focus();
  else if (isSdkBuild) sdkBuildCopy.focus();
  else if (isMulti) multiStart.focus();
}

function startSdkBuildPoll(): void {
  if (sdkBuildPollTimer !== undefined) return;
  void loadSdkBuildState();
  sdkBuildPollTimer = window.setInterval(() => void loadSdkBuildState(), 2_500);
}

function stopSdkBuildPoll(): void {
  if (sdkBuildPollTimer !== undefined) window.clearInterval(sdkBuildPollTimer);
  sdkBuildPollTimer = undefined;
}

async function loadSdkBuildState(): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/api/sdk-build/state`, { cache: "no-store" });
    if (!response.ok) throw new Error(`State request failed (${response.status})`);
    sdkBuildState = await response.json() as SdkBuildPublicState;
    renderSdkBuildState(sdkBuildState);
  } catch (error) {
    renderSdkBuildState({
      status: "worker_offline",
      message: error instanceof Error ? error.message : String(error),
      canStart: false,
      canStop: false,
      environments: [{ slot: 1, status: "unknown" }, { slot: 2, status: "unknown" }]
    });
  }
}

function renderSdkBuildState(state: SdkBuildPublicState): void {
  sdkBuildLiveBadge.textContent = sdkBuildStatusLabel(state.status);
  sdkBuildLiveBadge.classList.toggle("live", state.status === "running" || state.status === "preparing" || state.status === "queued");
  sdkBuildLiveBadge.classList.toggle("ready", state.status === "ready");
  sdkBuildLiveBadge.classList.toggle("warn", state.status === "failed" || state.status === "worker_offline" || state.status === "stopped");
  sdkBuildMessage.textContent = state.message;
  sdkBuildStart.disabled = !state.canStart;
  sdkBuildStop.disabled = !state.canStop;
  renderSdkBuildEnvironment(sdkBuildEnvironmentOne, state.environments.find((environment) => environment.slot === 1));
  renderSdkBuildEnvironment(sdkBuildEnvironmentTwo, state.environments.find((environment) => environment.slot === 2));
  renderSdkBuildReview(state);
}

function renderSdkBuildEnvironment(element: HTMLElement, environment: SdkBuildEnvironment | undefined): void {
  const status = element.querySelector<HTMLElement>("[data-environment-status]");
  const progress = element.querySelector<HTMLElement>("[data-environment-progress]");
  if (!status || !progress) return;
  const value = environment?.status ?? "unknown";
  status.textContent = sdkBuildStatusLabel(value);
  status.className = `sdk-build-status ${sdkBuildStatusClass(value)}`;
  progress.textContent = environment?.progress
    ? `${environment.progress.detail} · ${environment.progress.modelCalls} model / ${environment.progress.toolCalls} tool calls`
    : "";
}

function renderSdkBuildReview(state: SdkBuildPublicState): void {
  if (!state.candidates || !state.runId) {
    sdkBuildReview.hidden = true;
    return;
  }
  sdkBuildReview.hidden = false;
  renderSdkBuildCandidate("a", state.runId, state.candidates.a, sdkBuildPreviewA, sdkBuildOpenA, sdkBuildAnswerA);
  renderSdkBuildCandidate("b", state.runId, state.candidates.b, sdkBuildPreviewB, sdkBuildOpenB, sdkBuildAnswerB);
  const judged = Boolean(state.judgement);
  for (const field of [sdkBuildScoreA, sdkBuildScoreB, sdkBuildScoreNotes, sdkBuildSubmitScore]) field.disabled = judged;
  if (!state.judgement) {
    sdkBuildReveal.hidden = true;
    return;
  }
  sdkBuildScoreA.value = String(state.judgement.scoreA);
  sdkBuildScoreB.value = String(state.judgement.scoreB);
  sdkBuildScoreNotes.value = state.judgement.notes;
  sdkBuildReveal.hidden = false;
  sdkBuildReveal.innerHTML = `
    <h3>Identity revealed</h3>
    <div class="sdk-build-reveal-grid">
      ${sdkBuildRevealCard("Candidate A", state.judgement.scoreA, state.judgement.reveal.a, state.judgement.metrics?.a)}
      ${sdkBuildRevealCard("Candidate B", state.judgement.scoreB, state.judgement.reveal.b, state.judgement.metrics?.b)}
    </div>`;
}

function renderSdkBuildCandidate(label: "a" | "b", runId: string, candidate: SdkBuildCandidate, frame: HTMLIFrameElement, link: HTMLAnchorElement, answer: HTMLElement): void {
  const previewUrl = `${apiBase}/api/sdk-build/preview/${label}/`;
  link.href = previewUrl;
  link.hidden = !candidate.previewReady;
  answer.textContent = candidate.finalAnswer || candidate.error || "No final response was recorded.";
  if (sdkBuildPreviewRunId !== runId) {
    if (candidate.previewReady) {
      frame.removeAttribute("srcdoc");
      frame.src = previewUrl;
    } else {
      frame.removeAttribute("src");
      frame.srcdoc = `<p style="font:16px system-ui;padding:24px">This candidate did not produce a previewable application.</p>`;
    }
  }
  if (label === "b") sdkBuildPreviewRunId = runId;
}

function sdkBuildRevealCard(label: string, score: number, identity: string, metrics: Record<string, number> | undefined): string {
  const metricText = metrics
    ? `${metrics.modelCalls ?? 0} model calls · ${metrics.toolCalls ?? 0} tool calls · ${formatSdkBuildDuration(metrics.durationMs ?? 0)}`
    : "Metrics unavailable";
  return `<article><span>${escapeHtml(label)} · ${score.toFixed(1)}</span><strong>${escapeHtml(identity)}</strong><p>${escapeHtml(metricText)}</p></article>`;
}

async function startSdkBuildBenchmark(): Promise<void> {
  if (!sdkBuildState?.canStart || !window.confirm("Start both one-shot OpenShell participants now? This can take a long time and cannot be restarted from this page.")) return;
  sdkBuildStart.disabled = true;
  sdkBuildMessage.textContent = "Queueing benchmark…";
  await postSdkBuildAction("start");
}

async function stopSdkBuildBenchmark(): Promise<void> {
  if (!sdkBuildState?.canStop || !window.confirm("Stop the active benchmark and preserve partial artifacts?")) return;
  sdkBuildStop.disabled = true;
  await postSdkBuildAction("stop");
}

async function postSdkBuildAction(action: "start" | "stop"): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/api/sdk-build/${action}`, { method: "POST" });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    await loadSdkBuildState();
  } catch (error) {
    sdkBuildMessage.textContent = error instanceof Error ? error.message : String(error);
    await loadSdkBuildState();
  }
}

async function submitSdkBuildScores(): Promise<void> {
  sdkBuildSubmitScore.disabled = true;
  try {
    const response = await fetch(`${apiBase}/api/sdk-build/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scoreA: sdkBuildScoreA.value, scoreB: sdkBuildScoreB.value, notes: sdkBuildScoreNotes.value })
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Scoring failed (${response.status})`);
    await loadSdkBuildState();
  } catch (error) {
    sdkBuildMessage.textContent = error instanceof Error ? error.message : String(error);
    sdkBuildSubmitScore.disabled = false;
  }
}

function sdkBuildStatusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function sdkBuildStatusClass(value: string): string {
  if (value === "completed" || value === "ready") return "success";
  if (value === "failed" || value === "stopped" || value === "worker_offline") return "error";
  if (value === "running" || value === "preparing" || value === "queued") return "working";
  return "idle";
}

function formatSdkBuildDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

async function sendStateWeaveMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || stateRunning) return;

  stateRunning = true;
  send.disabled = true;
  reset.disabled = true;
  input.value = "";
  status.textContent = "Thinking…";
  clearEmptyState(chat);
  const userMessage = appendUser(text);
  const pending = appendPendingStateWeave();
  const live = createLiveStreamLog();

  try {
    stateFrame = applyAgentSettingsToFrame(stateFrame);
    const result = await streamStateWeave(text, stateFrame, agentSettings, (event) => {
      updateLiveStreamLog(live, event);
      updatePendingStateWeave(pending, live);
      stateOutput.textContent = formatLiveStreamLog(live);
      if (event.type === "frame" && event.phase === "before") stateInput.textContent = event.prompt ?? compactFrame(event.frame);
      if (event.type === "frame") renderGraph(event.frame.graph);
      if (event.type === "error") status.textContent = event.retryable ? `GraphOps rejected at step ${event.step}; retrying…` : "GraphOps rejected.";
      if (event.type === "ops") status.textContent = `Parsed step ${event.step} GraphOps…`;
      if (event.type === "worker") status.textContent = `Scheduler ${event.phase} · worker ${event.worker.id}`;
      if (event.type === "frame" && event.phase === "after") status.textContent = `Committed step ${event.step} to StateGraph.`;
      if (event.type === "token") status.textContent = `Streaming uncommitted GraphOps · step ${event.step}…`;
    });
    stateFrame = result.stateweave.frameAfter;
    const assistantMessage = finalizePendingStateWeave(pending, result.stateweave.output, live);
    linkLatestConversationNodes(result.stateweave.graph, userMessage, assistantMessage);
    renderStateWeave(result.stateweave);
    void loadWorkspaceFiles();
    status.textContent = `Done · StateGraph ${result.stateweave.graph.nodes.length} nodes / ${result.stateweave.graph.edges.length} edges`;
    persistStateChat();
  } catch (error) {
    failPendingStateWeave(pending, error instanceof Error ? error.message : String(error), live);
    status.textContent = "Failed.";
  } finally {
    persistStateChat();
    stateRunning = false;
    send.disabled = false;
    reset.disabled = false;
    input.focus();
  }
}

async function runAbTest(): Promise<void> {
  const text = abInput.value.trim();
  if (!text || abRunning) return;

  abRunning = true;
  abSend.disabled = true;
  reset.disabled = true;
  abInput.value = "";
  abStatus.textContent = "Running A/B…";
  clearEmptyState(abResults);
  const pending = appendAbPending(text);

  try {
    abStateFrame = applyAgentSettingsToFrame(abStateFrame);
    const result = await compareStateWeave(text, abStateFrame, abRegularHistory);
    abStateFrame = result.stateweave.frameAfter;
    abRegularHistory = result.traditional.history;
    pending.remove();
    appendAbResult(text, result.traditional.output, result.stateweave.output, result.stateweave.graph);
    abStatus.textContent = `Done · StateGraph ${result.stateweave.graph.nodes.length} nodes / ${result.stateweave.graph.edges.length} edges`;
  } catch (error) {
    pending.remove();
    appendError(abResults, error instanceof Error ? error.message : String(error));
    abStatus.textContent = "Failed.";
  } finally {
    abRunning = false;
    abSend.disabled = false;
    reset.disabled = false;
    abInput.focus();
  }
}

async function streamStateWeave(text: string, frame: GraphFrame | undefined, settings: AgentSettings, onEvent: (event: StateWeaveStreamEvent) => void): Promise<StateWeaveResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame, systemPrompt: settings.systemPrompt, nodeTypes: settings.nodeTypes, maxIterations: settings.maxIterations })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  if (!response.body) throw new Error("Streaming response body was empty.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: StateWeaveResponse | undefined;
  let terminalError: string | undefined;

  const consumeLine = (line: string): void => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StateWeaveStreamEvent | { type: "error"; message: string; trace?: TraceStep[]; metadata?: StateWeaveRunMetadata };
    if (event.type === "final") {
      final = {
        stateweave: {
          inputFrame: event.result.trace[0]?.frameBefore,
          frameAfter: event.result.frame ?? event.result.trace.at(-1)?.frameAfter,
          output: event.result.finalAnswer,
          trace: event.result.trace,
          graph: event.result.graph,
          metadata: event.result.metadata
        }
      };
    } else if (event.type === "error" && !("step" in event)) {
      terminalError = event.message;
    }
    if ("step" in event || event.type === "metadata" || event.type === "final") onEvent(event as StateWeaveStreamEvent);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }
  buffer += decoder.decode();
  consumeLine(buffer);

  if (terminalError) throw new Error(terminalError);
  if (!final) throw new Error("StateWeave stream ended without a final result.");
  return final;
}

async function compareStateWeave(text: string, frame: GraphFrame | undefined, messages: ChatMessage[]): Promise<CompareResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame, messages, systemPrompt: agentSettings.systemPrompt, nodeTypes: agentSettings.nodeTypes, maxIterations: agentSettings.maxIterations })
  });

  const body = (await response.json()) as CompareResponse | { error?: string };
  if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Request failed (${response.status})`);
  return body as CompareResponse;
}

async function judgeComparison(record: MultiRecord): Promise<JudgeResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/judge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: record.prompt,
      gold: record.expect,
      answerA: answerFor(record, "a"),
      answerB: answerFor(record, "b"),
      categories: record.categories
    })
  });

  const body = (await response.json()) as JudgeResponse | { error?: string };
  if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Judge request failed (${response.status})`);
  return body as JudgeResponse;
}

function renderStateWeave(result: StateWeavePayload): void {
  stateInput.textContent = result.trace[0]?.prompt ?? (result.inputFrame ? compactFrame(result.inputFrame) : "No GraphFrame captured.");
  stateOutput.textContent = formatStateOutput(result.trace, result.output, result.metadata);
  renderGraph(result.graph);
}

async function loadHealth(): Promise<void> {
  const response = await fetch(`${apiBase}/api/health`).catch(() => undefined);
  const health = response?.ok ? ((await response.json()) as { provider?: string }) : undefined;
  provider.textContent = health?.provider ? `Provider: ${health.provider}` : "Provider unavailable";
}

async function loadTools(): Promise<void> {
  const response = await fetch(`${apiBase}/api/stateweave/tools`).catch(() => undefined);
  const body = response?.ok ? ((await response.json()) as { tools?: ToolInfo[]; workspaceDir?: string }) : undefined;
  const tools = body?.tools ?? [];
  toolCount.textContent = tools.length ? `${tools.length} tools` : "Unavailable";
  toolList.innerHTML = tools.length
    ? tools.map((tool) => `<article><code>${escapeHtml(tool.name)}</code><p>${escapeHtml(tool.description)}</p></article>`).join("")
    : "Tool list unavailable.";
}

async function loadWorkspaceFiles(): Promise<void> {
  const response = await fetch(`${apiBase}/api/stateweave/files`).catch(() => undefined);
  const body = response?.ok ? ((await response.json()) as { files?: WorkspaceFile[] }) : undefined;
  workspaceFiles = sortWorkspaceFiles(body?.files ?? []);
  fileCount.textContent = workspaceFiles.length ? `${workspaceFiles.length} file${workspaceFiles.length === 1 ? "" : "s"}` : "0 files";
  fileList.innerHTML = workspaceFiles.length ? workspaceFileListHtml(workspaceFiles) : workspaceFilesEmptyHtml();
  if (selectedFilePath && !workspaceFiles.some((file) => file.path === selectedFilePath)) selectedFilePath = undefined;
  if (!selectedFilePath) fileViewer.innerHTML = workspaceFileLandingHtml(workspaceFiles.length);
}

async function openWorkspaceFile(filePath: string): Promise<void> {
  selectedFilePath = filePath;
  renderWorkspaceFileList();
  fileViewer.innerHTML = workspaceFileLoadingHtml(filePath);
  const response = await fetch(`${apiBase}/api/stateweave/files/read?path=${encodeURIComponent(filePath)}`);
  const body = (await response.json()) as WorkspaceFileContent | { error?: string };
  if (!response.ok || !isWorkspaceFileContent(body)) {
    fileViewer.innerHTML = workspaceFileErrorHtml("error" in body ? body.error ?? "Failed to read file." : "Failed to read file.");
    return;
  }

  selectedFilePath = body.path;
  renderWorkspaceFileList();
  fileViewer.innerHTML = workspaceFileHtml(body);
}

function closeWorkspaceFile(): void {
  selectedFilePath = undefined;
  renderWorkspaceFileList();
  fileViewer.innerHTML = workspaceFileLandingHtml(workspaceFiles.length);
}

function renderWorkspaceFileList(): void {
  fileList.innerHTML = workspaceFiles.length ? workspaceFileListHtml(workspaceFiles) : workspaceFilesEmptyHtml();
}

async function rebootWorkspaceFiles(): Promise<void> {
  if (!confirm("Reboot workspace files? This removes all files written by the agent in the workspace.")) return;
  const response = await fetch(`${apiBase}/api/stateweave/files/reboot`, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    fileViewer.innerHTML = workspaceFileErrorHtml(body?.error ?? "Failed to reboot workspace.");
    return;
  }
  selectedFilePath = undefined;
  workspaceFiles = [];
  fileViewer.innerHTML = workspaceFileLandingHtml(0, "Workspace rebooted. Files removed.");
  await loadWorkspaceFiles();
}

function isWorkspaceFileContent(value: WorkspaceFileContent | { error?: string }): value is WorkspaceFileContent {
  return typeof (value as WorkspaceFileContent).path === "string" && typeof (value as WorkspaceFileContent).content === "string";
}

function workspaceFileListHtml(files: WorkspaceFile[]): string {
  return groupWorkspaceFiles(files).map(([folder, folderFiles]) => `
    <details class="file-section" open>
      <summary><span>${escapeHtml(folder)}</span><small>${folderFiles.length}</small></summary>
      <div class="file-section-list">
        ${folderFiles.map(workspaceFileRowHtml).join("")}
      </div>
    </details>`).join("");
}

function workspaceFileRowHtml(file: WorkspaceFile): string {
  const active = file.path === selectedFilePath;
  const name = fileBaseName(file.path);
  const folder = fileFolder(file.path);
  return `<button class="file-row ${active ? "active" : ""}" type="button" data-file-path="${escapeAttribute(file.path)}" title="${escapeAttribute(file.path)}">
    <span class="file-kind ${fileKindClass(file)}">${escapeHtml(fileKindLabel(file))}</span>
    <span class="file-row-main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(folder === "." ? "root" : folder)}</small></span>
    <span class="file-row-meta"><small>${formatBytes(file.size)}</small><small>${escapeHtml(file.mime)}</small></span>
  </button>`;
}

function workspaceFileHtml(file: WorkspaceFileContent): string {
  const previewDoc = file.renderable ? filePreviewSrcDoc(file) : undefined;
  const previewId = previewDoc ? registerArtifactPreview(previewDoc) : undefined;
  const sourceCopyId = registerCopy(file.content);
  const pathCopyId = registerCopy(file.path);
  const warning = file.mime === "image/svg+xml" && !looksLikeCompleteSvg(file.content)
    ? `<p class="file-render-warning">This SVG looks incomplete or invalid. Source is shown below.</p>`
    : "";
  const preview = previewDoc
    ? `<section class="file-preview-card"><div class="artifact-preview-toolbar"><span>Rendered ${escapeHtml(file.mime)}</span><button class="button secondary small-button" type="button" data-artifact-preview-id="${previewId}">Open full screen</button></div><iframe sandbox="allow-scripts" tabindex="0" srcdoc="${escapeAttribute(previewDoc)}" title="${escapeAttribute(file.path)} preview"></iframe></section>`
    : `<section class="file-empty-preview"><span class="file-kind ${fileKindClass(file)}">${escapeHtml(fileKindLabel(file))}</span><p>No rich preview for this file type. Source is shown below.</p></section>`;
  return `<article class="file-open">
    <header class="file-open-header">
      <button class="button secondary small-button file-back-button" type="button" data-file-back>Back to files</button>
      <div class="file-open-title">
        <span class="file-kind ${fileKindClass(file)}">${escapeHtml(fileKindLabel(file))}</span>
        <div>
          <h3>${escapeHtml(fileBaseName(file.path))}</h3>
          <p>${escapeHtml(file.path)}</p>
        </div>
      </div>
      <div class="file-open-actions">
        <button class="button secondary small-button" type="button" data-copy-id="${pathCopyId}">Copy path</button>
        <button class="button secondary small-button" type="button" data-copy-id="${sourceCopyId}">Copy source</button>
      </div>
    </header>
    <div class="file-meta-grid">
      <span><strong>Size</strong>${formatBytes(file.size)}</span>
      <span><strong>Type</strong>${escapeHtml(file.mime)}</span>
      <span><strong>Updated</strong>${escapeHtml(formatFileTimestamp(file.updatedAt))}</span>
    </div>
    ${warning}
    ${preview}
    <section class="file-source-card"><div class="file-source-header"><span>Source</span><small>${file.content.length.toLocaleString()} chars</small></div><pre class="code file-source">${escapeHtml(file.content)}</pre></section>
  </article>`;
}

function workspaceFilesEmptyHtml(): string {
  return `<div class="files-empty"><strong>No files yet</strong><p>Ask the agent to create HTML, SVG, Markdown, or source files. They will appear here grouped by folder.</p></div>`;
}

function workspaceFileLandingHtml(count: number, message?: string): string {
  return `<div class="file-landing">
    <div class="file-landing-icon">${count ? "⌘" : "◇"}</div>
    <h3>${message ? escapeHtml(message) : count ? "Select a file" : "Workspace is empty"}</h3>
    <p>${count ? "Choose a file from the browser to preview rendered HTML/SVG and inspect source. You can always return to the list with Back to files." : "Generated workspace files will appear here after write_file or edit_file runs."}</p>
  </div>`;
}

function workspaceFileLoadingHtml(filePath: string): string {
  return `<div class="file-landing"><div class="file-landing-icon">…</div><h3>Opening ${escapeHtml(fileBaseName(filePath))}</h3><p>${escapeHtml(filePath)}</p></div>`;
}

function workspaceFileErrorHtml(message: string): string {
  return `<div class="file-error-panel"><button class="button secondary small-button file-back-button" type="button" data-file-back>Back to files</button><p>${escapeHtml(message)}</p></div>`;
}

function sortWorkspaceFiles(files: WorkspaceFile[]): WorkspaceFile[] {
  return [...files].sort((a, b) => fileFolder(a.path).localeCompare(fileFolder(b.path)) || fileBaseName(a.path).localeCompare(fileBaseName(b.path)));
}

function groupWorkspaceFiles(files: WorkspaceFile[]): [string, WorkspaceFile[]][] {
  const groups = new Map<string, WorkspaceFile[]>();
  for (const file of files) {
    const folder = fileFolder(file.path);
    groups.set(folder, [...(groups.get(folder) ?? []), file]);
  }
  return [...groups.entries()].map(([folder, folderFiles]) => [folder === "." ? "root" : folder, folderFiles] as [string, WorkspaceFile[]]);
}

function fileFolder(pathValue: string): string {
  const parts = pathValue.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
}

function fileBaseName(pathValue: string): string {
  return pathValue.split("/").filter(Boolean).at(-1) ?? pathValue;
}

function fileExtension(pathValue: string): string {
  const name = fileBaseName(pathValue);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

function fileKindLabel(file: WorkspaceFile): string {
  const ext = fileExtension(file.path);
  if (file.mime === "image/svg+xml" || ext === "svg") return "SVG";
  if (file.mime === "text/html" || ext === "html" || ext === "htm") return "HTML";
  if (ext === "md" || ext === "mdx") return "MD";
  if (ext === "css") return "CSS";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "JS";
  if (ext === "ts" || ext === "tsx") return "TS";
  if (ext === "json") return "JSON";
  if (file.mime.startsWith("image/")) return "IMG";
  return ext ? ext.slice(0, 4).toUpperCase() : "FILE";
}

function fileKindClass(file: WorkspaceFile): string {
  const label = fileKindLabel(file).toLowerCase();
  if (["html", "svg", "css", "js", "ts", "json", "md", "img"].includes(label)) return `kind-${label}`;
  return "kind-file";
}

function formatFileTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function filePreviewSrcDoc(file: WorkspaceFileContent): string {
  if (file.mime !== "image/svg+xml") return file.content;

  if (!looksLikeCompleteSvg(file.content)) {
    return `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;font:14px system-ui;color:#b91c1c;background:#fff;"><p>Invalid or truncated SVG file. Source is shown below.</p></body></html>`;
  }

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;min-height:100vh;background:#fff;display:grid;place-items:center;}img{display:block;max-width:100%;max-height:100vh;object-fit:contain;}</style></head><body><img src="${escapeAttribute(dataUrl)}" alt="${escapeAttribute(file.path)}"></body></html>`;
}

function looksLikeCompleteSvg(content: string): boolean {
  return /<svg[\s>]/i.test(content) && /<\/svg\s*>/i.test(content);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function openGraphTransfer(mode: TransferMode): void {
  transferMode = mode;
  transferTitle.textContent = mode === "export" ? "Export current graph" : "Import graph";
  transferHelp.textContent = mode === "export"
    ? "Copy this TypeScript into another project to continue from the current GraphFrame."
    : "Paste a previous export or raw GraphFrame JSON. Import replaces the current chat graph in this lab.";
  applyImport.hidden = mode === "export";
  copyTransfer.hidden = mode === "import";
  transferText.value = mode === "export" ? graphExportCode(stateFrame) : "";
  transferModal.hidden = false;
  transferText.focus();
  transferText.select();
}

function closeGraphTransfer(): void {
  transferModal.hidden = true;
}

function applyGraphImport(): void {
  try {
    const frame = parseImportedGraphFrame(transferText.value);
    stateFrame = frame;
    primaryGraphViewState.selectedNodeId = undefined;
    primaryGraphViewState.positions.clear();
    renderGraph(frame.graph);
    stateInput.textContent = compactFrame(frame);
    stateOutput.textContent = "Imported GraphFrame. The next user turn will be appended as a pending user_input node.";
    status.textContent = `Imported · StateGraph ${frame.graph.nodes.length} nodes / ${frame.graph.edges.length} edges`;
    persistStateChat();
    closeGraphTransfer();
    setActivePage("state");
  } catch (error) {
    transferHelp.textContent = error instanceof Error ? error.message : String(error);
  }
}

function graphExportCode(frame: GraphFrame | undefined): string {
  const exportedFrame = frame ?? emptyExportFrame();
  const json = JSON.stringify(exportedFrame, null, 2);
  return `/* STATEWEAVE_FRAME_JSON_START\n${json}\nSTATEWEAVE_FRAME_JSON_END */
import { StateWeaveAgent, createModelFromEnv, type GraphFrame } from "stateweave";

const frame: GraphFrame = ${json} as GraphFrame;

const agent = new StateWeaveAgent({
  model: createModelFromEnv()
  // default file-system tools are available unless you pass a custom tools array
});

const result = await agent.run({
  objective: frame.frame.objective,
  input: "Continue from this exported graph."
}, { frame });

console.log(result.finalAnswer);
console.log(result.graph);`;
}

function parseImportedGraphFrame(value: string): GraphFrame {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Paste exported TypeScript or GraphFrame JSON first.");
  const marker = trimmed.match(/STATEWEAVE_FRAME_JSON_START\s*([\s\S]*?)\s*STATEWEAVE_FRAME_JSON_END/);
  const raw = marker?.[1] ?? trimmed;
  const parsed = JSON.parse(raw) as unknown;
  if (!isGraphFrameLike(parsed)) throw new Error("Import did not contain a valid GraphFrame with frame and graph nodes/edges.");
  return parsed;
}

function isGraphFrameLike(value: unknown): value is GraphFrame {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { frame?: unknown; graph?: { nodes?: unknown; edges?: unknown } };
  return Boolean(candidate.frame && candidate.graph && Array.isArray(candidate.graph.nodes) && Array.isArray(candidate.graph.edges));
}

function emptyExportFrame(): GraphFrame {
  const createdAt = new Date().toISOString();
  return {
    frame: {
      objective: "Continue graph",
      currentFocus: "Cortex focus is system_root. Add a user input to begin.",
      focusNodeId: "system_root",
      candidateFocusNodeIds: ["system_root"],
      nextExpectedOutput: "Append a user input and weave it with GraphOps.",
      activeConstraints: [],
      availableActions: ["add_node", "add_edge", "update_node", "focus", "call_tool", "final"]
    },
    graph: {
      nodes: [{ id: "system_root", type: "system", text: "StateWeave system root.", data: { activeSystemNodeId: "system_root" }, status: "active", confidence: 1, createdAt }],
      edges: []
    }
  };
}

function resetStateWeaveChat(): void {
  stateFrame = undefined;
  localStorage.removeItem(stateChatStorageKey);
  primaryGraphViewState.selectedNodeId = undefined;
  primaryGraphViewState.positions.clear();
  stopGraphAnimation(primaryGraphViewState);
  chat.innerHTML = `<div class="empty-state"><h2>Ask anything.</h2><p>StateWeave keeps one growing StateGraph rooted at <code>system_root</code>, then compiles a GraphFrame for the model each turn.</p></div>`;
  stateInput.textContent = "No turn yet.";
  stateOutput.textContent = "No output yet.";
  graph.className = "graph-empty";
  graph.textContent = "No graph yet.";
  status.textContent = "Reset.";
  input.focus();
}

function resetAbTests(): void {
  abStateFrame = undefined;
  abRegularHistory = [];
  copyPayloads.clear();
  abResults.innerHTML = `<div class="empty-state compact"><h2>No A/B runs yet.</h2><p>Run a prompt to see regular messages and StateWeave responses side by side.</p></div>`;
  abStatus.textContent = "Reset.";
  abInput.focus();
}

function resetMultiTest(focus = true): void {
  const suite = currentSuite();
  stopBackgroundPoll();
  multiRun = undefined;
  multiStateFrame = undefined;
  multiRegularHistory = [];
  multiIndex = 0;
  multiRunning = false;
  multiRecords = [];
  multiStart.disabled = false;
  multiStart.textContent = `Start ${suite.title.toLowerCase()}`;
  multiTitle.textContent = suite.title;
  multiDescription.textContent = suite.description;
  multiStage.innerHTML = `<div class="empty-state compact"><h2>${escapeHtml(suite.readyTitle)}</h2><p>${escapeHtml(suite.readyCopy)}</p></div>${hypothesisPanel(suite)}`;
  syncMultiModeControls();
  renderMultiProgress();
  if (focus) multiStart.focus();
}

async function resetCurrentMultiTest(): Promise<void> {
  if (multiRun && (multiRun.status === "queued" || multiRun.status === "running" || multiRun.status === "paused")) {
    await stopBackgroundEvalRun(multiRun.id).catch(() => undefined);
  }
  localStorage.removeItem(backgroundRunStorageKey());
  resetMultiTest();
}

function syncMultiModeControls(): void {
  const isJudge = currentSuite().mode === "judge";
  multiConfirmWrap.hidden = !isJudge;
  if (!isJudge) return;
  multiConfirmJudges.checked = multiRun?.confirmJudges ?? multiConfirmJudges.checked;
}

function hypothesisPanel(suite: PromptSuite): string {
  if (!suite.hypothesis) return "";
  return `
    <article class="hypothesis-card">
      <p class="eyebrow">Hypothesis</p>
      <h3>Long-context regression thesis</h3>
      <p><strong>Thesis:</strong> ${escapeHtml(suite.hypothesis.thesis)}</p>
      <p><strong>Method:</strong> ${escapeHtml(suite.hypothesis.method)}</p>
      <p><strong>Prediction:</strong> ${escapeHtml(suite.hypothesis.prediction)}</p>
      <p><strong>Success signal:</strong> ${escapeHtml(suite.hypothesis.successSignal)}</p>
    </article>`;
}

function backgroundRunStorageKey(): string {
  return `stateweave.evalRun.${currentSuite().id}`;
}

async function resumeStoredEvalRun(): Promise<void> {
  if (currentSuite().mode !== "judge") return;
  const runId = localStorage.getItem(backgroundRunStorageKey());
  try {
    const run = runId ? await fetchBackgroundEvalRun(runId) : await fetchLatestBackgroundEvalRun(currentSuite().id);
    if (!run) {
      syncMultiModeControls();
      return;
    }
    if (run.suiteId !== currentSuite().id || run.status === "stopped") {
      localStorage.removeItem(backgroundRunStorageKey());
      return;
    }
    localStorage.setItem(backgroundRunStorageKey(), run.id);
    renderBackgroundEvalRun(run);
    scheduleBackgroundPoll(run);
  } catch {
    localStorage.removeItem(backgroundRunStorageKey());
  }
}

async function startBackgroundEvalRun(): Promise<void> {
  const suite = currentSuite();
  if (suite.mode !== "judge") return;
  const active = multiRun && (multiRun.status === "queued" || multiRun.status === "running" || multiRun.status === "paused");
  if (active) return;

  multiStart.disabled = true;
  multiStart.textContent = "Starting background run…";
  multiStage.innerHTML = `<div class="multi-loading">Starting server-side eval run…</div>`;
  const response = await fetch(`${apiBase}/api/stateweave/eval-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      suiteId: suite.id,
      suiteTitle: suite.title,
      cases: suite.cases,
      confirmJudges: multiConfirmJudges.checked
    })
  });
  const body = (await response.json()) as { run?: EvalRun; error?: string };
  if (!response.ok || !body.run) {
    multiStage.innerHTML = `<div class="message error"><div>${escapeHtml(body.error ?? `Request failed (${response.status})`)}</div></div>`;
    multiStart.disabled = false;
    multiStart.textContent = `Start ${suite.title.toLowerCase()}`;
    return;
  }
  localStorage.setItem(backgroundRunStorageKey(), body.run.id);
  renderBackgroundEvalRun(body.run);
  scheduleBackgroundPoll(body.run);
}

async function fetchBackgroundEvalRun(id: string): Promise<EvalRun> {
  const response = await fetch(`${apiBase}/api/stateweave/eval-runs/${encodeURIComponent(id)}`);
  const body = (await response.json()) as { run?: EvalRun; error?: string };
  if (!response.ok || !body.run) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body.run;
}

async function fetchLatestBackgroundEvalRun(suiteId: SuiteId): Promise<EvalRun | undefined> {
  const response = await fetch(`${apiBase}/api/stateweave/eval-runs`);
  const body = (await response.json()) as { runs?: EvalRun[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body.runs?.find((run) => run.suiteId === suiteId && run.status !== "stopped");
}

async function voteBackgroundEvalRun(vote: Vote): Promise<void> {
  if (!multiRun) return;
  const response = await fetch(`${apiBase}/api/stateweave/eval-runs/${encodeURIComponent(multiRun.id)}/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vote })
  });
  const body = (await response.json()) as { run?: EvalRun; error?: string };
  if (!response.ok || !body.run) {
    multiStage.insertAdjacentHTML("afterbegin", `<div class="message error"><div>${escapeHtml(body.error ?? `Request failed (${response.status})`)}</div></div>`);
    return;
  }
  renderBackgroundEvalRun(body.run);
  scheduleBackgroundPoll(body.run);
}

async function updateBackgroundEvalOptions(confirmJudges: boolean): Promise<void> {
  if (!multiRun || currentSuite().mode !== "judge") return;
  const response = await fetch(`${apiBase}/api/stateweave/eval-runs/${encodeURIComponent(multiRun.id)}/options`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmJudges })
  });
  const body = (await response.json()) as { run?: EvalRun; error?: string };
  if (response.ok && body.run) {
    renderBackgroundEvalRun(body.run);
    scheduleBackgroundPoll(body.run);
  }
}

async function stopBackgroundEvalRun(id: string): Promise<void> {
  await fetch(`${apiBase}/api/stateweave/eval-runs/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

function scheduleBackgroundPoll(run: EvalRun): void {
  stopBackgroundPoll();
  if (run.status === "queued" || run.status === "running") {
    multiRunPollTimer = window.setTimeout(() => void pollBackgroundEvalRun(run.id), 1500);
  }
}

async function pollBackgroundEvalRun(id: string): Promise<void> {
  try {
    const run = await fetchBackgroundEvalRun(id);
    renderBackgroundEvalRun(run);
    scheduleBackgroundPoll(run);
  } catch (error) {
    multiStage.insertAdjacentHTML("afterbegin", `<div class="message error"><div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div></div>`);
  }
}

function stopBackgroundPoll(): void {
  if (multiRunPollTimer !== undefined) window.clearTimeout(multiRunPollTimer);
  multiRunPollTimer = undefined;
}

function renderBackgroundEvalRun(run: EvalRun): void {
  multiRun = run;
  multiRecords = run.records;
  multiIndex = run.currentIndex;
  multiConfirmJudges.checked = run.confirmJudges;
  syncMultiModeControls();
  renderMultiProgress();

  if (run.status === "done") {
    renderMultiReveal();
    multiStart.disabled = true;
    multiStart.textContent = `${currentSuite().title} complete`;
    return;
  }

  if (run.status === "error") {
    multiStage.innerHTML = `<div class="message error"><div>${escapeHtml(run.error ?? "Background eval failed.")}</div></div>`;
    multiStart.disabled = false;
    multiStart.textContent = "Start new run";
    return;
  }

  if (run.status === "stopped") {
    multiStage.innerHTML = `<div class="empty-state compact"><h2>Run stopped.</h2><p>Reset or start a new eval run.</p></div>`;
    multiStart.disabled = false;
    multiStart.textContent = `Start ${currentSuite().title.toLowerCase()}`;
    return;
  }

  const latest = run.records.at(-1);
  if (run.status === "paused" && latest && !latest.vote) {
    renderJudgeDisagreement(latest);
    return;
  }

  if (latest?.vote || latest?.proposedVote) {
    renderMultiAutoJudged(latest);
  } else {
    const next = run.cases[run.currentIndex];
    if (next) renderMultiCaseLoading(next, run.currentIndex);
  }
  multiStart.disabled = true;
  multiStart.textContent = `Running ${Math.min(run.currentIndex + 1, run.cases.length)} / ${run.cases.length} in background…`;
}

async function runNextMultiCase(): Promise<void> {
  const cases = currentSuite().cases;
  if (multiRunning || multiIndex >= cases.length) return;
  const testCase = cases[multiIndex];
  multiRunning = true;
  multiStart.disabled = true;
  multiStart.textContent = `Running ${multiIndex + 1} / ${cases.length}…`;
  renderMultiCaseLoading(testCase, multiIndex);

  try {
    const result = await compareStateWeave(testCase.prompt, multiStateFrame, multiRegularHistory);
    multiStateFrame = result.stateweave.frameAfter;
    multiRegularHistory = result.traditional.history;
    const stateIsA = Math.random() < 0.5;
    const record: MultiRecord = {
      index: multiIndex,
      prompt: testCase.prompt,
      expect: testCase.expect,
      categories: testCase.categories ?? [],
      a: stateIsA ? "stateweave" : "regular",
      b: stateIsA ? "regular" : "stateweave",
      regular: result.traditional.output,
      stateweave: result.stateweave.output
    };

    if (currentSuite().mode === "judge") {
      renderMultiJudging(record);
      const judge = await judgeComparison(record);
      record.judges = judge.judges;
      multiRecords.push(record);
      if (judge.agreement) {
        record.vote = judge.agreement;
        record.judgedBy = "judges";
        multiIndex += 1;
        renderMultiProgress();
        renderMultiAutoJudged(record);
        if (multiIndex >= currentSuite().cases.length) {
          window.setTimeout(renderMultiReveal, autoJudgePreviewMs);
        } else {
          window.setTimeout(() => void runNextMultiCase(), autoJudgePreviewMs);
        }
      } else {
        renderMultiProgress();
        renderJudgeDisagreement(record);
      }
      return;
    }

    multiRecords.push(record);
    renderMultiVote(record);
  } catch (error) {
    multiStage.innerHTML = `<div class="message error"><div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div></div>`;
    multiStart.disabled = false;
    multiStart.textContent = "Retry current prompt";
  } finally {
    multiRunning = false;
  }
}

function voteMulti(vote: Vote): void {
  const record = multiRecords[multiRecords.length - 1];
  if (!record || record.vote) return;
  record.vote = vote;
  record.judgedBy = currentSuite().mode === "judge" ? "human" : record.judgedBy;
  multiIndex += 1;
  renderMultiProgress();

  if (multiIndex >= currentSuite().cases.length) {
    renderMultiReveal();
    multiStart.disabled = true;
    multiStart.textContent = `${currentSuite().title} complete`;
    return;
  }

  if (currentSuite().mode === "judge") {
    renderMultiAutoJudged(record);
    multiStart.disabled = true;
    multiStart.textContent = `Running ${multiIndex + 1} / ${currentSuite().cases.length}…`;
    window.setTimeout(() => void runNextMultiCase(), autoJudgePreviewMs);
    return;
  }

  multiStart.disabled = false;
  multiStart.textContent = `Run prompt ${multiIndex + 1}`;
  renderMultiReadyNext();
}

function renderMultiProgress(): void {
  const cases = currentSuite().cases;
  const voted = multiRecords.filter((record) => record.vote).length;
  multiProgress.textContent = `${voted} / ${cases.length} voted`;
  multiLiveScore.innerHTML = liveScoreHtml();
  multiSteps.innerHTML = cases.map((item, index) => {
    const record = multiRecords[index];
    const state = record?.vote ? "done" : index === multiIndex ? "current" : index < multiIndex ? "done" : "";
    return `<div class="multi-step ${state}"><span>${index + 1}</span><p>${escapeHtml(shorten(item.prompt, 54))}</p></div>`;
  }).join("");
}

function renderMultiCaseLoading(testCase: MultiCase, index: number): void {
  const suite = currentSuite();
  renderMultiProgress();
  multiStage.innerHTML = `
    <article class="multi-card">
      <div class="multi-case-header">
        <p class="eyebrow">Prompt ${index + 1} / ${suite.cases.length}</p>
        <h2>${escapeHtml(testCase.prompt)}</h2>
        <p class="expectation"><strong>${escapeHtml(suite.expectLabel)}:</strong> ${escapeHtml(testCase.expect)}</p>
        ${categoryPills(testCase.categories ?? [])}
      </div>
      <div class="multi-loading">Running regular messages and StateWeave…</div>
    </article>`;
}

function answerFor(record: MultiRecord, slot: "a" | "b"): string {
  const primitive = record[slot];
  return primitive === "stateweave" ? record.stateweave : record.regular;
}

function renderMultiVote(record: MultiRecord): void {
  const suite = currentSuite();
  const a = answerFor(record, "a");
  const b = answerFor(record, "b");
  multiStage.innerHTML = `
    <article class="multi-card">
      <div class="multi-case-header">
        <p class="eyebrow">Prompt ${record.index + 1} / ${suite.cases.length}</p>
        <h2>${escapeHtml(record.prompt)}</h2>
        <p class="expectation"><strong>${escapeHtml(suite.expectLabel)}:</strong> ${escapeHtml(record.expect)}</p>
        ${categoryPills(record.categories)}
      </div>
      <div class="blind-grid">
        <article class="blind-answer"><h3>Answer A</h3>${responseHtml(a)}</article>
        <article class="blind-answer"><h3>Answer B</h3>${responseHtml(b)}</article>
      </div>
      <div class="vote-bar" aria-label="Vote">
        <button class="button primary" type="button" data-vote="a">A is correct</button>
        <button class="button primary" type="button" data-vote="b">B is correct</button>
        <button class="button secondary" type="button" data-vote="both">Both</button>
        <button class="button secondary" type="button" data-vote="neither">Neither</button>
      </div>
    </article>`;
}

function renderMultiJudging(record: MultiRecord): void {
  multiStage.innerHTML = `
    <article class="multi-card">
      <div class="multi-case-header">
        <p class="eyebrow">Prompt ${record.index + 1} / ${currentSuite().cases.length}</p>
        <h2>${escapeHtml(record.prompt)}</h2>
        <p class="expectation"><strong>${escapeHtml(currentSuite().expectLabel)}:</strong> ${escapeHtml(record.expect)}</p>
        ${categoryPills(record.categories)}
      </div>
      <div class="blind-grid compact-blind">
        <article class="blind-answer"><h3>Answer A</h3>${responseHtml(answerFor(record, "a"))}</article>
        <article class="blind-answer"><h3>Answer B</h3>${responseHtml(answerFor(record, "b"))}</article>
      </div>
      <div class="multi-loading">Running two independent judges…</div>
    </article>`;
}

function renderMultiAutoJudged(record: MultiRecord): void {
  renderMultiProgress();
  multiStage.innerHTML = `
    <article class="multi-card">
      <div class="multi-case-header">
        <p class="eyebrow">Prompt ${record.index + 1} judged</p>
        <h2>${escapeHtml(record.prompt)}</h2>
        <p class="expectation"><strong>${escapeHtml(currentSuite().expectLabel)}:</strong> ${escapeHtml(record.expect)}</p>
        ${categoryPills(record.categories)}
      </div>
      <div class="judge-result ${record.judgedBy === "human" ? "human" : "agreed"}">
        <strong>${record.judgedBy === "human" ? "Human vote" : "Judges agreed"}: ${voteLabel(record.vote)}</strong>
        ${record.judges ? record.judges.map((judge) => `<p>${escapeHtml(judge.id)}: ${voteLabel(judge.vote)} — ${escapeHtml(judge.reason)}</p>`).join("") : ""}
        ${judgeRawDetails(record.judges)}
      </div>
      <div class="result-score">
        ${liveScoreHtml()}
      </div>
    </article>`;
}

function renderJudgeDisagreement(record: MultiRecord): void {
  renderMultiProgress();
  const confirming = record.pauseReason === "confirm" && record.proposedVote;
  multiStart.disabled = true;
  multiStart.textContent = confirming ? "Waiting for judge confirmation" : "Waiting for human vote";
  multiStage.innerHTML = `
    <article class="multi-card">
      <div class="multi-case-header">
        <p class="eyebrow">${confirming ? "Confirm judge decision" : "Judge disagreement"} · Prompt ${record.index + 1} / ${currentSuite().cases.length}</p>
        <h2>${escapeHtml(record.prompt)}</h2>
        <p class="expectation"><strong>${escapeHtml(currentSuite().expectLabel)}:</strong> ${escapeHtml(record.expect)}</p>
        ${categoryPills(record.categories)}
      </div>
      <div class="judge-result ${confirming ? "agreed" : "disagreement"}">
        ${confirming ? `<p><strong>Proposed vote:</strong> ${voteLabel(record.proposedVote)}</p>` : ""}
        ${record.judges?.map((judge) => `<p><strong>${escapeHtml(judge.id)}:</strong> ${voteLabel(judge.vote)} — ${escapeHtml(judge.reason)}</p>`).join("") ?? ""}
        ${judgeRawDetails(record.judges)}
      </div>
      <div class="result-score">
        ${liveScoreHtml()}
      </div>
      <div class="blind-grid">
        <article class="blind-answer"><h3>Answer A</h3>${responseHtml(answerFor(record, "a"))}</article>
        <article class="blind-answer"><h3>Answer B</h3>${responseHtml(answerFor(record, "b"))}</article>
      </div>
      <div class="vote-bar" aria-label="Human tie-break vote">
        ${confirming ? `<button class="button primary" type="button" data-vote="${record.proposedVote}">Accept judges: ${voteLabel(record.proposedVote)}</button>` : ""}
        <button class="button ${confirming ? "secondary" : "primary"}" type="button" data-vote="a">A is correct</button>
        <button class="button ${confirming ? "secondary" : "primary"}" type="button" data-vote="b">B is correct</button>
        <button class="button secondary" type="button" data-vote="both">Both</button>
        <button class="button secondary" type="button" data-vote="neither">Neither</button>
      </div>
    </article>`;
}

function judgeRawDetails(judges: JudgeDecision[] | undefined): string {
  if (!judges?.length) return "";
  const raw = judges.map((judge) => `${judge.id}:\n${judge.raw.trim()}`).join("\n\n---\n\n");
  return `<details class="judge-raw" open><summary>Raw judge LLM responses</summary><pre>${escapeHtml(raw)}</pre></details>`;
}

function categoryPills(categories: EvalCategory[]): string {
  return categories.length ? `<div class="category-pills">${categories.map((category) => `<span>${escapeHtml(category)}</span>`).join("")}</div>` : "";
}

function renderMultiReadyNext(): void {
  const suite = currentSuite();
  const next = suite.cases[multiIndex];
  multiStage.innerHTML = `
    <article class="multi-card ready-next">
      <p class="eyebrow">Next prompt</p>
      <h2>${escapeHtml(next.prompt)}</h2>
      <p class="expectation"><strong>${escapeHtml(suite.expectLabel)}:</strong> ${escapeHtml(next.expect)}</p>
      ${categoryPills(next.categories ?? [])}
      <p class="muted-copy">Click “${escapeHtml(multiStart.textContent ?? "Run next prompt")}" when ready. Labels remain hidden until all votes are complete.</p>
    </article>`;
}

function renderMultiReveal(): void {
  const suite = currentSuite();
  const scores = multiScores();
  multiStage.innerHTML = `
    <article class="multi-card">
      <div class="multi-case-header">
        <p class="eyebrow">${escapeHtml(suite.title)} complete</p>
        <h2>${winnerText(scores)}</h2>
        <p class="expectation">StateWeave ${scores.stateweave} · Regular ${scores.regular} · Both ${scores.both} · Neither ${scores.neither}</p>
      </div>
      ${hypothesisPanel(suite)}
      ${regressionSummaryHtml()}
      ${categorySummaryTable()}
      <div class="reveal-list">
        ${multiRecords.map((record) => revealRow(record)).join("")}
      </div>
    </article>`;
}

function revealRow(record: MultiRecord): string {
  const selected = voteLabel(record.vote);
  const winner = winnerForRecord(record);
  return `
    <article class="reveal-row">
      <div>
        <p class="eyebrow">Prompt ${record.index + 1}</p>
        <h3>${escapeHtml(record.prompt)}</h3>
        <p class="expectation">${escapeHtml(record.expect)}</p>
        ${categoryPills(record.categories)}
      </div>
      <div class="reveal-meta">
        <span>A = ${primitiveLabel(record.a)}</span>
        <span>B = ${primitiveLabel(record.b)}</span>
        <strong>Vote: ${selected}</strong>
        <strong>Credit: ${winner}</strong>
        ${record.judgedBy ? `<span>By: ${record.judgedBy}</span>` : ""}
      </div>
    </article>`;
}

function liveScoreHtml(): string {
  const scores = multiScores();
  const total = currentSuite().cases.length;
  return `
    <div class="live-score-header"><span>Live score</span><strong>${scores.completed} / ${total}</strong></div>
    <div class="live-score-grid">
      <div><span>StateWeave</span><strong>${scores.stateweave}</strong></div>
      <div><span>Regular</span><strong>${scores.regular}</strong></div>
      <div><span>Both</span><strong>${scores.both}</strong></div>
      <div><span>Neither</span><strong>${scores.neither}</strong></div>
    </div>
    ${regressionSummaryHtml()}
    ${trendChartHtml()}
    ${liveCategoryScoreHtml()}`;
}

function trendBucketSize(): number {
  return currentSuite().id === "prompt-six" ? 30 : 10;
}

function trendChartHtml(): string {
  const total = currentSuite().cases.length;
  const size = trendBucketSize();
  const rows: string[] = [];
  for (let start = 0; start < total; start += size) {
    const end = Math.min(total, start + size);
    const records = multiRecords.filter((record) => record.index >= start && record.index < end && record.vote);
    const scores = scoreRecords(records);
    if (!scores.completed && start > multiIndex + size) continue;
    const pct = (value: number) => scores.completed ? Math.round((value / scores.completed) * 100) : 0;
    rows.push(`
      <div class="trend-row">
        <span>${start + 1}-${end}</span>
        <div class="trend-bar" title="SW ${scores.stateweave}, Reg ${scores.regular}, Both ${scores.both}, Neither ${scores.neither}">
          <i class="sw" style="width:${pct(scores.stateweave)}%"></i>
          <i class="reg" style="width:${pct(scores.regular)}%"></i>
          <i class="both" style="width:${pct(scores.both)}%"></i>
          <i class="neither" style="width:${pct(scores.neither)}%"></i>
        </div>
        <strong>${scores.completed}/${end - start}</strong>
      </div>`);
  }
  if (!rows.length) return "";
  return `<div class="trend-chart"><div class="trend-legend"><span class="sw">SW</span><span class="reg">Regular</span><span class="both">Both</span><span class="neither">Neither</span></div>${rows.join("")}</div>`;
}

function regressionSummaryHtml(): string {
  if (!currentSuite().hypothesis) return "";
  const size = trendBucketSize();
  const first = scoreRecords(multiRecords.filter((record) => record.index < size && record.vote));
  const completedBuckets = [] as ScoreBreakdown[];
  for (let start = 0; start < currentSuite().cases.length; start += size) {
    const scores = scoreRecords(multiRecords.filter((record) => record.index >= start && record.index < start + size && record.vote));
    if (scores.completed) completedBuckets.push(scores);
  }
  const latest = completedBuckets.at(-1);
  if (!latest || !first.completed) return `<div class="regression-summary">Collecting bucketed regression stats…</div>`;
  const fmt = (value: number) => `${Math.round(value * 100)}%`;
  const swFirst = creditRate(first, "stateweave");
  const swLatest = creditRate(latest, "stateweave");
  const regFirst = creditRate(first, "regular");
  const regLatest = creditRate(latest, "regular");
  return `
    <div class="regression-summary">
      <strong>Regression snapshot</strong>
      <span>SW credit ${fmt(swFirst)} → ${fmt(swLatest)} (${signedPct(swLatest - swFirst)})</span>
      <span>Regular credit ${fmt(regFirst)} → ${fmt(regLatest)} (${signedPct(regLatest - regFirst)})</span>
      <span>Neither latest bucket: ${fmt(latest.neither / latest.completed)}</span>
    </div>`;
}

function creditRate(scores: ScoreBreakdown, primitive: Primitive): number {
  return scores.completed ? (scores[primitive] + scores.both) / scores.completed : 0;
}

function signedPct(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function liveCategoryScoreHtml(): string {
  const categories = currentSuiteCategories();
  if (!categories.length) return "";
  const rows = categories.map((category) => {
    const categoryTotal = currentSuite().cases.filter((item) => item.categories?.includes(category)).length;
    const scores = scoreRecords(multiRecords.filter((record) => record.categories.includes(category)));
    return `<tr><td>${category}</td><td>${scores.stateweave}</td><td>${scores.regular}</td><td>${scores.both}</td><td>${scores.neither}</td><td>${scores.completed}/${categoryTotal}</td></tr>`;
  }).join("");
  return `<table class="live-category-summary"><thead><tr><th>Cat</th><th>SW</th><th>Reg</th><th>Both</th><th>Neither</th><th>Done</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function categorySummaryTable(): string {
  const categories = currentSuiteCategories();
  if (!categories.length) return "";
  const rows = categories.map((category) => {
    const records = multiRecords.filter((record) => record.categories.includes(category));
    const scores = scoreRecords(records);
    return `<tr><td>${category}</td><td>${scores.stateweave}</td><td>${scores.regular}</td><td>${scores.both}</td><td>${scores.neither}</td><td>${scores.completed}</td></tr>`;
  }).join("");
  return `<table class="category-summary"><thead><tr><th>Category</th><th>StateWeave</th><th>Regular</th><th>Both</th><th>Neither</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function currentSuiteCategories(): EvalCategory[] {
  const present = new Set(currentSuite().cases.flatMap((item) => item.categories ?? []));
  const ordered = categoryOrder.filter((category) => present.has(category));
  const extra = [...present].filter((category) => !ordered.includes(category));
  return [...ordered, ...extra];
}

function multiScores(): ScoreBreakdown {
  return scoreRecords(multiRecords);
}

function scoreRecords(records: MultiRecord[]): ScoreBreakdown {
  return scoreEvalRecords(records);
}

function winnerForRecord(record: MultiRecord): string {
  if (record.vote === "both") return "Both";
  if (record.vote === "neither" || !record.vote) return "Neither";
  return primitiveLabel(record[record.vote]);
}

function winnerText(scores: ScoreBreakdown): string {
  if (scores.stateweave > scores.regular) return "StateWeave won the blind vote";
  if (scores.regular > scores.stateweave) return "Regular messages won the blind vote";
  return "Blind vote ended in a tie";
}

function primitiveLabel(value: Primitive): string {
  return value === "stateweave" ? "StateWeave" : "Regular";
}

function voteLabel(value: Vote | undefined): string {
  if (value === "a") return "A";
  if (value === "b") return "B";
  if (value === "both") return "Both";
  return "Neither";
}

function appendUser(text: string): HTMLElement {
  chat.insertAdjacentHTML("beforeend", `<div class="message user"><div class="markdown">${renderMarkdown(text)}</div></div>`);
  scrollChat(chat);
  return chat.lastElementChild as HTMLElement;
}

function linkLatestConversationNodes(graphValue: StateGraph, userMessage: HTMLElement, assistantMessage: HTMLElement): void {
  const userNode = latestNodeOfType(graphValue, "user_input");
  const assistantNode = latestNodeOfType(graphValue, "assistant_output");
  if (userNode) userMessage.dataset.nodeId = userNode.id;
  if (assistantNode) assistantMessage.dataset.nodeId = assistantNode.id;
}

function latestNodeOfType(graphValue: StateGraph, type: StateGraph["nodes"][number]["type"]): StateGraph["nodes"][number] | undefined {
  return graphValue.nodes.filter((node) => node.type === type).at(-1);
}

function createLiveStreamLog(): LiveStreamLog {
  return { steps: new Map(), events: [] };
}

function ensureLiveStep(live: LiveStreamLog, stepNumber: number): LiveStreamStep {
  const existing = live.steps.get(stepNumber);
  if (existing) return existing;
  const step: LiveStreamStep = { step: stepNumber, status: "streaming", rawModelOutput: "", modelMetadata: [], workers: new Map() };
  live.steps.set(stepNumber, step);
  return step;
}

function updateLiveStreamLog(live: LiveStreamLog, event: StateWeaveStreamEvent): void {
  if (event.type === "metadata") {
    live.metadata = event.metadata;
    live.events.push(`run ${event.metadata.runId} started · maxIterations=${event.metadata.maxIterations}`);
    return;
  }
  if (event.type === "frame" && event.phase === "before") {
    const step = ensureLiveStep(live, event.step);
    live.latestStep = event.step;
    live.prompt = event.prompt;
    step.status = "streaming";
    step.tokenEstimate = event.tokenEstimate?.estimatedTokens;
    live.events.push(`step ${event.step} model call · promptTokens≈${event.tokenEstimate?.estimatedTokens ?? "unknown"}`);
    return;
  }
  if (event.type === "token") {
    const step = ensureLiveStep(live, event.step);
    live.latestStep = event.step;
    step.status = "streaming";
    step.rawModelOutput += event.token;
    return;
  }
  if (event.type === "model_metadata") {
    const step = ensureLiveStep(live, event.step);
    step.modelMetadata.push(event.metadata);
    const stopReason = typeof event.metadata.stopReason === "string" ? ` · stop=${event.metadata.stopReason}` : "";
    live.events.push(`step ${event.step} model metadata${stopReason}`);
    return;
  }
  if (event.type === "ops") {
    const step = ensureLiveStep(live, event.step);
    step.status = "parsed";
    step.parsedOps = event.ops;
    live.events.push(`step ${event.step} parsed GraphOps\n${formatOps(event.ops)}`);
    return;
  }
  if (event.type === "worker") {
    const step = ensureLiveStep(live, event.step);
    const existing = step.workers.get(event.worker.id) ?? { ...event.worker, tokens: "" };
    const nextWorker: LiveWorker = { ...existing, ...event.worker, tokens: existing.tokens };
    if (event.token) nextWorker.tokens += event.token;
    if (event.ops) nextWorker.ops = event.ops;
    step.workers.set(event.worker.id, nextWorker);
    live.events.push(`step ${event.step} worker ${event.worker.id} ${event.phase}${event.worker.finalAnswer ? ` · ${event.worker.finalAnswer}` : event.worker.error ? ` · ${event.worker.error}` : ""}`);
    return;
  }
  if (event.type === "error") {
    const step = ensureLiveStep(live, event.step);
    step.status = event.retryable ? "retrying" : "rejected";
    step.error = event.message;
    step.retryable = event.retryable;
    live.events.push(`step ${event.step} GraphOps rejected${event.retryable ? " · retrying" : ""}\n${event.message}`);
    return;
  }
  if (event.type === "frame" && event.phase === "after") {
    const step = ensureLiveStep(live, event.step);
    step.status = "committed";
    step.nodeCount = event.frame.graph.nodes.length;
    step.edgeCount = event.frame.graph.edges.length;
    live.events.push(`step ${event.step} committed · ${event.frame.graph.nodes.length} nodes / ${event.frame.graph.edges.length} edges`);
    return;
  }
  if (event.type === "final") {
    live.metadata = event.result.metadata;
    live.finalAnswer = event.result.finalAnswer;
    live.events.push(`final · steps=${event.result.metadata.stepCount} retries=${event.result.metadata.retryCount} duration=${event.result.metadata.durationMs ?? 0}ms`);
  }
}

function formatLiveStreamLog(live: LiveStreamLog): string {
  const metadata = live.metadata ? [`metadata:`, JSON.stringify(live.metadata, null, 2), ""] : [];
  const prompt = live.prompt ? [`current model prompt:`, live.prompt, ""] : [];
  const stepSections = [...live.steps.values()].map((step) => {
    const modelMetadata = step.modelMetadata.length ? [`step ${step.step} provider metadata:`, JSON.stringify(step.modelMetadata, null, 2)] : [];
    const workers = step.workers.size ? [`step ${step.step} workers:`, [...step.workers.values()].map((worker) => `${worker.id} ${worker.status}: ${worker.finalAnswer ?? worker.error ?? worker.objective}`).join("\n")] : [];
    return [
      `step ${step.step} status: ${step.status}`,
      ...(step.tokenEstimate ? [`step ${step.step} promptTokens≈${step.tokenEstimate}`] : []),
      ...workers,
      ...modelMetadata,
      `step ${step.step} raw model output:`, 
      step.rawModelOutput,
      ...(step.parsedOps ? [`step ${step.step} parsed GraphOps:`, formatOps(step.parsedOps)] : []),
      ...(step.error ? [`step ${step.step} GraphOps error:`, step.error] : []),
      ...(typeof step.nodeCount === "number" ? [`step ${step.step} graph: ${step.nodeCount} nodes / ${step.edgeCount ?? 0} edges`] : [])
    ].join("\n");
  });
  return [...metadata, ...prompt, ...live.events, ...stepSections].join("\n\n").trim() || "Waiting for StateWeave stream…";
}

function updatePendingStateWeave(item: HTMLElement, live: LiveStreamLog): void {
  const statusEl = item.querySelector<HTMLElement>("[data-stream-status]");
  const stepsEl = item.querySelector<HTMLElement>("[data-stream-steps]");
  const latestStep = live.latestStep;
  const maxIterations = live.metadata?.maxIterations;
  if (statusEl) {
    statusEl.textContent = live.finalAnswer
      ? `Done · ${live.metadata?.stepCount ?? live.steps.size} step${(live.metadata?.stepCount ?? live.steps.size) === 1 ? "" : "s"}`
      : latestStep
        ? `Weaving GraphOps · step ${latestStep}${maxIterations ? ` / ${maxIterations}` : ""}`
        : "Opening StateWeave stream…";
  }
  if (stepsEl) {
    const openSteps = new Set([...stepsEl.querySelectorAll<HTMLDetailsElement>("details.stream-step[open]")].map((detail) => Number(detail.dataset.step)));
    if (!openSteps.size && latestStep) openSteps.add(latestStep);
    stepsEl.innerHTML = renderLiveSteps(live, openSteps);
  }
  scrollChat(chat);
}

function appendPendingStateWeave(): HTMLElement {
  const item = document.createElement("article");
  item.className = "answer pending assistant-response state-stream-card";
  item.innerHTML = `
    <div class="stream-card-header">
      <div>
        <span class="eyebrow">StateWeave</span>
        <strong data-stream-status>Opening StateWeave stream…</strong>
      </div>
      <span class="stream-orb" aria-hidden="true"></span>
    </div>
    <div class="stream-steps" data-stream-steps>
      <p class="stream-empty">Waiting for the first GraphOps step…</p>
    </div>`;
  chat.append(item);
  scrollChat(chat);
  return item;
}

function finalizePendingStateWeave(item: HTMLElement, stateweave: string, live: LiveStreamLog): HTMLElement {
  item.classList.remove("pending", "state-stream-card");
  item.classList.add("state-answer", "assistant-final-card");
  item.innerHTML = `
    <div class="assistant-final-header">
      <span>StateWeave</span>
    </div>
    <div class="assistant-final-body">${responseHtml(stateweave)}</div>
    ${renderRunTrace(live)}`;
  scrollChat(chat);
  return item;
}

function failPendingStateWeave(item: HTMLElement, message: string, live: LiveStreamLog): HTMLElement {
  item.classList.remove("pending");
  item.classList.add("state-stream-error");
  item.innerHTML = `
    <div class="stream-card-header">
      <div>
        <span class="eyebrow">StateWeave</span>
        <strong>Run failed</strong>
      </div>
    </div>
    <p class="message-copy error-copy">${escapeHtml(message)}</p>
    ${renderRunTrace(live)}`;
  scrollChat(chat);
  return item;
}

function renderRunTrace(live: LiveStreamLog): string {
  if (!live.steps.size) return "";
  const stepCount = live.metadata?.stepCount ?? live.steps.size;
  const retryCount = live.metadata?.retryCount ?? [...live.steps.values()].filter((step) => step.retryable).length;
  const duration = typeof live.metadata?.durationMs === "number" ? ` · ${live.metadata.durationMs}ms` : "";
  const retryText = retryCount ? ` · ${retryCount} ${retryCount === 1 ? "retry" : "retries"}` : "";
  return `<details class="stream-run-trace"><summary>Run trace · ${stepCount} step${stepCount === 1 ? "" : "s"}${retryText}${duration}</summary><div class="stream-steps">${renderLiveSteps(live, new Set())}</div></details>`;
}

function renderLiveSteps(live: LiveStreamLog, openSteps: Set<number>): string {
  const steps = [...live.steps.values()].sort((a, b) => a.step - b.step);
  if (!steps.length) return `<p class="stream-empty">Waiting for the first GraphOps step…</p>`;
  return steps.map((step) => renderLiveStep(step, openSteps.has(step.step))).join("");
}

function renderLiveStep(step: LiveStreamStep, open: boolean): string {
  const opsSummary = step.parsedOps ? summarizeOps(step.parsedOps) : undefined;
  const rawSummary = step.rawModelOutput ? `${step.rawModelOutput.length.toLocaleString()} chars` : "waiting";
  const graphSummary = typeof step.nodeCount === "number" ? `${step.nodeCount} nodes · ${step.edgeCount ?? 0} edges` : "graph updates after commit";
  const detail = step.parsedOps
    ? streamCodeSection("Parsed GraphOps", formatOps(step.parsedOps))
    : step.rawModelOutput
      ? streamCodeSection("Streaming raw SWX", compactStreamText(step.rawModelOutput))
      : `<p class="stream-note">Waiting for model tokens…</p>`;
  const raw = step.parsedOps && step.rawModelOutput ? `<details class="stream-raw"><summary>Raw model output</summary>${streamCodeSection("", compactStreamText(step.rawModelOutput))}</details>` : "";
  const metadata = step.modelMetadata.length ? streamCodeSection("Provider metadata", JSON.stringify(step.modelMetadata, null, 2)) : "";
  const workers = step.workers.size ? renderWorkerScheduler(step.workers) : "";
  const error = step.error ? `<p class="stream-error-text">${escapeHtml(step.error)}</p>` : "";
  return `
    <details class="stream-step ${streamStatusClass(step.status)}" data-step="${step.step}"${open ? " open" : ""}>
      <summary>
        <span class="stream-step-title">Step ${step.step}</span>
        <span class="stream-chip ${streamStatusClass(step.status)}">${streamStatusLabel(step.status)}</span>
        <small>${escapeHtml(opsSummary ?? rawSummary)} · ${escapeHtml(graphSummary)}</small>
      </summary>
      <div class="stream-step-body">
        ${step.status === "streaming" ? `<p class="stream-note">Streaming transactional GraphOps. The graph panel updates after this step validates and commits.</p>` : ""}
        ${detail}
        ${workers}
        ${error}
        ${metadata}
        ${raw}
      </div>
    </details>`;
}

function renderWorkerScheduler(workers: Map<string, LiveWorker>): string {
  return `<section class="worker-scheduler"><div class="worker-scheduler-header"><span>Graph workers</span><small>${workers.size} running region${workers.size === 1 ? "" : "s"}</small></div><div class="worker-grid">${[...workers.values()].map(renderWorkerCard).join("")}</div></section>`;
}

function renderWorkerCard(worker: LiveWorker): string {
  const summary = worker.finalAnswer ?? worker.error ?? (worker.tokens ? shorten(oneLine(worker.tokens), 160) : worker.objective);
  const ops = worker.ops?.length ? `<small>${escapeHtml(summarizeOps(worker.ops))}</small>` : "";
  return `<article class="worker-card ${workerStatusClass(worker.status)}"><div><strong>${escapeHtml(worker.id)}</strong><span>${escapeHtml(worker.status)}</span></div><p>${escapeHtml(summary)}</p>${ops}</article>`;
}

function workerStatusClass(statusValue: WorkerRunSummary["status"]): string {
  return `worker-${statusValue}`;
}

function streamCodeSection(label: string, value: string): string {
  return `${label ? `<label>${escapeHtml(label)}</label>` : ""}<pre class="stream-code">${escapeHtml(value)}</pre>`;
}

function summarizeOps(ops: GraphOp[]): string {
  const counts = new Map<string, number>();
  for (const op of ops) counts.set(op.op, (counts.get(op.op) ?? 0) + 1);
  const parts = [
    countLabel(counts.get("add_node") ?? 0, "node"),
    countLabel(counts.get("add_edge") ?? 0, "edge"),
    countLabel(counts.get("update_node") ?? 0, "update"),
    countLabel(counts.get("call_tool") ?? 0, "tool"),
    countLabel(counts.get("spawn_worker") ?? 0, "worker"),
    counts.get("focus") ? "focus" : "",
    counts.get("final") ? "final" : ""
  ].filter(Boolean);
  return parts.join(" · ") || `${ops.length} op${ops.length === 1 ? "" : "s"}`;
}

function countLabel(count: number, label: string): string {
  if (!count) return "";
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function streamStatusLabel(statusValue: LiveStepStatus): string {
  if (statusValue === "committed") return "Committed";
  if (statusValue === "parsed") return "Parsed";
  if (statusValue === "retrying") return "Retrying";
  if (statusValue === "rejected") return "Rejected";
  return "Streaming";
}

function streamStatusClass(statusValue: LiveStepStatus): string {
  return `is-${statusValue}`;
}

function compactStreamText(value: string, maxLength = 2400): string {
  if (value.length <= maxLength) return value;
  const headLength = Math.floor(maxLength * 0.62);
  const tailLength = maxLength - headLength;
  return `${value.slice(0, headLength)}\n\n… ${value.length - maxLength} characters hidden in chat preview …\n\n${value.slice(-tailLength)}`;
}

function appendAbPending(prompt: string): HTMLElement {
  const item = document.createElement("article");
  item.className = "ab-run pending";
  item.innerHTML = `
    <div class="ab-run-header">
      <div>
        <p class="eyebrow">Prompt</p>
        <h3>${escapeHtml(shorten(prompt, 96))}</h3>
      </div>
      <span class="badge">Running both paths…</span>
    </div>
    <div class="ab-answer-grid">
      <article class="ab-answer regular"><h4>Regular messages</h4><p>Waiting…</p></article>
      <article class="ab-answer state"><h4>StateWeave</h4><p>Waiting…</p></article>
    </div>`;
  abResults.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

function appendAbResult(prompt: string, regular: string, stateweave: string, value: StateGraph): void {
  const regularCopy = registerCopy(regular);
  const stateCopy = registerCopy(stateweave);
  const bothCopy = registerCopy([`Prompt:\n${prompt}`, `Regular messages:\n${regular}`, `StateWeave:\n${stateweave}`].join("\n\n---\n\n"));

  abResults.insertAdjacentHTML(
    "beforeend",
    `<article class="ab-run">
      <div class="ab-run-header">
        <div>
          <p class="eyebrow">Prompt</p>
          <h3>${escapeHtml(prompt)}</h3>
          <p class="ab-meta">StateGraph ${value.nodes.length} nodes / ${value.edges.length} edges</p>
        </div>
        <button class="button secondary small-button" type="button" data-copy-id="${bothCopy}">Copy both</button>
      </div>
      <div class="ab-answer-grid">
        <article class="ab-answer regular">
          <div class="ab-answer-header">
            <h4>Regular messages</h4>
            <button class="button secondary small-button" type="button" data-copy-id="${regularCopy}">Copy</button>
          </div>
          ${responseHtml(regular)}
        </article>
        <article class="ab-answer state">
          <div class="ab-answer-header">
            <h4>StateWeave</h4>
            <button class="button secondary small-button" type="button" data-copy-id="${stateCopy}">Copy</button>
          </div>
          ${responseHtml(stateweave)}
        </article>
      </div>
    </article>`
  );
  abResults.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function appendError(container: HTMLElement, message: string): void {
  container.insertAdjacentHTML("beforeend", `<div class="message error"><div>${escapeHtml(message)}</div></div>`);
  scrollChat(container);
}

function renderGraph(value: StateGraph): void {
  renderGraphComponent(graph, value, primaryGraphViewState);
}

function renderGraphComponent(container: HTMLElement, value: StateGraph, viewState: GraphViewState, focusChat = true): void {
  stopGraphAnimation(viewState);
  const layout = graphLayout(value, viewState.positions);
  const turnCount = value.nodes.filter((node) => node.type === "user_input").length;
  const latestNodeId = value.nodes.at(-1)?.id;
  const selectedNode = layout.nodeMap.get(viewState.selectedNodeId ?? "") ?? layout.nodeMap.get(latestNodeId ?? "") ?? layout.nodeMap.get("system_root") ?? layout.nodes[0];
  viewState.selectedNodeId = selectedNode?.id;

  container.className = "graph-visual cortex-graph";
  container.innerHTML = `
    <div class="graph-summary floating">
      <strong>Turn ${turnCount}</strong>
      <span>${value.nodes.length} nodes · ${value.edges.length} edges</span>
    </div>
    <div class="graph-help">Hover to stir · drag to pin · double-click to release · click to inspect</div>
    <svg class="graph-svg cortex-map" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="StateGraph knowledge map">
      <defs>
        <radialGradient id="graph-glow" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="#ffffff"></stop>
          <stop offset="56%" stop-color="#fafafa"></stop>
          <stop offset="100%" stop-color="#eef2ff"></stop>
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="${layout.width}" height="${layout.height}" rx="18" fill="url(#graph-glow)"></rect>
      <g class="edges">
        ${layout.edges.map((edge, index) => edge.fromNode && edge.toNode ? `
          <g class="cortex-edge ${escapeHtml(edge.type)} ${edge.from === viewState.selectedNodeId || edge.to === viewState.selectedNodeId ? "selected" : ""}">
            <line data-edge-index="${index}" x1="${edge.fromNode.x}" y1="${edge.fromNode.y}" x2="${edge.toNode.x}" y2="${edge.toNode.y}"></line>
            <title>${escapeHtml(edge.from)} ${escapeHtml(edge.type)} ${escapeHtml(edge.to)}</title>
          </g>` : "").join("")}
      </g>
      <g class="nodes">
        ${layout.nodes.map((node) => `
          <g class="cortex-node ${escapeHtml(node.type)} ${node.id === "system_root" ? "root" : ""} ${node.id === latestNodeId ? "latest" : ""} ${node.id === viewState.selectedNodeId ? "selected" : ""} ${node.pinned ? "pinned" : ""}" data-node-id="${escapeAttribute(node.id)}" transform="translate(${node.x} ${node.y})">
            <circle r="${node.radius}"></circle>
            <text class="node-id" y="${node.radius + 15}">${escapeHtml(shorten(node.id, node.id === "system_root" ? 18 : 16))}</text>
            <title>${escapeHtml(`${node.id} [${node.type}]\n${node.text}`)}</title>
          </g>`).join("")}
      </g>
    </svg>
    <div id="graph-selected-node" class="graph-selected-node">
      ${selectedNode ? graphInspectorHtml(value, selectedNode) : ""}
    </div>
    <details class="graph-node-list">
      <summary>Node list (${value.nodes.length})</summary>
      <ul>
        ${layout.nodes.map((node) => `
          <li class="${node.id === viewState.selectedNodeId ? "selected" : ""}" data-node-card-id="${escapeAttribute(node.id)}">
            <strong>${escapeHtml(node.id)}</strong>
            <span>${escapeHtml(node.type)}</span>
            <em>${escapeHtml(shorten(node.text, 120))}</em>
          </li>`).join("")}
      </ul>
    </details>
  `;
  mountGraphInteractions(container, value, layout, viewState, focusChat);
}

type GraphLayoutNode = StateGraph["nodes"][number] & { x: number; y: number; vx: number; vy: number; radius: number; degree: number; pinned: boolean };
type GraphLayoutEdge = StateGraph["edges"][number] & { fromNode?: GraphLayoutNode; toNode?: GraphLayoutNode };
type GraphPointer = { x: number; y: number };

function graphLayout(value: StateGraph, positions: Map<string, GraphPosition>): {
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  featuredNodes: GraphLayoutNode[];
  nodeMap: Map<string, GraphLayoutNode>;
} {
  const width = 1080;
  const height = 760;
  const centerX = width / 2;
  const centerY = height / 2;
  const degree = new Map<string, number>();
  for (const edge of value.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const nodes: GraphLayoutNode[] = value.nodes.map((node, index) => {
    const root = node.id === "system_root";
    const existing = positions.get(node.id);
    const ring = root ? 0 : 112 + Math.sqrt(index + 1) * 28;
    const angle = root ? 0 : seededAngle(node.id, index);
    const x = existing?.x ?? (root ? centerX : centerX + Math.cos(angle) * ring);
    const y = existing?.y ?? (root ? centerY : centerY + Math.sin(angle) * ring);
    return {
      ...node,
      x,
      y,
      vx: existing?.vx ?? 0,
      vy: existing?.vy ?? 0,
      radius: nodeRadius(node.type, degree.get(node.id) ?? 0, root),
      degree: degree.get(node.id) ?? 0,
      pinned: Boolean(existing?.pinned)
    };
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = value.edges.map((edge) => ({ ...edge, fromNode: nodeMap.get(edge.from), toNode: nodeMap.get(edge.to) }));

  for (let iteration = 0; iteration < 90; iteration++) {
    applyGraphForces(nodes, edges, width, height, { cooling: 1 - iteration / 90 }, positions);
  }

  const featuredNodes = [...nodes]
    .sort((a, b) => Number(b.id === value.nodes.at(-1)?.id) - Number(a.id === value.nodes.at(-1)?.id) || b.degree - a.degree)
    .slice(0, 8);

  for (const node of nodes) rememberGraphNodePosition(node, positions);

  return { width, height, nodes, edges, featuredNodes, nodeMap };
}

function mountGraphInteractions(container: HTMLElement, value: StateGraph, layout: ReturnType<typeof graphLayout>, viewState: GraphViewState, focusChat: boolean): void {
  const svg = container.querySelector<SVGSVGElement>("svg.cortex-map");
  if (!svg) return;

  const nodeElements = new Map<string, SVGGElement>();
  for (const nodeElement of svg.querySelectorAll<SVGGElement>(".cortex-node[data-node-id]")) {
    const nodeId = nodeElement.dataset.nodeId;
    if (nodeId) nodeElements.set(nodeId, nodeElement);
  }
  const edgeElements = layout.edges.map((_, index) => svg.querySelector<SVGLineElement>(`line[data-edge-index="${index}"]`));
  const inspector = container.querySelector<HTMLElement>("#graph-selected-node");
  const cards = [...container.querySelectorAll<HTMLElement>("[data-node-card-id]")];
  let hoveredNodeId: string | undefined;
  let hoverPoint: GraphPointer | undefined;
  let dragging: { node: GraphLayoutNode; element: SVGGElement; pointerId: number; moved: boolean; start: GraphPointer } | undefined;

  const selectNode = (nodeId: string) => {
    const node = layout.nodeMap.get(nodeId);
    if (!node) return;
    viewState.selectedNodeId = node.id;
    for (const [id, element] of nodeElements) element.classList.toggle("selected", id === node.id);
    for (const card of cards) card.classList.toggle("selected", card.dataset.nodeCardId === node.id);
    layout.edges.forEach((edge, index) => {
      edgeElements[index]?.parentElement?.classList.toggle("selected", edge.from === node.id || edge.to === node.id);
    });
    if (inspector) inspector.innerHTML = graphInspectorHtml(value, node);
    if (focusChat) focusConversationNode(node.id);
  };

  svg.addEventListener("pointermove", (event) => {
    hoverPoint = svgPoint(svg, event);
  });
  svg.addEventListener("pointerleave", () => {
    hoverPoint = undefined;
    hoveredNodeId = undefined;
    for (const element of nodeElements.values()) element.classList.remove("hovered");
  });

  for (const [nodeId, nodeElement] of nodeElements) {
    const node = layout.nodeMap.get(nodeId);
    if (!node) continue;

    nodeElement.addEventListener("pointerenter", () => {
      hoveredNodeId = node.id;
      nodeElement.classList.add("hovered");
    });
    nodeElement.addEventListener("pointerleave", () => {
      if (hoveredNodeId === node.id) hoveredNodeId = undefined;
      nodeElement.classList.remove("hovered");
    });
    nodeElement.addEventListener("pointerdown", (event) => {
      selectNode(node.id);
      if (event.button !== 0) return;
      event.preventDefault();
      const point = svgPoint(svg, event);
      node.pinned = true;
      node.vx = 0;
      node.vy = 0;
      node.x = point.x;
      node.y = point.y;
      dragging = { node, element: nodeElement, pointerId: event.pointerId, moved: false, start: point };
      nodeElement.setPointerCapture(event.pointerId);
      nodeElement.classList.add("dragging", "pinned");
      rememberGraphNodePosition(node, viewState.positions);
      updateGraphDom(layout, nodeElements, edgeElements);
    });
    nodeElement.addEventListener("pointermove", (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId || dragging.node.id !== node.id) return;
      event.preventDefault();
      const point = svgPoint(svg, event);
      dragging.moved = dragging.moved || Math.hypot(point.x - dragging.start.x, point.y - dragging.start.y) > 4;
      node.x = clamp(point.x, 54, layout.width - 54);
      node.y = clamp(point.y, 54, layout.height - 64);
      node.vx = 0;
      node.vy = 0;
      rememberGraphNodePosition(node, viewState.positions);
      updateGraphDom(layout, nodeElements, edgeElements);
    });
    const releaseDrag = (event: PointerEvent) => {
      if (!dragging || dragging.pointerId !== event.pointerId || dragging.node.id !== node.id) return;
      if (nodeElement.hasPointerCapture(event.pointerId)) nodeElement.releasePointerCapture(event.pointerId);
      nodeElement.classList.remove("dragging");
      rememberGraphNodePosition(node, viewState.positions);
      dragging = undefined;
    };
    nodeElement.addEventListener("pointerup", releaseDrag);
    nodeElement.addEventListener("pointercancel", releaseDrag);
    nodeElement.addEventListener("click", () => selectNode(node.id));
    nodeElement.addEventListener("dblclick", () => {
      node.pinned = false;
      nodeElement.classList.remove("pinned");
      rememberGraphNodePosition(node, viewState.positions);
      selectNode(node.id);
    });
  }

  for (const card of cards) {
    card.addEventListener("click", () => {
      if (card.dataset.nodeCardId) selectNode(card.dataset.nodeCardId);
    });
  }

  const animate = () => {
    applyGraphForces(layout.nodes, layout.edges, layout.width, layout.height, {
      hoveredNodeId,
      hoverPoint,
      draggingNodeId: dragging?.node.id,
      cooling: dragging ? 0.95 : 0.72
    }, viewState.positions);
    updateGraphDom(layout, nodeElements, edgeElements);
    viewState.animationFrame = window.requestAnimationFrame(animate);
  };
  viewState.animationFrame = window.requestAnimationFrame(animate);
}

function applyGraphForces(
  nodes: GraphLayoutNode[],
  edges: GraphLayoutEdge[],
  width: number,
  height: number,
  options: { hoveredNodeId?: string; hoverPoint?: GraphPointer; draggingNodeId?: string; cooling: number },
  positions: Map<string, GraphPosition>
): void {
  const centerX = width / 2;
  const centerY = height / 2;
  const movable = (node: GraphLayoutNode) => !node.pinned && node.id !== options.draggingNodeId;

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x || 0.01;
      const dy = b.y - a.y || 0.01;
      const distanceSquared = Math.max(140, dx * dx + dy * dy);
      const distance = Math.sqrt(distanceSquared);
      const force = ((a.radius + b.radius + 48) * 20) / distanceSquared;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      if (movable(a)) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (movable(b)) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  for (const edge of edges) {
    const from = edge.fromNode;
    const to = edge.toNode;
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const ideal = edge.from === "system_root" || edge.to === "system_root" ? 132 : 116;
    const force = (distance - ideal) * 0.0075;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    if (movable(from)) {
      from.vx += fx;
      from.vy += fy;
    }
    if (movable(to)) {
      to.vx -= fx;
      to.vy -= fy;
    }
  }

  const hovered = options.hoveredNodeId ? nodes.find((node) => node.id === options.hoveredNodeId) : undefined;
  for (const node of nodes) {
    if (node.id === options.draggingNodeId || node.pinned) {
      node.vx = 0;
      node.vy = 0;
      rememberGraphNodePosition(node, positions);
      continue;
    }

    const hash = hashString(node.id);
    const time = performance.now() / 1000;
    node.vx += Math.sin(time * 0.7 + hash) * 0.004;
    node.vy += Math.cos(time * 0.6 + hash) * 0.004;
    node.vx += (centerX - node.x) * 0.00075;
    node.vy += (centerY - node.y) * 0.00075;

    if (options.hoverPoint) {
      repelFromPoint(node, options.hoverPoint, 120, 0.026);
    }
    if (hovered && hovered.id !== node.id) {
      repelFromPoint(node, hovered, 170, 0.035);
    }

    node.x = clamp(node.x + node.vx * options.cooling, 54, width - 54);
    node.y = clamp(node.y + node.vy * options.cooling, 54, height - 64);
    node.vx *= 0.84;
    node.vy *= 0.84;
    rememberGraphNodePosition(node, positions);
  }
}

function repelFromPoint(node: GraphLayoutNode, point: GraphPointer, radius: number, strength: number): void {
  const dx = node.x - point.x || 0.01;
  const dy = node.y - point.y || 0.01;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > radius) return;
  const force = ((radius - distance) / radius) * strength;
  node.vx += (dx / distance) * force;
  node.vy += (dy / distance) * force;
}

function updateGraphDom(
  layout: ReturnType<typeof graphLayout>,
  nodeElements: Map<string, SVGGElement>,
  edgeElements: Array<SVGLineElement | null>
): void {
  for (const node of layout.nodes) {
    const element = nodeElements.get(node.id);
    if (!element) continue;
    element.setAttribute("transform", `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`);
    element.classList.toggle("pinned", node.pinned);
  }
  layout.edges.forEach((edge, index) => {
    const line = edgeElements[index];
    if (!line || !edge.fromNode || !edge.toNode) return;
    line.setAttribute("x1", edge.fromNode.x.toFixed(1));
    line.setAttribute("y1", edge.fromNode.y.toFixed(1));
    line.setAttribute("x2", edge.toNode.x.toFixed(1));
    line.setAttribute("y2", edge.toNode.y.toFixed(1));
  });
}

function graphInspectorHtml(value: StateGraph, node: GraphLayoutNode): string {
  const adjacentCount = value.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length;
  const conversationHint = node.type === "user_input" || node.type === "assistant_output" ? " · chat bubble highlighted" : "";

  return `
    <span>Selected</span>
    <strong>${escapeHtml(node.id)}</strong>
    <em>${escapeHtml(node.type)}</em>
    <p title="${escapeAttribute(node.text)}">${escapeHtml(shorten(node.text, 180))}</p>
    <small>${adjacentCount} edges${conversationHint}</small>
  `;
}

function focusConversationNode(nodeId: string): void {
  const conversationNodes = [...chat.querySelectorAll<HTMLElement>("[data-node-id]")];
  let target: HTMLElement | undefined;
  for (const element of conversationNodes) {
    const active = element.dataset.nodeId === nodeId;
    element.classList.toggle("conversation-focus", active);
    if (active) target = element;
  }
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function svgPoint(svg: SVGSVGElement, event: PointerEvent): GraphPointer {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return {
    x: viewBox.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width,
    y: viewBox.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height
  };
}

function rememberGraphNodePosition(node: GraphLayoutNode, positions: Map<string, GraphPosition>): void {
  positions.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy, pinned: node.pinned });
}

function stopGraphAnimation(viewState: GraphViewState): void {
  if (viewState.animationFrame === undefined) return;
  window.cancelAnimationFrame(viewState.animationFrame);
  viewState.animationFrame = undefined;
}

function nodeRadius(type: string, degree: number, root: boolean): number {
  if (root) return 34;
  const base = type === "user_input" || type === "assistant_output" ? 20 : type === "artifact" ? 24 : 17;
  return Math.min(30, base + Math.sqrt(degree) * 2.6);
}

function seededAngle(id: string, index: number): number {
  const hash = hashString(id);
  const golden = Math.PI * (3 - Math.sqrt(5));
  return (hash % 6283) / 1000 + index * golden;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function compactFrame(frame: GraphFrame): string {
  const lines = [
    `objective: ${frame.frame.objective}`,
    `currentFocus: ${frame.frame.currentFocus}`,
    `focusNodeId: ${frame.frame.focusNodeId ?? "unknown"}`,
    `latestInputNodeId: ${frame.frame.latestInputNodeId ?? "unknown"}`,
    `activeUserInputNodeId: ${frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId ?? "unknown"}`,
    `candidateFocusNodeIds: ${frame.frame.candidateFocusNodeIds?.join(", ") ?? "system_root"}`,
    `nextExpectedOutput: ${frame.frame.nextExpectedOutput}`,
    `activeConstraints: ${frame.frame.activeConstraints.length ? frame.frame.activeConstraints.join("; ") : "none"}`,
    "",
    "graph:",
    ...frame.graph.nodes.map((node) => `- ${node.id} [${node.type}] ${node.text}`),
    ...frame.graph.edges.map((edge) => `- ${edge.from} -${edge.type}-> ${edge.to}`)
  ];
  return lines.join("\n");
}

function formatStateOutput(trace: TraceStep[], finalAnswer: string, metadata?: StateWeaveRunMetadata): string {
  const metadataLines = metadata ? ["metadata:", JSON.stringify(metadata, null, 2), ""] : [];
  const parts = trace.map((step) => [
    `step ${step.step} metadata: ${step.durationMs}ms · ${step.startedAt} → ${step.completedAt}`,
    ...(step.modelMetadata?.length ? [`step ${step.step} provider metadata:`, JSON.stringify(step.modelMetadata, null, 2)] : []),
    `step ${step.step} raw model output:`,
    step.rawModelOutput,
    "",
    `step ${step.step} parsed GraphOps:`,
    formatOps(step.parsedOps),
    ...(step.error ? ["", `step ${step.step} GraphOps error:`, step.error] : [])
  ].join("\n"));
  return [...metadataLines, ...parts, "", "final answer:", finalAnswer].join("\n");
}

function formatOps(ops: GraphOp[]): string {
  return ops.map(formatOp).join("\n");
}

function formatOp(op: GraphOp): string {
  if (op.op === "add_node") return `@node ${op.node.id} ${op.node.type} "${shorten(op.node.text, 96)}"`;
  if (op.op === "add_edge") return `@edge ${op.from} ${op.type} ${op.to}`;
  if (op.op === "update_node") return `@update ${op.id}`;
  if (op.op === "focus") return op.nodeId ? `@focus ${op.nodeId} "${op.currentFocus}"` : `@focus "${op.currentFocus}"`;
  if (op.op === "call_tool") return `@tool ${op.tool}`;
  if (op.op === "spawn_worker") return `@worker ${op.id} objective="${shorten(op.objective, 96)}"${op.focusNodeId ? ` focus=${op.focusNodeId}` : ""}`;
  if (op.op === "final") {
    const ids = op.artifactIds?.length ? op.artifactIds : op.artifactId ? [op.artifactId] : [];
    const suffix = ids.length ? ` artifacts=${ids.join(",")}` : "";
    return `@final "${shorten(op.answer, 120)}"${suffix}`;
  }
  return "@unknown";
}

function responseHtml(value: string): string {
  const artifact = extractPreviewArtifact(value);
  if (!artifact) return `<div class="markdown">${renderMarkdown(value)}</div>`;
  const previewId = registerArtifactPreview(artifact);
  return `
    <div class="artifact-preview">
      <div class="artifact-preview-toolbar">
        <span>Rendered artifact</span>
        <button class="button secondary small-button" type="button" data-artifact-preview-id="${previewId}">Open full screen</button>
      </div>
      <iframe sandbox="allow-scripts" tabindex="0" srcdoc="${escapeAttribute(artifact)}" title="Generated artifact preview"></iframe>
    </div>
    <pre class="artifact-source">${escapeHtml(value)}</pre>`;
}

function extractPreviewArtifact(value: string): string | undefined {
  const fenced = value.match(/```(?:svg|html|xml)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || value.trim();
  if (/^(?:<!doctype\s+html|<html[\s>]|<svg[\s>])/i.test(candidate)) return candidate;
  return undefined;
}

function registerCopy(value: string): string {
  const id = `copy_${++copyCounter}`;
  copyPayloads.set(id, value);
  return id;
}

function registerArtifactPreview(value: string): string {
  const id = `artifact_preview_${++artifactPreviewCounter}`;
  artifactPreviews.set(id, value);
  return id;
}

function handleArtifactPreviewClick(event: Event): boolean {
  const target = event.target instanceof Element ? event.target : undefined;
  const button = target?.closest<HTMLButtonElement>("button[data-artifact-preview-id]");
  const id = button?.dataset.artifactPreviewId;
  if (!id) return false;
  const artifact = artifactPreviews.get(id);
  if (artifact) openArtifactModal(artifact);
  return true;
}

function handleStreamAccordionToggle(event: Event): void {
  const target = event.target instanceof HTMLDetailsElement ? event.target : undefined;
  if (!target?.open || !target.classList.contains("stream-step")) return;
  const group = target.closest(".stream-steps");
  group?.querySelectorAll<HTMLDetailsElement>("details.stream-step[open]").forEach((detail) => {
    if (detail !== target) detail.open = false;
  });
}

function openArtifactModal(artifact: string): void {
  const existing = document.getElementById("artifact-modal");
  existing?.remove();

  const modal = document.createElement("div");
  modal.id = "artifact-modal";
  modal.className = "artifact-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Full screen artifact preview");
  modal.innerHTML = `
    <div class="artifact-modal-panel">
      <div class="artifact-modal-toolbar">
        <strong>Artifact preview</strong>
        <button class="button secondary small-button" type="button" data-artifact-modal-close>Close</button>
      </div>
      <iframe sandbox="allow-scripts" tabindex="0" srcdoc="${escapeAttribute(artifact)}" title="Full screen artifact preview"></iframe>
    </div>`;
  modal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    if (target === modal || target?.closest("[data-artifact-modal-close]")) modal.remove();
  });
  document.body.append(modal);
  const iframe = modal.querySelector<HTMLIFrameElement>("iframe");
  iframe?.addEventListener("load", () => iframe.focus(), { once: true });
  iframe?.focus();
}

function setupCopyableLog(element: HTMLElement, label: string): void {
  element.classList.add("copyable-log");
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("title", `Click to copy ${label}`);
  element.addEventListener("click", () => void copyLog(element, label));
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void copyLog(element, label);
  });
}

async function copyLog(element: HTMLElement, label: string): Promise<void> {
  const value = element.textContent?.trim() ?? "";
  if (!value || value.startsWith("No turn") || value.startsWith("No output")) return;
  try {
    await writeClipboard(value);
    element.classList.add("copied");
    status.textContent = `Copied ${label} to clipboard.`;
  } catch {
    status.textContent = `Failed to copy ${label}.`;
  } finally {
    window.setTimeout(() => element.classList.remove("copied"), 900);
  }
}

async function copyText(value: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? "Copy";
  try {
    await writeClipboard(value);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  } finally {
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }
}

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function clearEmptyState(container: HTMLElement): void {
  const empty = container.querySelector(".empty-state");
  if (empty) empty.remove();
}

function scrollChat(container: HTMLElement): void {
  container.scrollTop = container.scrollHeight;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}

function shorten(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

// --- Infinite harness ---

type ChallengerScenarioSummary = { id: string; filename: string; title: string; tldr: string; domain: string; estimatedTurns: number; status: string };
type ChallengerScenario = ChallengerScenarioSummary & { markdown: string };
type ChallengerScenarioLibrary = { purpose: string; tldr: string; scenarios: ChallengerScenarioSummary[] };

type ProbeScore = { score: "pass" | "partial" | "fail"; passed: number; total: number; details: string[]; completed?: boolean; checks?: Array<{ label: string; passed: boolean }> };
type InfiniteTurn = { turn: number; phase: string; taskKind: string; prompt: string; answer: string; baselineAnswer: string; nodeCount: number; edgeCount: number; clusterCount: number; semanticNodeCount?: number; suggestedSemanticNodeCount?: number; promptTokenEstimate: number; baselineTokenEstimate: number; totalInputTokens: number; baselineTotalInputTokens: number; outputTokenCount: number; baselineOutputTokenCount: number; latencyMs: number; baselineLatencyMs: number; modelCalls: number; baselineModelCalls: number; toolCalls: number; baselineToolCalls: number; baselineCompactions?: number; stateweaveCompleted?: boolean; baselineCompleted?: boolean; stateweaveError?: string; baselineError?: string; transactionValid: boolean; executionOrder?: "stateweave-first" | "native-first"; block?: number; score: { stateweave: ProbeScore; naive: ProbeScore } };
type InfiniteSeriesPoint = { turn: number; stateweaveTokens: number; baselineTokens: number; stateweaveTotalInputTokens: number; baselineTotalInputTokens: number; stateweaveOutputTokens: number; baselineOutputTokens: number; stateweaveNodes: number; stateweaveClusters: number; stateweaveLatencyMs: number; baselineLatencyMs: number; stateweaveToolCalls: number; baselineToolCalls: number; baselineCompactions?: number };
type InfiniteQualityPoint = { turn: number; stateweavePassRate: number; naivePassRate: number; stateweaveScored: number; naiveScored: number };
type InfiniteStateView = {
  experiment: "infinite-agent";
  status: string;
  turnCount: number;
  nextMilestone: number;
  startedAt: string;
  updatedAt: string;
  agentModel: string;
  design: { version: number; seed: number; targetTurns: number; tasksPerBlock: number; maxIterationsPerAgentTurn?: number; semanticPolicy?: string; qualityPolicy?: string; primaryOutcome: string; executionOrder: string; stoppingRule: string; analysisPlan: string; protocolId?: string; blindingPolicy?: string; challengerPolicy?: string; failurePolicy?: string; fairnessPolicy?: string };
  currentTask?: { kind: string; prompt: string; executionOrder?: string };
  progress?: { turn: number; arm: "stateweave" | "native" | "harness"; phase: string; iteration: number; maxIterations: number; modelCalls: number; toolCalls: number; detail: string; startedAt: string; updatedAt: string };
  trajectory?: Array<{ at: string; turn: number; arm: "stateweave" | "native" | "harness"; phase: string; iteration: number; detail: string }>;
  lastAttemptError?: { turn: number; attempt: number; at: string; error: string };
  reliability?: { stateweaveCompleted: number; challengerCompleted: number; stateweaveAgentFailures: number; challengerAgentFailures: number; providerRetries: number };
  turns: InfiniteTurn[];
  series: InfiniteSeriesPoint[];
  qualitySeries: InfiniteQualityPoint[];
  blocks: Array<{ block: number; turns: number; stateweaveQuality: number; nativeQuality: number; difference: number }>;
  evidence?: { unit: string; blocks: number; stateweaveMean: number; nativeMean: number; meanDifference: number; confidenceLow: number; confidenceHigh: number; permutationPValue: number; wins: number; ties: number; losses: number; signTestPValue: number; resamples: number };
  validTransactions: number;
  invalidTransactions: number;
  graphSnapshot?: { nodeCount: number; edgeCount: number; clusterCount: number; semanticNodeCount?: number; suggestedSemanticNodeCount?: number; nodeTypeCounts?: Record<string, number>; clusters: { id: string; label: string; nodeCount: number }[] };
  nodeTypes: string[];
  nodeTypeRationales: Record<string, string>;
  tools: string[];
  security: { bashPolicy: string; isolatedWorkspaces: boolean };
  workspace: { stateweaveFiles: number; naiveFiles: number };
  naiveContextLimit: number;
  naiveStrategy: { kind: "summary-compaction"; thresholdTokens: number; retainMessages: number; startedAtTurn: number; totalCompactions: number; lastCompactionTurn?: number };
  turnArchive: { firstTurn: number; lastTurn: number; count: number };
  challenger?: { corpusSha256: string; split: "held-out"; trajectory: number; scenarioId?: string; scenarioIndex?: number; scenarioTurn?: number; scenarioCount: number; calibration: { status: string; scenarios: number; passed: number; usage: { inputTokens: number; outputTokens: number; calls: number }; updatedAt?: string }; driverUsage: { inputTokens: number; outputTokens: number; calls: number }; judgeUsage: { inputTokens: number; outputTokens: number; calls: number }; judgeReviewTurns: number[] };
  message?: string;
};

// The server-side harness owns the persistent workspaces and resumes after deploys.
let latestInfiniteState: InfiniteStateView | undefined;
let challengerScenarioSummaries: ChallengerScenarioSummary[] = [];
let selectedChallengerScenario: string | undefined;
let challengerScenarioLibraryLoading = false;
let challengerScenarioLibraryLoaded = false;

async function loadChallengerScenarioLibrary(): Promise<void> {
  if (challengerScenarioLibraryLoading || challengerScenarioLibraryLoaded) return;
  challengerScenarioLibraryLoading = true;
  try {
    const response = await fetch(`${apiBase}/api/infinite-agent/scenarios`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Scenario library request failed (${response.status})`);
    const library = await response.json() as ChallengerScenarioLibrary;
    challengerScenarioSummaries = library.scenarios;
    challengerLibraryTldr.textContent = library.tldr;
    const totalTurns = library.scenarios.reduce((sum, scenario) => sum + scenario.estimatedTurns, 0);
    const calibration = library.scenarios.filter((scenario) => scenario.status === "calibration").length;
    const heldOut = library.scenarios.filter((scenario) => scenario.status === "held-out").length;
    challengerLibraryCount.textContent = `${calibration} calibration · ${heldOut} held-out · ${totalTurns} planned turns`;
    renderChallengerScenarioList();
    challengerScenarioLibraryLoaded = true;
    if (library.scenarios[0]) await openChallengerScenario(library.scenarios[0].filename);
  } catch (error) {
    challengerScenarioList.innerHTML = `<p class="message error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    challengerLibraryCount.textContent = "Library unavailable";
  } finally {
    challengerScenarioLibraryLoading = false;
  }
}

function renderChallengerScenarioList(): void {
  challengerScenarioList.innerHTML = challengerScenarioSummaries.length
    ? challengerScenarioSummaries.map((scenario, index) => `
      <button class="scenario-list-item${scenario.filename === selectedChallengerScenario ? " active" : ""}" type="button" data-scenario-file="${escapeAttribute(scenario.filename)}" aria-pressed="${scenario.filename === selectedChallengerScenario}">
        <span class="scenario-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="scenario-list-copy"><strong>${escapeHtml(scenario.title)}</strong><small>${escapeHtml(scenario.tldr)}</small><span>${escapeHtml(scenario.domain)} · ${scenario.estimatedTurns} turns · ${escapeHtml(scenario.status)}</span></span>
      </button>`).join("")
    : `<p class="muted-copy">No Markdown scenarios are available.</p>`;
  for (const button of challengerScenarioList.querySelectorAll<HTMLButtonElement>("[data-scenario-file]")) {
    button.addEventListener("click", () => void openChallengerScenario(button.dataset.scenarioFile ?? ""));
  }
}

async function openChallengerScenario(filename: string): Promise<void> {
  if (!filename) return;
  selectedChallengerScenario = filename;
  renderChallengerScenarioList();
  challengerScenarioContent.innerHTML = `<p>Loading ${escapeHtml(filename)}…</p>`;
  try {
    const response = await fetch(`${apiBase}/api/infinite-agent/scenarios/${encodeURIComponent(filename)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404 ? "Scenario file not found." : `Scenario request failed (${response.status})`);
    const scenario = await response.json() as ChallengerScenario;
    challengerScenarioHeading.innerHTML = `
      <div><span class="scenario-file">${escapeHtml(scenario.filename)}</span><h3>${escapeHtml(scenario.title)}</h3></div>
      <div class="scenario-reader-meta"><span>${escapeHtml(scenario.domain)}</span><span>${scenario.estimatedTurns} turns</span><span>${escapeHtml(scenario.status)}</span></div>`;
    challengerScenarioContent.innerHTML = renderMarkdown(scenario.markdown);
  } catch (error) {
    challengerScenarioContent.innerHTML = `<p class="message error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  }
}

async function openInfiniteGraph(): Promise<void> {
  infiniteOpenGraph.disabled = true;
  infiniteOpenGraph.textContent = "Loading graph…";
  try {
    const response = await fetch(`${apiBase}/api/infinite-agent/graph`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Graph request failed (${response.status})`);
    const views = await response.json() as { persistent?: GraphFrame; modelFacing?: GraphFrame };
    const initial = views.modelFacing ?? views.persistent;
    if (!initial) throw new Error("The experiment has not produced a graph yet.");
    document.getElementById("infinite-graph-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "infinite-graph-modal";
    modal.className = "artifact-modal infinite-graph-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="artifact-modal-panel infinite-graph-panel">
      <div class="artifact-modal-toolbar">
        <div><strong>Graph-candidate memory</strong><small id="infinite-graph-caption"></small></div>
        <div class="infinite-graph-actions">
          <button class="button secondary small-button" data-graph-view="model">Model-facing projection</button>
          <button class="button secondary small-button" data-graph-view="persistent">Persistent state</button>
          <button class="button secondary small-button" data-infinite-graph-close>Close</button>
        </div>
      </div>
      <div id="infinite-graph-canvas" class="infinite-graph-canvas"></div>
    </div>`;
    const canvas = modal.querySelector<HTMLElement>("#infinite-graph-canvas")!;
    const caption = modal.querySelector<HTMLElement>("#infinite-graph-caption")!;
    const infiniteGraphViewState: GraphViewState = { positions: new Map<string, GraphPosition>() };
    const close = () => {
      stopGraphAnimation(infiniteGraphViewState);
      modal.remove();
    };
    const show = (kind: "model" | "persistent") => {
      const frame = kind === "model" ? views.modelFacing : views.persistent;
      if (!frame) {
        stopGraphAnimation(infiniteGraphViewState);
        canvas.innerHTML = `<p class="message error">That graph view is not available yet.</p>`;
        return;
      }
      const visibleGraph = interactiveGraphSubset(frame.graph, 180);
      const subsetNote = visibleGraph.nodes.length < frame.graph.nodes.length ? ` · showing latest ${visibleGraph.nodes.length}` : "";
      caption.textContent = kind === "model"
        ? `Latest bounded GraphFrame supplied to the model · ${frame.graph.nodes.length} nodes / ${frame.graph.edges.length} edges${subsetNote}`
        : `Append-only state · ${frame.graph.nodes.length} nodes / ${frame.graph.edges.length} edges${subsetNote}`;
      renderGraphComponent(canvas, visibleGraph, infiniteGraphViewState, false);
      canvas.classList.add("infinite-graph-canvas");
    };
    modal.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (target === modal || target?.closest("[data-infinite-graph-close]")) {
        close();
        return;
      }
      const view = target?.closest<HTMLButtonElement>("[data-graph-view]")?.dataset.graphView;
      if (view === "model" || view === "persistent") show(view);
    });
    document.body.append(modal);
    show(views.modelFacing ? "model" : "persistent");
  } catch (error) {
    infiniteTurnDetail.innerHTML = `<p class="message error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  } finally {
    infiniteOpenGraph.disabled = false;
    infiniteOpenGraph.textContent = "Open live graph";
  }
}

function interactiveGraphSubset(value: StateGraph, limit: number): StateGraph {
  if (value.nodes.length <= limit) return value;
  const root = value.nodes.find((node) => node.id === "system_root");
  const recent = value.nodes.slice(-(limit - (root ? 1 : 0)));
  const nodes = root && !recent.some((node) => node.id === root.id) ? [root, ...recent] : recent;
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: value.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).slice(-1200) };
}

function renderInfiniteState(state: InfiniteStateView): void {
  latestInfiniteState = state;
  const running = state.status === "running";
  const activeTurn = state.progress?.turn ?? state.turnCount;
  if (infiniteLiveBadge) {
    infiniteLiveBadge.textContent = running ? `turn ${activeTurn} · ${state.progress?.arm ?? "harness"} ${state.progress?.phase ?? "running"}` : (state.status || "idle");
    infiniteLiveBadge.className = `infinite-live-badge ${running ? "live" : "idle"}`;
  }

  const snapshot = state.graphSnapshot;
  const lastTurn = state.turns.at(-1);
  const swTokens = lastTurn?.promptTokenEstimate ?? 0;
  const baselineTokens = lastTurn?.baselineTokenEstimate ?? 0;
  const quality = state.qualitySeries.at(-1);
  infiniteMetrics.innerHTML = `
    <div class="infinite-metric"><span class="metric-label">Paired turns scored</span><strong>${state.turnCount} · next milestone ${state.nextMilestone}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Current task</span><strong>${escapeHtml(state.currentTask?.kind ?? "waiting")}${state.progress ? ` · T${state.progress.turn}` : ""}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Live execution</span><strong>${state.progress ? `${escapeHtml(state.progress.arm)} · ${escapeHtml(state.progress.phase)} · ${state.progress.iteration}/${state.progress.maxIterations}` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Graph integrity</span><strong>${state.validTransactions} valid / ${state.invalidTransactions} invalid</strong></div>
    <div class="infinite-metric"><span class="metric-label">Isolated workspaces</span><strong>${state.workspace.stateweaveFiles} candidate A / ${state.workspace.naiveFiles} candidate B files</strong></div>
    <div class="infinite-metric sw-metric"><span class="metric-label">StateWeave agent latest context</span><strong>${swTokens.toLocaleString()} tok</strong></div>
    <div class="infinite-metric baseline-metric"><span class="metric-label">Naive agent latest context</span><strong>${baselineTokens.toLocaleString()} tok</strong></div>
    <div class="infinite-metric"><span class="metric-label">Naive agent compaction</span><strong>${(state.naiveStrategy.thresholdTokens / 1000).toFixed(0)}k → summary + last ${state.naiveStrategy.retainMessages} · ${state.naiveStrategy.totalCompactions} run</strong></div>
    <div class="infinite-metric"><span class="metric-label">Latest tool calls</span><strong>${lastTurn ? `${lastTurn.toolCalls} StateWeave / ${lastTurn.baselineToolCalls} naive` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Graph size</span><strong>${snapshot?.nodeCount ?? 0} nodes / ${snapshot?.edgeCount ?? 0} edges</strong></div>
    <div class="infinite-metric sw-metric"><span class="metric-label">Semantic memory</span><strong>${snapshot?.semanticNodeCount ?? 0} semantic · ${snapshot?.suggestedSemanticNodeCount ?? 0} suggested types</strong></div>
    <div class="infinite-metric sw-metric"><span class="metric-label">StateWeave agent completion-gated quality</span><strong>${quality ? `${(quality.stateweavePassRate * 100).toFixed(1)}%` : "—"}</strong></div>
    <div class="infinite-metric baseline-metric"><span class="metric-label">Naive agent completion-gated quality</span><strong>${quality ? `${(quality.naivePassRate * 100).toFixed(1)}%` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Completed turns</span><strong>${state.reliability ? `${state.reliability.stateweaveCompleted} StateWeave / ${state.reliability.challengerCompleted} naive` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Failures / provider retries</span><strong>${state.reliability ? `${state.reliability.stateweaveAgentFailures} StateWeave · ${state.reliability.challengerAgentFailures} naive · ${state.reliability.providerRetries} retries` : "—"}</strong></div>`;

  renderInfiniteExecutive(state, swTokens, baselineTokens, quality);
  renderInfiniteChart(state.series);
  renderInfiniteQualityChart(state.qualitySeries);
  renderInfiniteStatistics(state);

  infiniteTurnNumber.max = String(state.turnCount);
  infiniteTurnNumber.placeholder = state.turnArchive.firstTurn
    ? `${state.turnArchive.firstTurn}–${state.turnArchive.lastTurn}`
    : "No archived turns";
  const turns = [...state.turns].reverse();
  infiniteTurns.innerHTML = turns.length
    ? turns.map((turn) => `
      <button class="infinite-turn" type="button" data-infinite-turn="${turn.turn}">
        <header><span class="turn-badge">T${turn.turn}</span> <span class="phase-badge seed">${escapeHtml(turn.taskKind)}</span> ${scoreBadges(turn.score)} ${turn.stateweaveCompleted === false ? `<span class="score-chip fail">graph failure</span>` : ""}${turn.baselineCompleted === false ? `<span class="score-chip fail">challenger failure</span>` : ""}</header>
        <small>${turn.nodeCount}n/${turn.edgeCount}e · graph ${turn.promptTokenEstimate.toLocaleString()} ctx / ${turn.toolCalls} tools / ${turn.modelCalls} calls · challenger ${turn.baselineTokenEstimate.toLocaleString()} ctx / ${turn.baselineToolCalls} tools / ${turn.baselineModelCalls} calls${turn.baselineCompactions ? ` / ${turn.baselineCompactions} compaction` : ""}</small>
        <span class="turn-preview">${escapeHtml(oneLine(turn.prompt).slice(0, 180))}</span>
      </button>`).join("")
    : `<p class="muted-copy">Waiting for the first filesystem task…</p>`;
  for (const button of infiniteTurns.querySelectorAll<HTMLButtonElement>("[data-infinite-turn]")) {
    button.addEventListener("click", () => {
      const turn = state.turns.find((item) => item.turn === Number(button.dataset.infiniteTurn));
      if (turn) renderInfiniteTurnDetail(turn);
    });
  }

  const clusters = snapshot?.clusters ?? [];
  infiniteClusters.innerHTML = `${state.nodeTypes.map((type) => `<div class="infinite-cluster"><span class="cluster-id">${escapeHtml(type)}</span> <span class="cluster-label">${escapeHtml(state.nodeTypeRationales[type] ?? "")}</span></div>`).join("")}${clusters.length ? clusters.map((cluster) => `<div class="infinite-cluster"><span class="cluster-id">${escapeHtml(cluster.id)}</span> <span class="cluster-nodes">${cluster.nodeCount}n</span> <span class="cluster-label">${escapeHtml(cluster.label)}</span></div>`).join("") : ""}`;
}

function renderInfiniteExecutive(state: InfiniteStateView, swTokens: number, baselineTokens: number, quality: InfiniteQualityPoint | undefined): void {
  const target = document.getElementById("infinite-executive-live");
  if (!target) return;
  const qualityGap = quality ? (quality.stateweavePassRate - quality.naivePassRate) * 100 : undefined;
  const verdict = qualityGap === undefined
    ? "Waiting for the first scored filesystem task."
    : qualityGap > 2
      ? `The graph candidate leads the transcript challenger by ${qualityGap.toFixed(1)} quality points.`
      : qualityGap < -2
        ? `The graph candidate trails the transcript challenger by ${Math.abs(qualityGap).toFixed(1)} quality points.`
        : "The candidates are currently within two quality points.";
  const context = baselineTokens ? ` Latest-call context is ${swTokens.toLocaleString()} tokens for the graph candidate versus ${baselineTokens.toLocaleString()} for the transcript challenger.` : "";
  target.className = `infinite-executive-live ${qualityGap !== undefined && qualityGap < -2 ? "warn" : ""}`;
  target.innerHTML = `<h3>Executive snapshot</h3><p><strong>T${state.turnCount}:</strong> ${escapeHtml(verdict + context)} Bash is restricted by a read-only command allowlist, and each agent runs in a separate workspace.</p>`;
}

function scoreBadges(score: { stateweave: ProbeScore; naive: ProbeScore }): string {
  const chip = (label: string, value: ProbeScore) => `<span class="score-chip ${value.score}" title="${escapeAttribute(value.details.length ? `Failed: ${value.details.join(", ")}` : "All checks passed")}">${label} ${value.completed === false ? `agent failure · workspace ${value.passed}/${value.total}` : `${value.score} ${value.passed}/${value.total}`}</span>`;
  return chip("graph", score.stateweave) + chip("challenger", score.naive);
}

type PairedStatistics = {
  n: number;
  stateweaveMean: number;
  nativeMean: number;
  difference: number;
  tStatistic: number;
  degreesFreedom: number;
  pValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  wins: number;
  ties: number;
  losses: number;
  signTestPValue: number;
};

function pairedStatistics(series: InfiniteQualityPoint[], fromTurn = 1): PairedStatistics | undefined {
  let previousStateWeaveTotal = 0;
  let previousNativeTotal = 0;
  const pairs: Array<{ stateweave: number; native: number }> = [];
  for (const point of series) {
    const stateweaveTotal = point.stateweavePassRate * point.stateweaveScored;
    const nativeTotal = point.naivePassRate * point.naiveScored;
    const stateweave = Math.round((stateweaveTotal - previousStateWeaveTotal) * 20) / 20;
    const native = Math.round((nativeTotal - previousNativeTotal) * 20) / 20;
    previousStateWeaveTotal = stateweaveTotal;
    previousNativeTotal = nativeTotal;
    if (point.turn >= fromTurn) pairs.push({ stateweave, native });
  }
  if (pairs.length < 2) return undefined;
  const n = pairs.length;
  const stateweaveMean = pairs.reduce((sum, pair) => sum + pair.stateweave, 0) / n;
  const nativeMean = pairs.reduce((sum, pair) => sum + pair.native, 0) / n;
  const differences = pairs.map((pair) => pair.stateweave - pair.native);
  const difference = stateweaveMean - nativeMean;
  const variance = differences.reduce((sum, value) => sum + (value - difference) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  const tStatistic = standardError > 0 ? difference / standardError : difference === 0 ? 0 : Number.POSITIVE_INFINITY;
  const pValue = Number.isFinite(tStatistic) ? 2 * (1 - normalCdf(Math.abs(tStatistic))) : 0;
  const wins = differences.filter((value) => value > 1e-9).length;
  const losses = differences.filter((value) => value < -1e-9).length;
  const ties = n - wins - losses;
  return {
    n,
    stateweaveMean,
    nativeMean,
    difference,
    tStatistic,
    degreesFreedom: n - 1,
    pValue,
    confidenceLow: difference - 1.96 * standardError,
    confidenceHigh: difference + 1.96 * standardError,
    wins,
    ties,
    losses,
    signTestPValue: twoSidedSignTest(wins, losses)
  };
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)));
  return 0.5 * (1 + erf);
}

function twoSidedSignTest(wins: number, losses: number): number {
  const trials = wins + losses;
  if (trials === 0) return 1;
  const cutoff = Math.min(wins, losses);
  let logProbability = -trials * Math.LN2;
  let logCumulative = logProbability;
  for (let successes = 1; successes <= cutoff; successes++) {
    logProbability += Math.log(trials - successes + 1) - Math.log(successes);
    const maxLog = Math.max(logCumulative, logProbability);
    logCumulative = maxLog + Math.log(Math.exp(logCumulative - maxLog) + Math.exp(logProbability - maxLog));
  }
  return Math.min(1, 2 * Math.exp(logCumulative));
}

function renderInfiniteStatistics(state: InfiniteStateView): void {
  const evidence = state.evidence;
  const p = (value: number) => value < 0.0001 ? "<0.0001" : value.toFixed(4);
  infiniteStatistics.innerHTML = `
    <div class="infinite-stat-header"><h3>Preregistered block-level evidence</h3><p>${escapeHtml(state.design.primaryOutcome)}</p></div>
    <div class="infinite-stat-grid">
      <article class="infinite-stat-card">
        <h4>Frozen design <small>v${state.design.version} · seed ${state.design.seed}</small></h4>
        <strong>${state.turnCount}/${state.design.targetTurns} paired turns</strong>
        ${state.design.protocolId ? `<p><code>${escapeHtml(state.design.protocolId)}</code></p>` : ""}
        <p>${escapeHtml(state.design.executionOrder)}</p>
        <p>${escapeHtml(state.design.stoppingRule)}</p>
        ${state.challenger ? `<p><strong>Calibration:</strong> ${escapeHtml(state.challenger.calibration.status)} · ${state.challenger.calibration.passed}/${state.challenger.calibration.scenarios} anchors · driver ${state.challenger.driverUsage.calls} calls · judge ${state.challenger.judgeUsage.calls} calls · ${state.challenger.judgeReviewTurns.length} review flags</p>` : ""}
        ${state.design.blindingPolicy ? `<p>${escapeHtml(state.design.blindingPolicy)}</p>` : ""}
        ${state.design.challengerPolicy ? `<p>${escapeHtml(state.design.challengerPolicy)}</p>` : ""}
        ${state.design.failurePolicy ? `<p>${escapeHtml(state.design.failurePolicy)}</p>` : ""}
        ${state.design.fairnessPolicy ? `<p>${escapeHtml(state.design.fairnessPolicy)}</p>` : ""}
        ${state.design.semanticPolicy ? `<p>${escapeHtml(state.design.semanticPolicy)}</p>` : ""}
        ${state.design.qualityPolicy ? `<p>${escapeHtml(state.design.qualityPolicy)}</p>` : ""}
      </article>
      ${evidence ? `<article class="infinite-stat-card">
        <h4>Primary analysis <small>n=${evidence.blocks} complete held-out scenarios</small></h4>
        <strong>${(evidence.meanDifference * 100).toFixed(2)} quality-point graph difference</strong>
        <p>Graph ${(evidence.stateweaveMean * 100).toFixed(2)}% · challenger ${(evidence.nativeMean * 100).toFixed(2)}% · bootstrap 95% CI ${(evidence.confidenceLow * 100).toFixed(2)} to ${(evidence.confidenceHigh * 100).toFixed(2)} points</p>
        <p>Two-sided sign-flip permutation p=${p(evidence.permutationPValue)} · ${evidence.resamples.toLocaleString()} seeded resamples</p>
        <p>Scenario wins/ties/losses ${evidence.wins}/${evidence.ties}/${evidence.losses} · exact sign-test p=${p(evidence.signTestPValue)}</p>
      </article>` : `<article class="infinite-stat-card"><h4>Primary analysis</h4><p>Waiting for the first complete held-out scenario.</p></article>`}
    </div>
    <p class="statistics-caveat">${escapeHtml(state.design.analysisPlan)} Scenarios evolve one continuous trajectory and are serially dependent; these statistics summarize this frozen protocol and are not standalone causal proof. The dashboard does not change the stopping rule when results are viewed.</p>`;
}

function renderInfiniteTurnDetail(turn: InfiniteTurn): void {
  infiniteTurnNumber.value = String(turn.turn);
  const judgment = (label: string, score: ProbeScore) => {
    const completionFailure = score.completed === false ? score.details.find((detail) => detail.startsWith("agent did not complete")) : undefined;
    const checks = score.checks?.length
      ? [...(completionFailure ? [{ label: completionFailure, passed: false }] : []), ...score.checks]
      : [
          ...score.details.map((detail) => ({ label: detail, passed: false })),
          ...(score.passed ? [{ label: `${score.passed} other check${score.passed === 1 ? "" : "s"} passed (legacy turn; labels were not archived)`, passed: true }] : [])
        ];
    return `<section class="turn-judgment ${score.score}">
      <h4>${escapeHtml(label)} judgment <span class="score-chip ${score.score}">${score.completed === false ? `agent failure · workspace ${score.passed}/${score.total}` : `${score.score} ${score.passed}/${score.total}`}</span></h4>
      <p>${score.completed === false ? "The run did not complete, so primary quality is zero regardless of residual workspace checks." : score.details.length ? "The deterministic verifier found the failures below." : "All deterministic workspace checks passed."}</p>
      <ul>${checks.map((check) => `<li class="${check.passed ? "passed" : "failed"}">${check.passed ? "✓" : "✕"} ${escapeHtml(check.label)}</li>`).join("")}</ul>
    </section>`;
  };
  infiniteTurnDetail.innerHTML = `
    <article class="turn-inspection">
      <header><span class="turn-badge">T${turn.turn}</span><span class="phase-badge seed">${escapeHtml(turn.taskKind)}</span>${turn.stateweaveCompleted === false ? `<span class="score-chip fail">graph agent failure</span>` : ""}${turn.baselineCompleted === false ? `<span class="score-chip fail">challenger agent failure</span>` : ""}</header>
      <section><h4>Question / task</h4><pre>${escapeHtml(turn.prompt)}</pre></section>
      <div class="turn-answer-grid">
        <section class="turn-response stateweave"><h4>StateWeave agent answer</h4><pre>${escapeHtml(turn.answer || "(empty answer)")}</pre></section>
        <section class="turn-response naive"><h4>Naive agent answer</h4><pre>${escapeHtml(turn.baselineAnswer || "(empty answer)")}</pre></section>
      </div>
      <div class="turn-judgment-grid">${judgment("StateWeave agent", turn.score.stateweave)}${judgment("Naive agent", turn.score.naive)}</div>
      <footer>StateWeave agent: ${turn.promptTokenEstimate.toLocaleString()} context tokens, ${turn.totalInputTokens.toLocaleString()} total input, ${turn.latencyMs.toLocaleString()}ms, ${turn.toolCalls} tool calls. Naive agent: ${turn.baselineTokenEstimate.toLocaleString()} context tokens, ${turn.baselineTotalInputTokens.toLocaleString()} total input, ${turn.baselineLatencyMs.toLocaleString()}ms, ${turn.baselineToolCalls} tool calls${turn.baselineCompactions ? `, ${turn.baselineCompactions} compaction` : ""}.</footer>
    </article>`;
}

function renderInfiniteQualityChart(series: InfiniteQualityPoint[]): void {
  const canvas = document.getElementById("infinite-quality-chart") as HTMLCanvasElement | null;
  if (!canvas) return;
  drawLineChart(canvas, series, {
    sw: (p) => p.stateweavePassRate * 100,
    baseline: (p) => p.naivePassRate * 100,
    yLabel: "%", yMax: 100, emptyText: "Waiting for the first scored task…"
  });
}

function renderInfiniteChart(series: InfiniteSeriesPoint[]): void {
  const canvas = document.getElementById("infinite-chart") as HTMLCanvasElement | null;
  if (!canvas) return;
  drawLineChart(canvas, series, {
    sw: (p) => p.stateweaveTokens,
    baseline: (p) => p.baselineTokens,
    yLabel: "tokens", yMax: "auto", emptyText: "Waiting for the first agent task…", zeroIsMissing: true
  });
}

function drawLineChart<T extends { turn: number }>(canvas: HTMLCanvasElement, series: T[], lines: { sw: (p: T) => number; baseline: (p: T) => number; yLabel: string; yMax: number | "auto"; emptyText: string; zeroIsMissing?: boolean }): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 800;
  const cssH = canvas.clientHeight || 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const padL = 56, padR = 16, padT = 12, padB = 28;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  if (series.length < 1) {
    ctx.fillStyle = "#94a3b8"; ctx.font = "13px ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(lines.emptyText, cssW / 2, cssH / 2); return;
  }
  const turns = series.map((p) => p.turn);
  const maxTurn = Math.max(...turns, 1);
  const allVals = series.flatMap((p) => [lines.sw(p), lines.baseline(p)]).filter((value) => Number.isFinite(value) && (!lines.zeroIsMissing || value > 0));
  const maxVal = Math.max(...allVals, 1);
  const niceMax = lines.yMax === "auto" ? Math.ceil(maxVal / 1000) * 1000 || 1000 : lines.yMax;
  const ySteps = 4;
  ctx.textAlign = "right";
  for (let i = 0; i <= ySteps; i++) {
    const value = (niceMax / ySteps) * i;
    const y = padT + plotH - (plotH / ySteps) * i;
    ctx.strokeStyle = "rgba(148,163,184,0.12)"; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.fillText(lines.yLabel === "%" ? `${Math.round(value)}%` : `${value >= 1000 ? (value / 1000).toFixed(0) + "k" : Math.round(value)}`, padL - 8, y + 4);
  }
  ctx.textAlign = "center";
  const xLabelCount = Math.min(8, maxTurn);
  for (let i = 0; i <= xLabelCount; i++) { const turn = Math.round((maxTurn / xLabelCount) * i); const x = padL + (plotW / xLabelCount) * i; ctx.fillText(String(turn), x, cssH - padB + 18); }
  const xFor = (turn: number) => padL + (turn / maxTurn) * plotW;
  const yFor = (v: number) => padT + plotH - (Math.min(v, niceMax) / niceMax) * plotH;
  const drawLine = (color: string, fn: (p: T) => number, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    let drawing = false;
    for (const point of series) {
      const value = fn(point);
      if (!Number.isFinite(value) || (lines.zeroIsMissing && value <= 0)) { drawing = false; continue; }
      const x = xFor(point.turn), y = yFor(value);
      drawing ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      drawing = true;
    }
    ctx.stroke();
  };
  drawLine("#f97316", lines.baseline, 2);
  drawLine("#6366f1", lines.sw, 2.5);
  const last = series[series.length - 1];
  const dot = (color: string, value: number) => {
    if (!Number.isFinite(value) || (lines.zeroIsMissing && value <= 0)) return;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(xFor(last.turn), yFor(value), 3.5, 0, Math.PI * 2); ctx.fill();
  };
  dot("#f97316", lines.baseline(last)); dot("#6366f1", lines.sw(last));
}

// --- Infinite agent controls ---

const infiniteCalibrateButton = element<HTMLButtonElement>("infinite-calibrate");
const swLoopStartButton = element<HTMLButtonElement>("sw-loop-start");
const swLoopStopButton = element<HTMLButtonElement>("sw-loop-stop");
const swLoopStatus = element<HTMLElement>("sw-loop-status");
let swLoopPollTimer: ReturnType<typeof setInterval> | undefined;

async function openInfiniteTurn(turnNumber: number): Promise<void> {
  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    infiniteTurnDetail.innerHTML = `<p class="message error">Enter a valid positive turn number.</p>`;
    return;
  }
  const recent = latestInfiniteState?.turns.find((turn) => turn.turn === turnNumber);
  if (recent) {
    renderInfiniteTurnDetail(recent);
    return;
  }
  infiniteTurnDetail.innerHTML = `<p class="muted-copy">Loading T${turnNumber}…</p>`;
  try {
    const response = await fetch(`${apiBase}/api/infinite-agent/turns/${turnNumber}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404 ? `T${turnNumber} is not available. The durable archive currently starts at T${latestInfiniteState?.turnArchive.firstTurn || "—"}.` : `Turn lookup failed (${response.status}).`);
    renderInfiniteTurnDetail(await response.json() as InfiniteTurn);
  } catch (error) {
    infiniteTurnDetail.innerHTML = `<p class="message error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  }
}

infiniteTurnOpen.addEventListener("click", () => void openInfiniteTurn(Number(infiniteTurnNumber.value)));
infiniteTurnLatest.addEventListener("click", () => {
  const latest = latestInfiniteState?.turnCount ?? 0;
  if (latest) void openInfiniteTurn(latest);
});
infiniteTurnNumber.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void openInfiniteTurn(Number(infiniteTurnNumber.value));
});

infiniteCalibrateButton.addEventListener("click", async () => {
  infiniteCalibrateButton.disabled = true;
  swLoopStatus.innerHTML = `<p class="muted-copy">Running private blind-judge anchor calibration…</p>`;
  try {
    const response = await fetch(`${apiBase}/api/infinite-agent/calibrate`, { method: "POST" });
    if (!response.ok) throw new Error(`Calibration failed (${response.status})`);
    swLoopStatus.innerHTML = `<p class="muted-copy">Calibration started. Progress will update below.</p>`;
    startSwLoopPoll();
  } catch (error) {
    swLoopStatus.innerHTML = `<p class="message error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  } finally {
    infiniteCalibrateButton.disabled = false;
  }
});

swLoopStartButton.addEventListener("click", async () => {
  swLoopStartButton.disabled = true;
  try {
    const response = await fetch(`${apiBase}/api/infinite-agent/start`, { method: "POST" });
    if (!response.ok) throw new Error(`Start failed (${response.status})`);
    swLoopStatus.innerHTML = `<p class="muted-copy">Infinite agent started.</p>`;
    startSwLoopPoll();
  } catch (error) {
    swLoopStartButton.disabled = false;
    swLoopStatus.innerHTML = `<p class="message error"><div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div></p>`;
  }
});

swLoopStopButton.addEventListener("click", async () => {
  swLoopStopButton.disabled = true;
  await fetch(`${apiBase}/api/infinite-agent/stop`, { method: "POST" }).catch(() => undefined);
});

function startSwLoopPoll(): void {
  stopSwLoopPoll();
  void pollSwLoop();
  swLoopPollTimer = setInterval(() => void pollSwLoop(), 2000);
}

function stopSwLoopPoll(): void {
  if (swLoopPollTimer !== undefined) clearInterval(swLoopPollTimer);
  swLoopPollTimer = undefined;
}

async function pollSwLoop(): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/api/infinite-agent/state`, { cache: "no-store" });
    if (!response.ok) return;
    const state = await response.json() as InfiniteStateView;
    renderInfiniteState(state);
    renderAgentRuntime(state);
  } catch { /* network blip */ }
}

function renderAgentRuntime(state: InfiniteStateView): void {
  const heartbeatAt = state.progress?.updatedAt ?? state.updatedAt;
  const heartbeatAgeMs = Date.now() - Date.parse(heartbeatAt);
  const running = state.status === "running";
  const progress = state.progress;
  const trajectory = (state.trajectory ?? []).slice(-8);
  infiniteCalibrateButton.disabled = running || state.challenger?.calibration.status === "running" || state.challenger?.calibration.status === "passed";
  swLoopStartButton.disabled = running || state.challenger?.calibration.status !== "passed";
  swLoopStopButton.disabled = !running;
  swLoopStatus.innerHTML = `
    <div class="infinite-metric"><span class="metric-label">Agent status</span><strong>${escapeHtml(state.status)}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Heartbeat</span><strong>${Number.isFinite(heartbeatAgeMs) ? `${Math.max(0, Math.round(heartbeatAgeMs / 1000))}s ago` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Active trajectory</span><strong>${progress ? `T${progress.turn} · ${escapeHtml(progress.arm)} · ${escapeHtml(progress.phase)} · iteration ${progress.iteration}/${progress.maxIterations}` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Live calls</span><strong>${progress ? `${progress.modelCalls} model / ${progress.toolCalls} tools` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Current step</span><strong>${escapeHtml(progress?.detail ?? state.message ?? "Waiting")}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Recent trajectory</span><strong>${trajectory.length ? trajectory.map((event) => `${escapeHtml(event.arm)} · ${escapeHtml(event.phase)} ${event.iteration} · ${escapeHtml(event.detail)}`).join("<br>") : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Last unscored error</span><strong>${state.lastAttemptError ? `T${state.lastAttemptError.turn} attempt ${state.lastAttemptError.attempt} · ${escapeHtml(state.lastAttemptError.error)}` : "—"}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Tools</span><strong>${escapeHtml(state.tools.join(", "))}</strong></div>
    <div class="infinite-metric"><span class="metric-label">Bash security</span><strong>${escapeHtml(state.security.bashPolicy)}</strong></div>`;
}

// Start polling agent state when the Infinite page is active
if (activePage === "infinite") {
  startSwLoopPoll();
  void loadChallengerScenarioLibrary();
}
