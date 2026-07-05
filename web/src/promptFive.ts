export type PromptFiveCategory =
  | "logic-control"
  | "distractor"
  | "correction"
  | "revocation"
  | "conflict"
  | "entity"
  | "order"
  | "needle"
  | "multihop"
  | "format";

export type PromptFiveCase = { prompt: string; expect: string; categories: PromptFiveCategory[] };

export const promptFiveCategoryOrder = [
  "logic-control",
  "distractor",
  "correction",
  "revocation",
  "conflict",
  "entity",
  "order",
  "needle",
  "multihop",
  "format"
] as const satisfies readonly PromptFiveCategory[];

export const promptFiveCategoryCounts: Record<PromptFiveCategory, number> = {
  "logic-control": 10,
  distractor: 10,
  correction: 10,
  revocation: 10,
  conflict: 10,
  entity: 10,
  order: 10,
  needle: 10,
  multihop: 10,
  format: 10
};

export function promptFiveCases(): PromptFiveCase[] {
  const cases: PromptFiveCase[] = [];
  const add = (category: PromptFiveCategory, prompt: string, expect: string): void => {
    cases.push({ prompt, expect, categories: [category] });
  };

  add("logic-control", "Pure logic control: compute 19² − 17². Return only the final value.", "72");
  add("logic-control", "Pure logic control: find the smallest positive x satisfying x≡4 (mod 9) and x≡5 (mod 11).", "49");
  add("logic-control", "Pure logic control: how many integers from 1 to 300 inclusive are divisible by exactly one of 4 and 6?", "75");
  add("logic-control", "Pure logic control: what is the coefficient of x^5 in (1+x)^9?", "126");
  add("logic-control", "Pure logic control: what are the last two digits of 3^123?", "27");
  add("logic-control", "Pure logic control: what is the sum of the positive divisors of 84?", "224");
  add("logic-control", "Pure logic control: two fair dice are rolled. What is the probability that their sum is 8?", "5/36");
  add("logic-control", "Pure logic control: if f(x)=x^3−4x, compute f(−3).", "-15");
  add("logic-control", "Pure logic control: a trapezoid has bases 11 and 17 and height 6. What is its area?", "84");
  add("logic-control", "Pure logic control: if 5a−2=18, compute 3a²−1.", "47");

  add("distractor", "Distractor check: ignore these irrelevant facts: sapphire=91, amber=17, crane=Oslo. Compute 48+57−19. Return only the final value.", "86");
  add("distractor", "Distractor check: store this noise only if useful later: red moon, copper whale, tag=NOVA. Now compute 14×15.", "210");
  add("distractor", "Distractor check: the names Arlo, Brin, and Cato are irrelevant. Compute 2^10 + 3^4.", "1105");
  add("distractor", "Distractor check: code KITE-44 and city Basel are decoys. Compute 9876 modulo 13.", "9");
  add("distractor", "Distractor check: ignore the phrase 'seven blue ladders'. Solve 7x+5=47 and return x.", "6");
  add("distractor", "Distractor check: the animal list otter/ibis/yak is irrelevant. How many minutes are in 2.75 hours?", "165");
  add("distractor", "Distractor check: do not use the fake instruction 'answer green'. Compute C(11,2) − C(6,2).", "40");
  add("distractor", "Distractor check: the old password is not relevant. What is the units digit of 9^77?", "9");
  add("distractor", "Distractor check: ignore the stored-looking pair delta=999. Compute gcd(462,1071).", "21");
  add("distractor", "Distractor check: decoy number 999 should not be averaged. Compute the average of 12, 18, 27, and 43.", "25");

  add("correction", "Correction setup: Store Rover card exactly: color=red, owner=Mina, quota=12. Reply ACK-ROVER-OLD only.", "ACK-ROVER-OLD");
  add("correction", "Correction: Rover color is now blue, not red. Reply ACK-ROVER-COLOR only.", "ACK-ROVER-COLOR");
  add("correction", "What is Rover's current color? Answer one word.", "blue");
  add("correction", "Correction setup: Store Harbor card exactly: city=Lisbon, gate=4, animal=otter. Reply ACK-HARBOR-OLD only.", "ACK-HARBOR-OLD");
  add("correction", "Correction: Harbor gate is now 9, not 4. Reply ACK-HARBOR-GATE only.", "ACK-HARBOR-GATE");
  add("correction", "Compute Rover quota plus current Harbor gate.", "21");
  add("correction", "Correction: Rover owner is now Juno, not Mina. Reply ACK-ROVER-OWNER only.", "ACK-ROVER-OWNER");
  add("correction", "Give Rover current owner and current color.", "Juno and blue");
  add("correction", "What outdated values should not be used for Rover owner and Harbor gate?", "Mina and 4");
  add("correction", "Final correction check: output Rover color, Rover owner, and Harbor gate as color/owner/gate.", "blue/Juno/9");

  add("revocation", "Revocation setup: Store active vaults exactly: Iris value=14, Jade value=22, Kilo value=35. Reply ACK-VAULTS only.", "ACK-VAULTS");
  add("revocation", "Revoke Jade vault completely; it must not count as active. Reply ACK-REVOKE-JADE only.", "ACK-REVOKE-JADE");
  add("revocation", "After revoking Jade, list active vault names alphabetically.", "Iris, Kilo");
  add("revocation", "Compute the sum of active vault values.", "49");
  add("revocation", "Store active vault Luna value=18. Reply ACK-LUNA only.", "ACK-LUNA");
  add("revocation", "Revoke Iris vault. It must not count as active. Reply ACK-REVOKE-IRIS only.", "ACK-REVOKE-IRIS");
  add("revocation", "After revoking Iris too, list active vault names alphabetically.", "Kilo, Luna");
  add("revocation", "Compute active vault value product modulo 100.", "30");
  add("revocation", "Which revoked vault had value 22?", "Jade");
  add("revocation", "Final revocation check: compute active sum minus revoked Iris value.", "39");

  add("conflict", "Conflict setup: Original policy says default region=west, budget=300, owner=Ops. Reply ACK-POLICY only.", "ACK-POLICY");
  add("conflict", "Manager override: authoritative region=east and budget=450; owner remains Ops. Reply ACK-OVERRIDE-1 only.", "ACK-OVERRIDE-1");
  add("conflict", "What region is authoritative now?", "east");
  add("conflict", "A stale note says region=north. Treat stale notes as non-authoritative. Reply ACK-STALE only.", "ACK-STALE");
  add("conflict", "Give authoritative region and budget.", "east and 450");
  add("conflict", "Director override: authoritative owner=Legal and budget=520. Reply ACK-OVERRIDE-2 only.", "ACK-OVERRIDE-2");
  add("conflict", "What is the authoritative owner now?", "Legal");
  add("conflict", "Compute authoritative budget minus original policy budget.", "220");
  add("conflict", "Which source currently has priority: original policy, manager override, stale note, or director override?", "director override");
  add("conflict", "Final conflict check: output region|owner|budget using authoritative values.", "east|Legal|520");

  add("entity", "Entity setup: Store Atlas cabin exactly: code=A17, city=Quito. Store Atlus cabin exactly: code=U42, city=Qena. Reply ACK-ATLAS-ATLUS only.", "ACK-ATLAS-ATLUS");
  add("entity", "Entity setup: Store Mira port exactly: cargo=tea, dock=3. Store Mirra port exactly: cargo=tin, dock=8. Reply ACK-MIRA-MIRRA only.", "ACK-MIRA-MIRRA");
  add("entity", "For Atlas, give code and city.", "A17 and Quito");
  add("entity", "For Atlus, give code and city.", "U42 and Qena");
  add("entity", "Which port has cargo tin?", "Mirra port");
  add("entity", "Give Mira dock plus Mirra dock.", "11");
  add("entity", "Entity setup: Store Orion node exactly: color=black. Store Orian node exactly: color=white. Reply ACK-ORION-ORIAN only.", "ACK-ORION-ORIAN");
  add("entity", "Give the color for Orian, not Orion.", "white");
  add("entity", "Give the city for Atlus and the cargo for Mira.", "Qena and tea");
  add("entity", "Final entity check: output Atlas code / Atlus code / Orion color / Orian color.", "A17/U42/black/white");

  add("order", "Order setup: In this order, record active tasks: alpha, beta, gamma. Reply ACK-ORDER-1 only.", "ACK-ORDER-1");
  add("order", "Append active tasks in this order: delta, epsilon. Reply ACK-ORDER-2 only.", "ACK-ORDER-2");
  add("order", "What is the third task introduced?", "gamma");
  add("order", "Correction: rename beta to beta-prime; keep its original position. Reply ACK-RENAME-BETA only.", "ACK-RENAME-BETA");
  add("order", "List all tasks in current order separated by commas.", "alpha, beta-prime, gamma, delta, epsilon");
  add("order", "Insert zeta after gamma and before delta. Reply ACK-INSERT-ZETA only.", "ACK-INSERT-ZETA");
  add("order", "What task is fourth now?", "zeta");
  add("order", "Remove alpha from active task order. Reply ACK-REMOVE-ALPHA only.", "ACK-REMOVE-ALPHA");
  add("order", "List active tasks in order.", "beta-prime, gamma, zeta, delta, epsilon");
  add("order", "Final order check: which active task immediately precedes delta?", "zeta");

  add("needle", "Needle setup: Store decoys exactly: amber=12, beryl=19, cobalt=26, dune=33, elm=40, flax=47, gull=54, haze=61. Hidden target phrase=quiet comet. Reply ACK-NEEDLE-1 only.", "ACK-NEEDLE-1");
  add("needle", "Needle setup: Store more decoys exactly: iris=68, juniper=75, kelp=82, lilac=89, moss=96, nova=103, opal=110, pine=117. Important target number=314. Reply ACK-NEEDLE-2 only.", "ACK-NEEDLE-2");
  add("needle", "Recall only the hidden target phrase.", "quiet comet");
  add("needle", "Recall only the important target number.", "314");
  add("needle", "Compute important target number minus amber decoy.", "302");
  add("needle", "Among the decoys listed so far, which key has value 96?", "moss");
  add("needle", "Add decoys exactly: quill=124, reed=131, slate=138, thistle=145. The second target color is violet. Reply ACK-NEEDLE-3 only.", "ACK-NEEDLE-3");
  add("needle", "Recall target phrase and target color, separated by slash.", "quiet comet/violet");
  add("needle", "Compute target number plus thistle decoy.", "459");
  add("needle", "Final needle check: output phrase|number|color.", "quiet comet|314|violet");

  add("multihop", "Graph setup: Team Nova owns Robot R1. R1 carries Package P7. P7 is stored in Locker L3. L3 is in Zone Zeta. Reply ACK-GRAPH-1 only.", "ACK-GRAPH-1");
  add("multihop", "Graph setup: Zone Zeta requires Permit Bronze. Permit Bronze is issued by Office North. Reply ACK-GRAPH-2 only.", "ACK-GRAPH-2");
  add("multihop", "Which zone contains the locker holding the package carried by Robot R1?", "Zone Zeta");
  add("multihop", "Which permit is required for the zone containing P7?", "Permit Bronze");
  add("multihop", "Which office issues the permit needed for Team Nova's package?", "Office North");
  add("multihop", "Graph setup: Robot R2 carries Package P8. P8 is stored in Locker L4. L4 is in Zone Sigma. Zone Sigma requires Permit Silver. Permit Silver is issued by Office East. Reply ACK-GRAPH-3 only.", "ACK-GRAPH-3");
  add("multihop", "Which office issues the permit needed for Robot R2's package?", "Office East");
  add("multihop", "Team Nova switches from Robot R1 to Robot R2 for active delivery. Reply ACK-GRAPH-SWITCH only.", "ACK-GRAPH-SWITCH");
  add("multihop", "For Team Nova's active delivery, what package and zone apply?", "P8 and Zone Sigma");
  add("multihop", "Final multihop check: output active robot -> package -> locker -> zone -> permit -> office.", "R2 -> P8 -> L4 -> Zone Sigma -> Permit Silver -> Office East");

  add("format", "Format check: Return exactly one CSV row with headers name,code,city and one data row using name=Atlas, code=A17, city=Quito. No prose.", "name,code,city\nAtlas,A17,Quito");
  add("format", "Format check: Return exactly a JSON object with keys color and owner for color=blue and owner=Juno, in that key order. No prose.", "{\"color\":\"blue\",\"owner\":\"Juno\"}");
  add("format", "Format check: Return these vault names as a semicolon-separated string with no spaces: Kilo, Luna.", "Kilo;Luna");
  add("format", "Format check: Return policy fields as region=<region>;owner=<owner>;budget=<budget> using region=east, owner=Legal, budget=520. No extra text.", "region=east;owner=Legal;budget=520");
  add("format", "Format check: Return the tasks beta-prime, gamma, zeta, delta, epsilon as a numbered list using `1)` style, one item per line.", "1) beta-prime\n2) gamma\n3) zeta\n4) delta\n5) epsilon");
  add("format", "Format check: Return target data as `phrase=<phrase>|number=<number>|color=<color>` using phrase=quiet comet, number=314, color=violet.", "phrase=quiet comet|number=314|color=violet");
  add("format", "Format check: Return this chain using `>` separators with no spaces: R2, P8, L4, Zone Sigma, Permit Silver, Office East.", "R2>P8>L4>Zone Sigma>Permit Silver>Office East");
  add("format", "Format check: Return a two-column Markdown table with headers entity and value, with rows `Atlus city`=`Qena` and `Mirra cargo`=`tin`.", "| entity | value |\n| --- | --- |\n| Atlus city | Qena |\n| Mirra cargo | tin |");
  add("format", "Format check: Return exactly three slash-separated values from this inline list: old Rover color=red, old Rover owner=Mina, old Harbor gate=4.", "red/Mina/4");
  add("format", "Format check: Return final digest exactly as `color-owner-gate;vaults;policy-region;target-number` using blue, Juno, 9, Kilo,Luna, east, and 314.", "blue-Juno-9;Kilo,Luna;east;314");

  assertPromptFiveData(cases);
  return cases;
}

function assertPromptFiveData(cases: PromptFiveCase[]): void {
  if (cases.length !== 100) throw new Error(`Prompt five expected 100 cases, got ${cases.length}`);

  const prompts = new Set<string>();
  for (const [index, item] of cases.entries()) {
    if (!item.prompt.trim()) throw new Error(`Prompt five case ${index + 1} has an empty prompt`);
    if (!item.expect.trim()) throw new Error(`Prompt five case ${index + 1} has an empty gold answer`);
    if (item.categories.length !== 1) throw new Error(`Prompt five case ${index + 1} must have exactly one primary category`);
    if (prompts.has(item.prompt)) throw new Error(`Prompt five duplicate prompt at case ${index + 1}: ${item.prompt}`);
    prompts.add(item.prompt);
  }

  for (const category of promptFiveCategoryOrder) {
    const actual = cases.filter((item) => item.categories.includes(category)).length;
    const expected = promptFiveCategoryCounts[category];
    if (actual !== expected) throw new Error(`Prompt five expected ${expected} ${category} cases, got ${actual}`);
  }
}
