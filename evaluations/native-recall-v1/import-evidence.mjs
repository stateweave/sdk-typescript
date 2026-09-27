export function importEvidence(CausalWeave, sources) {
  const weave = new CausalWeave();
  const root = weave.append({ kind: 'system', payload: 'Historical source evidence. Original conversation dates appear in the source text.', advance: false });
  const counts = new Map();
  for (const source of sources) counts.set(source.id, (counts.get(source.id) ?? 0) + 1);
  const mapping = {}, sourceRecords = [];
  sources.forEach((source, ordinal) => {
    const resourceKey = 'conversation:' + source.id + (counts.get(source.id) > 1 ? ':occurrence:' + ordinal : '');
    const node = weave.append({ kind: 'resource', resourceKey, payload: source.text, parents: [root.id], advance: false });
    mapping[source.id] = node.id;
    sourceRecords.push({ ordinal, sourceId: source.id, nodeId: node.id, resourceKey });
  });
  return { state: weave.snapshot(), mapping, sourceRecords };
}
