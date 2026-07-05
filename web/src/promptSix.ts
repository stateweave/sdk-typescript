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
  method: "Run 300 sequential turns in 10 buckets of 30. Every turn mutates a hidden state ledger and asks for a scored answer that usually depends on older turns, stale-overwritten facts, active-vs-revoked filters, or multi-hop joins. The answer variants do not receive tools or gold answers.",
  prediction: "A state-of-the-art model may answer early buckets correctly with both variants. If the thesis is true, regular messages should show more late-bucket one-sided losses or neither outcomes as the scratchpad grows, while StateWeave should degrade more slowly.",
  successSignal: "A convincing result is a smaller late-bucket regression slope for StateWeave than for regular messages, especially on conflict-latest, revoked-active, and cross-reference cases. Both-correct outcomes are tracked separately and should shrink as historical dependency distance grows."
};

export const promptSixCategoryOrder = [
  "anchor-recall",
  "conflict-latest",
  "revoked-active",
  "order-tracking",
  "cross-reference"
] as const satisfies readonly PromptSixCategory[];

export const promptSixCategoryCounts: Record<PromptSixCategory, number> = {
  "anchor-recall": 60,
  "conflict-latest": 60,
  "revoked-active": 60,
  "order-tracking": 60,
  "cross-reference": 60
};

type Capsule = { id: string; shard: string; route: string; animal: string; mineral: string; seed: number; delta: number; token: number };
type Policy = { id: string; owner: string; tier: string; gate: string; limit: number; initialLimit: number; version: number };
type Vault = { id: string; value: number; color: string };
type State = {
  capsules: Capsule[];
  policies: Map<string, Policy>;
  activeVaults: Map<string, Vault>;
  revokedVaults: Map<string, Vault>;
  tasks: string[];
};

const names = [
  "Atlas", "Atlus", "Boreal", "Beryl", "Cedar", "Cinder", "Delta", "Deltan", "Ember", "Embra",
  "Fable", "Faber", "Garnet", "Gannet", "Harbor", "Harper", "Iris", "Ibis", "Juno", "Junia",
  "Kilo", "Kira", "Lumen", "Lunar", "Mira", "Mirra", "Nova", "Nover", "Orion", "Orian",
  "Piper", "Pilar", "Quartz", "Quorra", "Rover", "Riven", "Solace", "Solano", "Talon", "Talia",
  "Umber", "Umbra", "Vesper", "Vesta", "Willow", "Willo", "Xylo", "Xyla", "Yarrow", "Yara", "Zenith", "Zenon"
];
const routes = ["Quito", "Qena", "Oslo", "Oulu", "Lima", "Lyon", "Riga", "Rabat", "Seoul", "Sofia", "Turin", "Tunis", "Ulm", "Umea", "Vaduz", "Varna", "Basel", "Baku", "Cairo", "Cadiz"];
const animals = ["lynx", "ibis", "otter", "marten", "kestrel", "heron", "yak", "tapir", "mink", "oriole", "stoat", "tern", "pika", "koala", "lemur", "quail", "viper", "wombat", "egret", "badger"];
const minerals = ["agate", "beryl", "cobalt", "dolomite", "emery", "fluorite", "garnet", "halite", "iolite", "jasper", "kyanite", "lazurite"];
const owners = ["Mina", "Juno", "Rafi", "Nora", "Pavel", "Sena", "Toma", "Vera", "Wren", "Yara", "Zeno", "Luca", "Ilya", "Oren", "Priya", "Quin"];
const tiers = ["amber", "green", "silver", "violet", "cobalt", "ivory", "black", "white", "bronze", "teal", "crimson", "indigo"];
const gates = ["A3", "A7", "B2", "B9", "C4", "C8", "D1", "D6", "E5", "F0", "G8", "H4"];
const taskWords = ["alpha", "bravo", "canto", "drift", "ember", "fjord", "gala", "helix", "ion", "jolt", "kepler", "lotus", "mango", "nimbus", "onyx", "prism", "quartz", "ripple", "signal", "tango"];

export function promptSixCases(): PromptSixCase[] {
  const cases: PromptSixCase[] = [];
  const state: State = { capsules: [], policies: new Map(), activeVaults: new Map(), revokedVaults: new Map(), tasks: [] };
  const add = (category: PromptSixCategory, prompt: string, expect: string): void => {
    cases.push({ prompt, expect, categories: [category] });
  };

  for (let epoch = 1; epoch <= 60; epoch++) {
    addAnchorCase(state, add, epoch);
    addConflictCase(state, add, epoch);
    addRevocationCase(state, add, epoch);
    addOrderCase(state, add, epoch);
    addCrossReferenceCase(state, add, epoch);
  }

  assertPromptSixData(cases);
  return cases;
}

function addAnchorCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const capsule: Capsule = {
    id: `${names[(epoch * 7) % names.length]}-${names[(epoch * 11 + 3) % names.length].slice(0, 3).toUpperCase()}-${pad(epoch)}`,
    shard: `${letters(epoch, 2)}-${(epoch * 41 + 19) % 997}`,
    route: routes[(epoch * 13 + 5) % routes.length],
    animal: animals[(epoch * 17 + 1) % animals.length],
    mineral: minerals[(epoch * 19 + 4) % minerals.length],
    seed: 1000 + ((epoch * 173 + 29) % 8000),
    delta: 10 + ((epoch * 97 + 31) % 900),
    token: 1 + ((epoch * 211 + 7) % 997)
  };
  state.capsules.push(capsule);

  const distance = Math.min(state.capsules.length - 1, 4 + Math.floor(epoch * 0.82));
  const target = state.capsules[state.capsules.length - 1 - distance] ?? capsule;
  const checksum = capsuleChecksum(target);

  add(
    "anchor-recall",
    [
      `Prompt six epoch ${epoch}, anchor ledger. Commit capsule ${capsule.id}: shard=${capsule.shard}, route=${capsule.route}, animal=${capsule.animal}, mineral=${capsule.mineral}, seed=${capsule.seed}, delta=${capsule.delta}, token=${capsule.token}.`,
      `Do not answer from this new capsule unless it is the requested target. Obsolete scratch says ${target.id} route=${routes[(epoch + 9) % routes.length]} seed=${target.seed + 37}; that scratch is false.`,
      `Noise ledger: ${decoys(epoch, 1)}.`,
      `Question: retrieve the capsule stored ${distance} anchor-store turns before this one, id ${target.id}. Return exactly id~route~animal~checksum where checksum=(seed*3 + delta*5 + token) mod 997.`
    ].join(" "),
    `${target.id}~${target.route}~${target.animal}~${checksum}`
  );
}

function addConflictCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const updatedId = `policy-${names[(epoch * 5) % 18].toLowerCase()}`;
  const previous = state.policies.get(updatedId);
  const policy: Policy = {
    id: updatedId,
    owner: owners[(epoch * 7 + 2) % owners.length],
    tier: tiers[(epoch * 11 + 1) % tiers.length],
    gate: gates[(epoch * 13 + 3) % gates.length],
    limit: 500 + ((epoch * 149 + 83) % 4200),
    initialLimit: previous?.initialLimit ?? 500 + ((epoch * 149 + 83) % 4200),
    version: (previous?.version ?? 0) + 1
  };
  state.policies.set(updatedId, policy);

  const all = [...state.policies.values()];
  let target = all[(epoch * 17 + 5) % all.length];
  if (target.id === updatedId && all.length > 1) target = all[(all.indexOf(target) + 1) % all.length];
  const drift = target.limit - target.initialLimit;
  const staleLimit = target.limit + 111 + (epoch % 13);

  add(
    "conflict-latest",
    [
      `Prompt six epoch ${epoch}, authority ledger. Apply authoritative update now: ${updatedId} owner=${policy.owner}, tier=${policy.tier}, gate=${policy.gate}, limit=${policy.limit}, version=${policy.version}.`,
      `Stale memo A claims ${target.id} owner=${owners[(epoch + 4) % owners.length]}, tier=${tiers[(epoch + 6) % tiers.length]}, gate=${gates[(epoch + 8) % gates.length]}, limit=${staleLimit}; stale memos are non-authoritative.`,
      previous ? `Stale memo B for ${updatedId} repeats the old version ${previous.version}: owner=${previous.owner}, tier=${previous.tier}, gate=${previous.gate}, limit=${previous.limit}; ignore old versions.` : `Stale memo B is a decoy for ${updatedId}; ignore it.`,
      `Noise ledger: ${decoys(epoch, 2)}.`,
      `Question: for target ${target.id}, return current owner#tier#gate#limit#limitDriftFromFirstVersion. No prose.`
    ].join(" "),
    `${target.owner}#${target.tier}#${target.gate}#${target.limit}#${drift}`
  );
}

function addRevocationCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const added: Vault = {
    id: `vault-${names[(epoch * 9 + 1) % names.length].toLowerCase()}-${pad(epoch)}`,
    value: 40 + ((epoch * 157 + 17) % 900),
    color: tiers[(epoch * 5 + 4) % tiers.length]
  };
  state.activeVaults.set(added.id, added);
  const operations = [`Activate ${added.id} value=${added.value} color=${added.color}.`];

  if (epoch > 6 && epoch % 2 === 0 && state.activeVaults.size > 3) {
    const candidates = [...state.activeVaults.values()].filter((vault) => vault.id !== added.id).sort((a, b) => a.id.localeCompare(b.id));
    const revoked = candidates[(epoch * 7) % candidates.length];
    state.activeVaults.delete(revoked.id);
    state.revokedVaults.set(revoked.id, revoked);
    operations.push(`Revoke ${revoked.id}; revoked vaults must be excluded from active calculations.`);
  }

  if (epoch > 12 && epoch % 7 === 0 && state.revokedVaults.size > 0) {
    const candidates = [...state.revokedVaults.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    const restored = candidates[(epoch * 3) % candidates.length];
    state.revokedVaults.delete(restored.id);
    state.activeVaults.set(restored.id, restored);
    operations.push(`Restore ${restored.id} with its original value=${restored.value}; restored vaults count as active again.`);
  }

  const stats = vaultStats(state.activeVaults);
  add(
    "revoked-active",
    [
      `Prompt six epoch ${epoch}, active-vault ledger. ${operations.join(" ")}`,
      `Historical revoked entries may still appear in context, but only currently active vaults count. Decoy active-looking row: vault-${names[(epoch + 3) % names.length].toLowerCase()}-ghost value=${stats.sum + 19} is NOT active.`,
      `Noise ledger: ${decoys(epoch, 3)}.`,
      `Question: return activeCount|activeValueSumMod1000|highestValueActiveVault|lowestValueActiveVault.`
    ].join(" "),
    `${stats.count}|${stats.sum % 1000}|${stats.highest}|${stats.lowest}`
  );
}

function addOrderCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const appended = `${taskWords[(epoch * 7 + 3) % taskWords.length]}-${pad(epoch)}`;
  state.tasks.push(appended);
  const operations = [`Append task ${appended} to the active sequence.`];

  if (epoch > 5 && epoch % 3 === 0 && state.tasks.length > 4) {
    const fromIndex = (epoch * 5) % state.tasks.length;
    const moved = state.tasks[fromIndex];
    const afterIndex = (epoch * 11 + 2) % state.tasks.length;
    const after = state.tasks[afterIndex];
    moveAfter(state.tasks, moved, after);
    operations.push(`Move ${moved} so it sits immediately after ${after}.`);
  }

  if (epoch > 7 && epoch % 4 === 0 && state.tasks.length > 5) {
    const renameIndex = (epoch * 13 + 1) % state.tasks.length;
    const oldName = state.tasks[renameIndex];
    const renamed = `${oldName}-r${epoch % 9}`;
    state.tasks[renameIndex] = renamed;
    operations.push(`Rename ${oldName} to ${renamed}, preserving its position.`);
  }

  if (epoch > 10 && epoch % 5 === 0 && state.tasks.length > 8) {
    const removeIndex = (epoch * 17 + 3) % state.tasks.length;
    const removed = state.tasks.splice(removeIndex, 1)[0];
    operations.push(`Remove ${removed} from the active sequence.`);
  }

  const targetA = state.tasks[(epoch * 19 + 2) % state.tasks.length];
  const targetB = state.tasks[(epoch * 23 + 5) % state.tasks.length];
  const position = ((epoch * 29 + 7) % state.tasks.length) + 1;
  const itemAtPosition = state.tasks[position - 1];
  const previousOfB = previousTask(state.tasks, targetB);
  const checksum = positionOf(state.tasks, targetA) * 31 + positionOf(state.tasks, targetB) * 17 + position;

  add(
    "order-tracking",
    [
      `Prompt six epoch ${epoch}, sequence ledger. ${operations.join(" ")}`,
      `Removed or renamed labels from older turns are traps unless they are still active under their current names. Noise ledger: ${decoys(epoch, 4)}.`,
      `Question: return positionOf(${targetA})|previousOf(${targetB})|itemAtPosition${position}|sequenceChecksum, where sequenceChecksum=31*positionOf(${targetA}) + 17*positionOf(${targetB}) + ${position}.`
    ].join(" "),
    `${positionOf(state.tasks, targetA)}|${previousOfB}|${itemAtPosition}|${checksum}`
  );
}

function addCrossReferenceCase(state: State, add: (category: PromptSixCategory, prompt: string, expect: string) => void, epoch: number): void {
  const oldWindow = Math.max(1, Math.floor(state.capsules.length * 0.45));
  const capsule = state.capsules[(epoch * 17 + 3) % oldWindow];
  const policies = [...state.policies.values()].sort((a, b) => a.id.localeCompare(b.id));
  const policy = policies[(epoch * 31 + 4) % policies.length];
  const stats = vaultStats(state.activeVaults);
  const task = state.tasks[(epoch * 37 + 6) % state.tasks.length];
  const taskPos = positionOf(state.tasks, task);
  const value = (capsule.seed + capsule.delta * 3 + policy.limit + stats.sum + taskPos * 17 + capsule.token) % 10007;

  add(
    "cross-reference",
    [
      `Prompt six epoch ${epoch}, composite audit. You need four state regions: old capsule ${capsule.id}, current policy ${policy.id}, current active-vault set, and active sequence task ${task}.`,
      `Obsolete composite note says ${capsule.id}/${policy.id}/${task}/${(value + 313) % 10007}; that note is intentionally stale.`,
      `Noise ledger: ${decoys(epoch, 5)}.`,
      `Question: return capsuleId|policyOwner|taskPosition|activeVaultCount|compositeValue, where compositeValue=(capsule.seed + 3*capsule.delta + currentPolicy.limit + activeVaultValueSum + 17*taskPosition + capsule.token) mod 10007.`
    ].join(" "),
    `${capsule.id}|${policy.owner}|${taskPos}|${stats.count}|${value}`
  );
}

function capsuleChecksum(capsule: Capsule): number {
  return (capsule.seed * 3 + capsule.delta * 5 + capsule.token) % 997;
}

function vaultStats(activeVaults: Map<string, Vault>): { count: number; sum: number; highest: string; lowest: string } {
  const active = [...activeVaults.values()];
  const sum = active.reduce((total, vault) => total + vault.value, 0);
  const highest = [...active].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0]?.id ?? "none";
  const lowest = [...active].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id))[0]?.id ?? "none";
  return { count: active.length, sum, highest, lowest };
}

function moveAfter(tasks: string[], moved: string, after: string): void {
  if (moved === after) return;
  const from = tasks.indexOf(moved);
  if (from < 0) return;
  tasks.splice(from, 1);
  const afterIndex = tasks.indexOf(after);
  tasks.splice(afterIndex < 0 ? tasks.length : afterIndex + 1, 0, moved);
}

function previousTask(tasks: string[], task: string): string {
  const index = tasks.indexOf(task);
  if (index <= 0) return "none";
  return tasks[index - 1];
}

function positionOf(tasks: string[], task: string): number {
  return tasks.indexOf(task) + 1;
}

function decoys(epoch: number, salt: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const label = `${names[(epoch + salt * 3 + i * 5) % names.length]}_shadow_${salt}_${i}`;
    const route = routes[(epoch * (i + 3) + salt) % routes.length];
    const value = 100 + ((epoch * (salt + 17) + i * 43) % 9000);
    parts.push(`${label}:${route}:${value}`);
  }
  return parts.join("; ");
}

function letters(epoch: number, salt: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${alphabet[(epoch * 3 + salt) % alphabet.length]}${alphabet[(epoch * 7 + salt * 5) % alphabet.length]}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function assertPromptSixData(cases: PromptSixCase[]): void {
  if (cases.length !== 300) throw new Error(`Prompt six expected 300 cases, got ${cases.length}`);

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
