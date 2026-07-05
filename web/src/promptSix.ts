export type PromptSixCategory = "anchor-recall" | "conflict-latest" | "revoked-active" | "order-tracking" | "cross-reference";

export type PromptSixCase = { prompt: string; expect: string; categories: PromptSixCategory[] };

export type PromptSixHypothesis = {
  thesis: string;
  method: string;
  prediction: string;
  successSignal: string;
};

export const promptSixHypothesis: PromptSixHypothesis = {
  thesis: "As conversational context grows, a regular messages[] baseline should show higher memory regression: older facts, overwritten facts, revoked facts, chronology, and cross-record joins become harder to retrieve reliably. A graph-state primitive should preserve and retrieve the current relevant state more consistently over later buckets.",
  method: "Run 200 sequential turns. Every turn both mutates the hidden working state and asks for a scored answer. Cases are bucketed over time so the live chart can show whether either variant degrades as context accumulates.",
  prediction: "Regular messages may stay competitive early, but should lose more exclusive wins or produce more neither outcomes in later buckets. StateWeave should maintain flatter performance on old anchors, latest-over-stale conflicts, revocations, order, and cross-reference joins.",
  successSignal: "A convincing result is not just total wins; it is a smaller late-bucket regression slope for StateWeave than for regular messages, especially on conflict-latest and cross-reference cases."
};

export const promptSixCategoryOrder = [
  "anchor-recall",
  "conflict-latest",
  "revoked-active",
  "order-tracking",
  "cross-reference"
] as const satisfies readonly PromptSixCategory[];

export const promptSixCategoryCounts: Record<PromptSixCategory, number> = {
  "anchor-recall": 40,
  "conflict-latest": 40,
  "revoked-active": 40,
  "order-tracking": 40,
  "cross-reference": 40
};

type Anchor = { key: string; code: string; city: string; animal: string; number: number };
type Ledger = { name: string; owner: string; status: string; budget: number; zone: string };

type State = {
  anchors: Anchor[];
  ledgers: Map<string, Ledger>;
  activeVaults: Map<string, number>;
  revokedVaults: Map<string, number>;
  tasks: string[];
};

const anchorNames = [
  "Atlas", "Atlus", "Boreal", "Beryl", "Cedar", "Cinder", "Delta", "Deltan", "Ember", "Embra",
  "Fable", "Faber", "Garnet", "Gannet", "Harbor", "Harper", "Iris", "Ibis", "Juno", "Junia",
  "Kilo", "Kira", "Lumen", "Lunar", "Mira", "Mirra", "Nova", "Nover", "Orion", "Orian",
  "Piper", "Pilar", "Quartz", "Quorra", "Rover", "Riven", "Solace", "Solano", "Talon", "Talia"
];
const cities = ["Quito", "Qena", "Oslo", "Oulu", "Lima", "Lyon", "Riga", "Rabat", "Seoul", "Sofia", "Turin", "Tunis", "Ulm", "Umea", "Vaduz", "Varna"];
const animals = ["lynx", "ibis", "otter", "marten", "kestrel", "heron", "yak", "tapir", "mink", "oriole", "stoat", "tern", "pika", "koala", "lemur", "quail"];
const owners = ["Mina", "Juno", "Rafi", "Nora", "Pavel", "Sena", "Toma", "Vera", "Wren", "Yara", "Zeno", "Luca"];
const statuses = ["amber", "green", "silver", "violet", "cobalt", "ivory", "black", "white", "bronze", "teal"];
const zones = ["Zeta", "Sigma", "Tau", "Rho", "Kappa", "Lambda", "Eta", "Iota"];
const taskWords = ["alpha", "bravo", "canto", "drift", "ember", "fjord", "gala", "helix", "ion", "jolt", "kepler", "lotus", "mango", "nimbus", "onyx", "prism"];

export function promptSixCases(): PromptSixCase[] {
  const cases: PromptSixCase[] = [];
  const state: State = { anchors: [], ledgers: new Map(), activeVaults: new Map(), revokedVaults: new Map(), tasks: [] };
  const add = (category: PromptSixCategory, prompt: string, expect: string): void => {
    cases.push({ prompt, expect, categories: [category] });
  };

  for (let epoch = 1; epoch <= 40; epoch++) {
    addAnchorCase(cases, state, add, epoch);
    addConflictCase(state, add, epoch);
    addRevocationCase(state, add, epoch);
    addOrderCase(state, add, epoch);
    addCrossReferenceCase(state, add, epoch);
  }

  assertPromptSixData(cases);
  return cases;
}

function addAnchorCase(_cases: PromptSixCase[], state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const anchor: Anchor = {
    key: `${anchorNames[epoch - 1]}-${pad(epoch)}`,
    code: `${anchorNames[(epoch * 5) % anchorNames.length].slice(0, 3).toUpperCase()}-${(epoch * 37 + 111) % 997}`,
    city: cities[(epoch * 7) % cities.length],
    animal: animals[(epoch * 11) % animals.length],
    number: 100 + ((epoch * 43 + 17) % 850)
  };
  state.anchors.push(anchor);
  const target = epoch <= 8 ? state.anchors[0] : state.anchors[(epoch * 7) % Math.min(10, state.anchors.length)];
  add(
    "anchor-recall",
    [
      `Prompt six epoch ${epoch}. Store anchor ${anchor.key} exactly: code=${anchor.code}, city=${anchor.city}, animal=${anchor.animal}, number=${anchor.number}.`,
      `Noise only: ${decoys(epoch, 1)}. Similar-name warning: do not confuse nearby names such as Atlas/Atlus or Mira/Mirra.`,
      `Question: recall the previously stored anchor ${target.key}. Return exactly code|city|animal|number for ${target.key}. No prose.`
    ].join(" "),
    `${target.code}|${target.city}|${target.animal}|${target.number}`
  );
}

function addConflictCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const name = anchorNames[(epoch * 3) % 12];
  const previous = state.ledgers.get(name);
  const ledger: Ledger = {
    name,
    owner: owners[(epoch * 5) % owners.length],
    status: statuses[(epoch * 7) % statuses.length],
    budget: 200 + ((epoch * 29 + 41) % 700),
    zone: zones[(epoch * 3) % zones.length]
  };
  state.ledgers.set(name, ledger);
  const stale = previous
    ? `Stale note says owner=${previous.owner}, status=${previous.status}, budget=${previous.budget}, zone=${previous.zone}; ignore stale notes.`
    : `Stale-looking decoy says owner=${owners[(epoch + 1) % owners.length]}, status=${statuses[(epoch + 2) % statuses.length]}, budget=${300 + epoch}; ignore it.`;
  add(
    "conflict-latest",
    [
      `Prompt six epoch ${epoch}. Current authoritative override for ledger ${name}: owner=${ledger.owner}, status=${ledger.status}, budget=${ledger.budget}, zone=${ledger.zone}.`,
      stale,
      `Noise only: ${decoys(epoch, 2)}.`,
      `Question: using the current authoritative value only, return owner/status/budget/zone for ledger ${name}. No prose.`
    ].join(" "),
    `${ledger.owner}/${ledger.status}/${ledger.budget}/${ledger.zone}`
  );
}

function addRevocationCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const addedName = `vault-${anchorNames[(epoch * 9) % anchorNames.length].toLowerCase()}-${pad(epoch)}`;
  const addedValue = 20 + ((epoch * 31 + 5) % 180);
  state.activeVaults.set(addedName, addedValue);
  let revokeText = "No vault is revoked in this turn.";
  if (epoch > 4 && epoch % 3 === 0 && state.activeVaults.size > 2) {
    const activeNames = [...state.activeVaults.keys()].filter((name) => name !== addedName);
    const revokedName = activeNames[(epoch * 2) % activeNames.length];
    const revokedValue = state.activeVaults.get(revokedName);
    if (revokedValue !== undefined) {
      state.activeVaults.delete(revokedName);
      state.revokedVaults.set(revokedName, revokedValue);
      revokeText = `Revoke ${revokedName}; it must not count as active after this turn.`;
    }
  }
  const activeNames = [...state.activeVaults.keys()].sort();
  const activeSum = [...state.activeVaults.values()].reduce((sum, value) => sum + value, 0);
  const oldestActive = activeNames[0] ?? "none";
  add(
    "revoked-active",
    [
      `Prompt six epoch ${epoch}. Activate ${addedName} with value=${addedValue}. ${revokeText}`,
      `Revoked vaults remain historical only; active calculations must exclude them. Noise only: ${decoys(epoch, 3)}.`,
      `Question: return activeCount|activeValueSum|alphabeticallyFirstActiveVault.`
    ].join(" "),
    `${activeNames.length}|${activeSum}|${oldestActive}`
  );
}

function addOrderCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const appended = `${taskWords[(epoch * 5) % taskWords.length]}-${pad(epoch)}`;
  state.tasks.push(appended);
  const operations = [`Append task ${appended} to the active task order.`];

  if (epoch % 4 === 0 && state.tasks.length > 3) {
    const renameIndex = (epoch * 3) % state.tasks.length;
    const oldName = state.tasks[renameIndex];
    const renamed = `${oldName}-prime`;
    state.tasks[renameIndex] = renamed;
    operations.push(`Rename ${oldName} to ${renamed}, keeping the same position.`);
  }

  if (epoch % 5 === 0 && state.tasks.length > 6) {
    const removeIndex = (epoch * 2) % (state.tasks.length - 1);
    const removed = state.tasks.splice(removeIndex, 1)[0];
    operations.push(`Remove ${removed} from the active order.`);
  }

  let question: string;
  let answer: string;
  if (epoch % 3 === 0) {
    const position = ((epoch * 7) % state.tasks.length) + 1;
    question = `Question: what task is currently at position ${position}? Return only the task name.`;
    answer = state.tasks[position - 1];
  } else if (epoch % 3 === 1 && state.tasks.length > 1) {
    const targetIndex = (epoch * 5) % state.tasks.length;
    const target = state.tasks[targetIndex];
    const before = targetIndex === 0 ? "none" : state.tasks[targetIndex - 1];
    const after = targetIndex === state.tasks.length - 1 ? "none" : state.tasks[targetIndex + 1];
    question = `Question: for active task ${target}, return previous|next using none at boundaries.`;
    answer = `${before}|${after}`;
  } else {
    const lastThree = state.tasks.slice(-3).join(",");
    question = "Question: return the last three active tasks in order, comma-separated with no spaces.";
    answer = lastThree;
  }

  add(
    "order-tracking",
    [
      `Prompt six epoch ${epoch}. ${operations.join(" ")}`,
      `Historical removed names may appear in previous messages but must not count as active. Noise only: ${decoys(epoch, 4)}.`,
      question
    ].join(" "),
    answer
  );
}

function addCrossReferenceCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const anchor = state.anchors[(epoch * 13) % Math.min(12, state.anchors.length)];
  const ledgers = [...state.ledgers.values()];
  const ledger = ledgers[(epoch * 7) % ledgers.length];
  const activeSum = [...state.activeVaults.values()].reduce((sum, value) => sum + value, 0);
  const taskPosition = ((epoch * 11) % state.tasks.length) + 1;
  const task = state.tasks[taskPosition - 1];
  const computed = anchor.number + ledger.budget + activeSum - taskPosition;
  add(
    "cross-reference",
    [
      `Prompt six epoch ${epoch}. Cross-reference challenge: combine old anchor ${anchor.key}, current ledger ${ledger.name}, active vault state, and active task order.`,
      `Use anchor number + current ledger budget + active vault sum − task position ${taskPosition}.`,
      `Ignore stale ledger versions and revoked vaults. Noise only: ${decoys(epoch, 5)}.`,
      `Question: return anchorKey|ledgerOwner|computedValue|taskAtPosition${taskPosition}. No prose.`
    ].join(" "),
    `${anchor.key}|${ledger.owner}|${computed}|${task}`
  );
}

function decoys(epoch: number, salt: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const label = `${anchorNames[(epoch + salt + i * 3) % anchorNames.length]}_decoy_${salt}_${i}`;
    const value = 50 + ((epoch * (salt + 11) + i * 17) % 900);
    parts.push(`${label}=${value}`);
  }
  return parts.join("; ");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function assertPromptSixData(cases: PromptSixCase[]): void {
  if (cases.length !== 200) throw new Error(`Prompt six expected 200 cases, got ${cases.length}`);

  const prompts = new Set<string>();
  for (const [index, item] of cases.entries()) {
    if (!item.prompt.trim()) throw new Error(`Prompt six case ${index + 1} has an empty prompt`);
    if (!item.expect.trim()) throw new Error(`Prompt six case ${index + 1} has an empty gold answer`);
    if (item.categories.length !== 1) throw new Error(`Prompt six case ${index + 1} must have exactly one primary category`);
    if (prompts.has(item.prompt)) throw new Error(`Prompt six duplicate prompt at case ${index + 1}: ${item.prompt}`);
    prompts.add(item.prompt);
  }

  for (const category of promptSixCategoryOrder) {
    const actual = cases.filter((item) => item.categories.includes(category)).length;
    const expected = promptSixCategoryCounts[category];
    if (actual !== expected) throw new Error(`Prompt six expected ${expected} ${category} cases, got ${actual}`);
  }
}
