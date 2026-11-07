export const LEDGER_PROTOCOL = 'Track events in order. Aliases resolve transitively. get returns field; sum totals quota; ownerSum totals quota for id\'s owner; join lists sorted ids sharing id\'s owner; latest returns field of last record event (not alias). Filters default unrestricted. Reply only {"answer":value}.\n';
const fields = ["owner", "quota", "active"];
const resolve = (state, id) => {
  const seen = new Set();
  while (state.aliases.has(id)) {
    if (seen.has(id)) throw new Error("Alias cycle");
    seen.add(id);
    id = state.aliases.get(id);
  }
  return id;
};

// State: {records: Map<id, {owner, quota, active, order}>, aliases: Map<alias, id>, clock}.
export function reduceEvents(state = { records: new Map(), aliases: new Map(), clock: 0 }, events = []) {
  const next = { records: new Map(state.records), aliases: new Map(state.aliases), clock: state.clock };
  for (const event of events) {
    if (event.op === "alias") {
      if (next.records.has(event.alias)) throw new Error("Alias shadows record");
      next.aliases.set(event.alias, event.id);
      const target = resolve(next, event.alias);
      if (!next.records.has(target)) throw new Error("Unknown alias target");
      continue;
    }
    const id = resolve(next, event.id);
    const previous = next.records.get(id);
    if (event.op !== "assign" && !previous) throw new Error("Unknown record");
    let record;
    if (event.op === "assign") record = { ...event.values };
    else if (event.op === "correct") record = { ...previous, ...event.values };
    else if (event.op === "revoke" || event.op === "reactivate") {
      record = { ...previous, active: event.op === "reactivate" };
    } else throw new Error("Unknown event");
    if (typeof record.owner !== "string" || !Number.isFinite(record.quota) || typeof record.active !== "boolean") {
      throw new Error("Invalid record");
    }
    next.records.set(id, { owner: record.owner, quota: record.quota, active: record.active, order: ++next.clock });
  }
  return next;
}

export function queryLedger(state, query) {
  const anchor = state.records.get(resolve(state, query.id));
  if (query.op === "get") {
    if (!fields.includes(query.field)) throw new Error("Unknown field");
    return anchor?.[query.field] ?? null;
  }
  if (!["sum", "ownerSum", "join", "latest"].includes(query.op)) throw new Error("Unknown query");
  if (["ownerSum", "join"].includes(query.op) && !anchor) return query.op === "join" ? [] : null;
  const owner = ["ownerSum", "join"].includes(query.op) ? anchor.owner : query.owner;
  const rows = [...state.records].filter(([, record]) =>
    (owner === undefined || record.owner === owner) && (query.active === undefined || record.active === query.active));
  if (query.op === "sum" || query.op === "ownerSum") return rows.reduce((sum, [, record]) => sum + record.quota, 0);
  if (query.op === "join") return rows.map(([id]) => id).sort();
  if (query.field !== "id" && !fields.includes(query.field)) throw new Error("Unknown field");
  const latest = rows.sort((a, b) => b[1].order - a[1].order)[0];
  return latest ? (query.field === "id" ? latest[0] : latest[1][query.field]) : null;
}

export function createEpisode(seed) {
  if (!Number.isSafeInteger(seed)) throw new Error("Seed must be a safe integer");
  let randomState = 2166136261;
  for (const char of String(seed)) randomState = Math.imul(randomState ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = (limit) => {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let value = Math.imul(randomState ^ (randomState >>> 15), randomState | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) % limit;
  };
  const namespace = (BigInt(seed) ^ 0x9e3779b97f4a7c15n).toString(36).replace("-", "n");
  const ids = Array.from({ length: 8 }, (_, i) => `e${namespace}_${i}`);
  const owners = Array.from({ length: 3 }, (_, i) => `o${namespace}_${i}`);
  const aliases = [`a${namespace}_0`, `a${namespace}_1`];
  let state = reduceEvents(), revoked;
  const turns = [];
  for (let index = 0; index < 60; index++) {
    const id = ids[random(8)], quota = random(901) + 10;
    let events = [], query, category;
    if (index < 8) {
      events = [{ op: "assign", id: ids[index], values: { owner: owners[random(3)], quota, active: true } }];
      query = { op: "get", id: ids[index], field: fields[index % 3] };
      category = "assignment";
    } else {
      const phase = (index - 8) % 13;
      if (phase === 0) {
        events = [{ op: "assign", id, values: { owner: owners[random(3)], quota, active: Boolean(random(2)) } }];
        query = { op: "sum" }; category = "sum";
      } else if (phase === 1 || phase === 2 || phase === 6 || phase === 11) {
        const target = phase === 6 ? aliases[1] : id;
        const values = phase === 2 ? { owner: owners[random(3)] } : { quota };
        events = [{ op: "correct", id: target, values }];
        if (phase === 11) events.push({ op: "correct", id, values: { quota: quota + 7 } });
        query = { op: "get", id: target, field: phase === 2 ? "owner" : "quota" };
        category = phase === 6 ? "alias-correction" : "correction";
      } else if (phase === 3 || phase === 4) {
        if (phase === 3) revoked = id;
        events = [{ op: phase === 3 ? "revoke" : "reactivate", id: revoked }];
        query = { op: "get", id: revoked, field: "active" }; category = phase === 3 ? "revocation" : "reactivation";
      } else if (phase === 5) {
        events = [{ op: "alias", alias: aliases[0], id }, { op: "alias", alias: aliases[1], id: aliases[0] }];
        query = { op: "get", id: aliases[1], field: "quota" }; category = "alias-chain";
      } else if (phase === 7) {
        query = { op: "sum", active: true, owner: owners[random(3)] }; category = "filtered-sum";
      } else if (phase === 8 || phase === 9) {
        query = { op: phase === 8 ? "ownerSum" : "join", id: aliases[1], active: true };
        category = phase === 8 ? "owner-aggregate" : "owner-join";
      } else {
        if (phase === 12) events = [{ op: "alias", alias: aliases[0], id }];
        query = phase === 10 ? { op: "latest", owner: owners[random(3)], field: "id" } : { op: "latest", active: true, field: "quota" };
        category = "latest";
      }
    }
    state = reduceEvents(state, events);
    const input = `${index === 0 ? LEDGER_PROTOCOL : ""}Events: ${JSON.stringify(events)}\nQuery: ${JSON.stringify(query)}`;
    turns.push({ turn: index + 1, input, expected: queryLedger(state, query), category });
  }
  return { seed, turns };
}

export function scoreAnswer(text, expected) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { correct: false, parseError: true, parsed: null }; }
  const scalar = (value) => value === null || ["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value));
  const valid = (value) => scalar(value) || (Array.isArray(value) && value.every(scalar));
  const normalize = (value) => Array.isArray(value) ? value.map((item) => JSON.stringify(item)).sort() : value;
  const schema = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && Object.hasOwn(parsed, "answer");
  const correct = schema && valid(parsed.answer) && valid(expected) && JSON.stringify(normalize(parsed.answer)) === JSON.stringify(normalize(expected));
  return { correct: Boolean(correct), parseError: false, parsed };
}
