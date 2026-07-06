// Minimal, safe-by-construction Markdown renderer for chat messages.
// Every text fragment is HTML-escaped before any markdown transform runs,
// so user/model output can never inject markup. Only a known-safe tag set
// is produced, and link hrefs are restricted to http(s)/mailto/relative URLs.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CODE_PLACEHOLDER = (index: number) => `\u0000\u0000CODE${index}\u0000\u0000`;
const BLOCK_PLACEHOLDER = (index: number) => `\u0001BLOCK${index}\u0001`;
const BLOCK_TOKEN = /^\u0001BLOCK(\d+)\u0001$/;

function sanitizeHref(href: string): string | undefined {
  const trimmed = href.trim().replace(/\s+/g, "");
  if (!trimmed) return undefined;
  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return undefined;
}

function renderInline(raw: string): string {
  const codeSpans: string[] = [];
  const withoutCode = raw.replace(/`([^`]+)`/g, (_match, code) => {
    const index = codeSpans.length;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return CODE_PLACEHOLDER(index);
  });

  let text = escapeHtml(withoutCode);

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, rawHref) => {
    const href = sanitizeHref(rawHref);
    return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : match;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/(^|\s)_([^_]+)_(?=$|\s|[.,;:!?)])/g, "$1<em>$2</em>");

  text = text.replace(/\n/g, "<br />");
  return text.replace(/\u0000\u0000CODE(\d+)\u0000\u0000/g, (_match, index) => codeSpans[Number(index)] ?? "");
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

function parseBlocks(text: string, codeBlocks: string[]): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const codeToken = line.match(BLOCK_TOKEN);
    if (codeToken) {
      out.push(codeBlocks[Number(codeToken[1])] ?? "");
      i += 1;
      continue;
    }

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[-*\s]*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buffer.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${parseBlocks(buffer.join("\n"), codeBlocks)}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const buffer: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !BLOCK_TOKEN.test(lines[i]) &&
      !/^(#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i])
    ) {
      buffer.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${renderInline(buffer.join("\n"))}</p>`);
  }

  return out.join("\n");
}

export function renderMarkdown(input: string): string {
  if (!input || !input.trim()) return "";
  const text = input.replace(/\r\n?/g, "\n");

  const codeBlocks: string[] = [];
  const body = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    const langAttr = lang.trim() ? ` class="language-${escapeHtml(lang.trim())}"` : "";
    codeBlocks.push(`<pre><code${langAttr}>${escapeHtml(String(code).replace(/\n$/, ""))}</code></pre>`);
    return BLOCK_PLACEHOLDER(index);
  });

  return parseBlocks(body, codeBlocks);
}
