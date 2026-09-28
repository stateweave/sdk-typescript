export function splitsSurrogatePair(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

export function utf16Prefix(text: string, limit: number): string {
  const end = Math.min(text.length, Math.max(0, limit));
  return text.slice(0, splitsSurrogatePair(text, end) ? end - 1 : end);
}

export function isWellFormedUnicode(text: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(text);
}
