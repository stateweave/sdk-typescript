export type FocusCandidate = { id: string; kind: string; text: string; sequence: number };
export type FocusHierarchy = {
  topics: FocusCandidate[];
  children: (topicIds: string[]) => FocusCandidate[];
  atoms: (leafIds: string[]) => FocusCandidate[];
};
