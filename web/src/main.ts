import type { GraphFrame, GraphOp, StateGraph, TraceStep } from "../../src/core/types.js";
import { scoreEvalRecords, type EvalPrimitive as Primitive, type EvalVote as Vote, type ScoreBreakdown } from "./evalScores.js";
import { promptFiveCases, promptFiveCategoryOrder, type PromptFiveCategory } from "./promptFive.js";
import "./styles.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ModelMessage = { role: "user" | "assistant"; content: string };

type StateWeavePayload = {
  inputFrame?: GraphFrame;
  frameAfter?: GraphFrame;
  output: string;
  trace: TraceStep[];
  graph: StateGraph;
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

type PageName = "state" | "ab" | "prompt-one" | "prompt-two" | "prompt-three" | "prompt-four" | "prompt-five";
type SuiteId = "prompt-one" | "prompt-two" | "prompt-three" | "prompt-four" | "prompt-five";
type EvalCategory = "memory" | "logical" | "holistic" | PromptFiveCategory;
type MultiCase = { prompt: string; expect: string; categories?: EvalCategory[] };
type PromptSuite = { id: SuiteId; title: string; description: string; readyTitle: string; readyCopy: string; expectLabel: string; mode?: "manual" | "judge"; cases: MultiCase[] };
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
  judgedBy?: "judges" | "human";
  judges?: JudgeDecision[];
};

let activePage: PageName = pageFromHash();
let multiSuiteId: SuiteId = suiteIdForPage(activePage) ?? "prompt-one";
let stateFrame: GraphFrame | undefined;
let abStateFrame: GraphFrame | undefined;
let abRegularHistory: ChatMessage[] = [];
let multiStateFrame: GraphFrame | undefined;
let multiRegularHistory: ChatMessage[] = [];
let multiIndex = 0;
let multiRunning = false;
let multiRecords: MultiRecord[] = [];
let stateRunning = false;
let abRunning = false;
let copyCounter = 0;

const copyPayloads = new Map<string, string>();
const categoryOrder: EvalCategory[] = ["memory", "logical", "holistic", ...promptFiveCategoryOrder];
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
const abTab = element<HTMLButtonElement>("ab-tab");
const multiTab = element<HTMLButtonElement>("multi-tab");
const multiTwoTab = element<HTMLButtonElement>("multi-two-tab");
const multiThreeTab = element<HTMLButtonElement>("multi-three-tab");
const multiFourTab = element<HTMLButtonElement>("multi-four-tab");
const multiFiveTab = element<HTMLButtonElement>("multi-five-tab");
const statePage = element<HTMLElement>("state-page");
const abPage = element<HTMLElement>("ab-page");
const multiPage = element<HTMLElement>("multi-page");
const chat = element<HTMLElement>("chat");
const form = element<HTMLFormElement>("composer");
const input = element<HTMLTextAreaElement>("input");
const send = element<HTMLButtonElement>("send");
const reset = element<HTMLButtonElement>("reset");
const status = element<HTMLElement>("status");
const provider = element<HTMLElement>("provider");
const stateInput = element<HTMLElement>("state-input");
const stateOutput = element<HTMLElement>("state-output");
const graph = element<HTMLElement>("graph");
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
const multiSteps = element<HTMLElement>("multi-steps");
const multiStage = element<HTMLElement>("multi-stage");

setActivePage(activePage, false);
renderMultiProgress();
void loadHealth();

stateTab.addEventListener("click", () => setActivePage("state"));
abTab.addEventListener("click", () => setActivePage("ab"));
multiTab.addEventListener("click", () => setActivePage("prompt-one"));
multiTwoTab.addEventListener("click", () => setActivePage("prompt-two"));
multiThreeTab.addEventListener("click", () => setActivePage("prompt-three"));
multiFourTab.addEventListener("click", () => setActivePage("prompt-four"));
multiFiveTab.addEventListener("click", () => setActivePage("prompt-five"));
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
  else if (activePage === "ab") resetAbTests();
  else resetMultiTest();
});
input.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void sendStateWeaveMessage();
  }
});
abInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void runAbTest();
  }
});
multiStart.addEventListener("click", () => {
  if (!multiRecords.length && multiIndex === 0) resetMultiTest(false);
  void runNextMultiCase();
});
abResults.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  const button = target?.closest<HTMLButtonElement>("button[data-copy-id]");
  if (!button?.dataset.copyId) return;
  const value = copyPayloads.get(button.dataset.copyId);
  if (value) void copyText(value, button);
});
multiStage.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  const voteButton = target?.closest<HTMLButtonElement>("button[data-vote]");
  if (voteButton?.dataset.vote) voteMulti(voteButton.dataset.vote as Vote);
});

function pageFromHash(): PageName {
  if (location.hash === "#ab") return "ab";
  if (location.hash === "#prompt-one") return "prompt-one";
  if (location.hash === "#prompt-two") return "prompt-two";
  if (location.hash === "#prompt-three") return "prompt-three";
  if (location.hash === "#prompt-four") return "prompt-four";
  if (location.hash === "#prompt-five") return "prompt-five";
  return "state";
}

function suiteIdForPage(page: PageName): SuiteId | undefined {
  if (page === "prompt-one" || page === "prompt-two" || page === "prompt-three" || page === "prompt-four" || page === "prompt-five") return page;
  return undefined;
}

function currentSuite(): PromptSuite {
  return promptSuites[multiSuiteId];
}

function setActivePage(page: PageName, updateHash = true): void {
  activePage = page;
  const isState = page === "state";
  const isAb = page === "ab";
  const nextSuiteId = suiteIdForPage(page);
  const isMulti = Boolean(nextSuiteId);
  if (nextSuiteId && nextSuiteId !== multiSuiteId) {
    multiSuiteId = nextSuiteId;
    resetMultiTest(false);
  }

  const suite = currentSuite();
  stateTab.classList.toggle("active", isState);
  stateTab.setAttribute("aria-selected", String(isState));
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
  statePage.hidden = !isState;
  statePage.classList.toggle("active", isState);
  abPage.hidden = !isAb;
  abPage.classList.toggle("active", isAb);
  multiPage.hidden = !isMulti;
  multiPage.classList.toggle("active", isMulti);
  multiTitle.textContent = suite.title;
  multiDescription.textContent = suite.description;
  reset.textContent = isState ? "Reset" : isAb ? "Reset A/B" : `Reset ${suite.title.toLowerCase()}`;
  if (updateHash) history.replaceState(null, "", isState ? location.pathname : isAb ? "#ab" : `#${suite.id}`);
  if (isState) input.focus();
  else if (isAb) abInput.focus();
  else multiStart.focus();
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
  appendUser(text);
  const pending = appendPendingStateWeave();

  try {
    const result = await runStateWeave(text, stateFrame);
    stateFrame = result.stateweave.frameAfter;
    pending.remove();
    appendAssistant(result.stateweave.output);
    renderStateWeave(result.stateweave);
    status.textContent = `Done · StateGraph ${result.stateweave.graph.nodes.length} nodes / ${result.stateweave.graph.edges.length} edges`;
  } catch (error) {
    pending.remove();
    appendError(chat, error instanceof Error ? error.message : String(error));
    status.textContent = "Failed.";
  } finally {
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

async function runStateWeave(text: string, frame: GraphFrame | undefined): Promise<StateWeaveResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame })
  });

  const body = (await response.json()) as StateWeaveResponse | { error?: string };
  if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Request failed (${response.status})`);
  return body as StateWeaveResponse;
}

async function compareStateWeave(text: string, frame: GraphFrame | undefined, messages: ChatMessage[]): Promise<CompareResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame, messages })
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
  stateInput.textContent = result.inputFrame ? compactFrame(result.inputFrame) : "No GraphFrame captured.";
  stateOutput.textContent = formatStateOutput(result.trace, result.output);
  renderGraph(result.graph);
}

async function loadHealth(): Promise<void> {
  const response = await fetch(`${apiBase}/api/health`).catch(() => undefined);
  const health = response?.ok ? ((await response.json()) as { provider?: string }) : undefined;
  provider.textContent = health?.provider ? `Provider: ${health.provider}` : "Provider unavailable";
}

function resetStateWeaveChat(): void {
  stateFrame = undefined;
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
  multiStateFrame = undefined;
  multiRegularHistory = [];
  multiIndex = 0;
  multiRunning = false;
  multiRecords = [];
  multiStart.disabled = false;
  multiStart.textContent = `Start ${suite.title.toLowerCase()}`;
  multiTitle.textContent = suite.title;
  multiDescription.textContent = suite.description;
  multiStage.innerHTML = `<div class="empty-state compact"><h2>${escapeHtml(suite.readyTitle)}</h2><p>${escapeHtml(suite.readyCopy)}</p></div>`;
  renderMultiProgress();
  if (focus) multiStart.focus();
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
  multiStart.disabled = true;
  multiStart.textContent = "Waiting for human vote";
  multiStage.innerHTML = `
    <article class="multi-card">
      <div class="multi-case-header">
        <p class="eyebrow">Judge disagreement · Prompt ${record.index + 1} / ${currentSuite().cases.length}</p>
        <h2>${escapeHtml(record.prompt)}</h2>
        <p class="expectation"><strong>${escapeHtml(currentSuite().expectLabel)}:</strong> ${escapeHtml(record.expect)}</p>
        ${categoryPills(record.categories)}
      </div>
      <div class="judge-result disagreement">
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
        <button class="button primary" type="button" data-vote="a">A is correct</button>
        <button class="button primary" type="button" data-vote="b">B is correct</button>
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
    ${liveCategoryScoreHtml()}`;
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

function appendUser(text: string): void {
  chat.insertAdjacentHTML("beforeend", `<div class="message user"><div>${escapeHtml(text)}</div></div>`);
  scrollChat(chat);
}

function appendAssistant(stateweave: string): void {
  chat.insertAdjacentHTML(
    "beforeend",
    `<article class="answer state-answer assistant-response">
      <span>StateWeave</span>
      ${responseHtml(stateweave)}
    </article>`
  );
  scrollChat(chat);
}

function appendPendingStateWeave(): HTMLElement {
  const item = document.createElement("article");
  item.className = "answer pending assistant-response";
  item.innerHTML = `<span>StateWeave</span><p>Compiling GraphFrame and growing the StateGraph…</p>`;
  chat.append(item);
  scrollChat(chat);
  return item;
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
  const layout = graphLayout(value);
  const turnCount = value.nodes.filter((node) => node.type === "user_input").length;

  graph.className = "graph-visual";
  graph.innerHTML = `
    <div class="graph-summary">
      <strong>Turn ${turnCount}</strong>
      <span>${value.nodes.length} nodes · ${value.edges.length} edges</span>
    </div>
    <svg class="graph-svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="StateGraph visualization">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      <g class="edges">
        ${layout.edges.map((edge) => edge.fromNode && edge.toNode ? `
          <g class="edge-line">
            <line x1="${edge.fromNode.x}" y1="${edge.fromNode.y}" x2="${edge.toNode.x}" y2="${edge.toNode.y}" marker-end="url(#arrow)"></line>
            <text x="${(edge.fromNode.x + edge.toNode.x) / 2}" y="${(edge.fromNode.y + edge.toNode.y) / 2 - 8}">${escapeHtml(edge.type)}</text>
          </g>` : "").join("")}
      </g>
      <g class="nodes">
        ${layout.nodes.map((node) => `
          <g class="graph-node-vis ${escapeHtml(node.type)}" transform="translate(${node.x} ${node.y})">
            <circle r="28"></circle>
            <text class="node-id" y="-2">${escapeHtml(shorten(node.id, 18))}</text>
            <text class="node-type" y="15">${escapeHtml(node.type)}</text>
          </g>`).join("")}
      </g>
    </svg>
    <div class="node-details">
      ${value.nodes.map((node) => `
        <article class="node-detail">
          <div><strong>${escapeHtml(node.id)}</strong><span>${escapeHtml(node.type)}</span></div>
          <p>${escapeHtml(node.text)}</p>
        </article>`).join("")}
    </div>
  `;
}

function graphLayout(value: StateGraph): {
  width: number;
  height: number;
  nodes: Array<StateGraph["nodes"][number] & { x: number; y: number }>;
  edges: Array<StateGraph["edges"][number] & { fromNode?: StateGraph["nodes"][number] & { x: number; y: number }; toNode?: StateGraph["nodes"][number] & { x: number; y: number } }>;
} {
  const width = 920;
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value.nodes.length || 1))));
  const columnWidth = width / columns;
  const rowHeight = 140;
  const rows = Math.max(1, Math.ceil(value.nodes.length / columns));
  const height = Math.max(360, rows * rowHeight + 80);

  const nodes = value.nodes.map((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...node,
      x: Math.round(columnWidth / 2 + column * columnWidth),
      y: 80 + row * rowHeight
    };
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = value.edges.map((edge) => ({ ...edge, fromNode: nodeMap.get(edge.from), toNode: nodeMap.get(edge.to) }));
  return { width, height, nodes, edges };
}

function compactFrame(frame: GraphFrame): string {
  const lines = [
    `objective: ${frame.frame.objective}`,
    `currentFocus: ${frame.frame.currentFocus}`,
    `nextExpectedOutput: ${frame.frame.nextExpectedOutput}`,
    `activeConstraints: ${frame.frame.activeConstraints.length ? frame.frame.activeConstraints.join("; ") : "none"}`,
    "",
    "graph:",
    ...frame.graph.nodes.map((node) => `- ${node.id} [${node.type}] ${node.text}`),
    ...frame.graph.edges.map((edge) => `- ${edge.from} -${edge.type}-> ${edge.to}`)
  ];
  return lines.join("\n");
}

function formatStateOutput(trace: TraceStep[], finalAnswer: string): string {
  const parts = trace.map((step) => [
    `step ${step.step} raw model output:`,
    step.rawModelOutput,
    "",
    `step ${step.step} parsed GraphOps:`,
    formatOps(step.parsedOps)
  ].join("\n"));
  return [...parts, "", "final answer:", finalAnswer].join("\n");
}

function formatOps(ops: GraphOp[]): string {
  return ops.map(formatOp).join("\n");
}

function formatOp(op: GraphOp): string {
  if (op.op === "add_node") return `@node ${op.node.id} ${op.node.type} "${shorten(op.node.text, 96)}"`;
  if (op.op === "add_edge") return `@edge ${op.from} ${op.type} ${op.to}`;
  if (op.op === "update_node") return `@update ${op.id}`;
  if (op.op === "focus") return `@focus "${op.currentFocus}"`;
  if (op.op === "call_tool") return `@tool ${op.tool}`;
  if (op.op === "final") return op.artifactId ? `@final ${op.artifactId}` : `@final "${shorten(op.answer, 120)}"`;
  return "@unknown";
}

function responseHtml(value: string): string {
  const artifact = extractPreviewArtifact(value);
  if (!artifact) return `<p>${escapeHtml(value)}</p>`;
  return `
    <div class="artifact-preview">
      <iframe sandbox="" srcdoc="${escapeAttribute(artifact)}" title="Generated artifact preview"></iframe>
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
