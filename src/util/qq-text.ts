function normalizeInlineCode(text: string): string {
  return text.replace(/`([^`\n]+)`/g, "「$1」");
}

function normalizeLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2");
}

function normalizeEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

function normalizeHeadings(text: string): string {
  return text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, title: string) => {
    const level = hashes.length;
    return `${"=".repeat(Math.max(1, 4 - Math.min(level, 3)))} ${title.trim()}`;
  });
}

function normalizeLists(text: string): string {
  return text
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*(\d+)\.\s+/gm, "$1. ");
}

function normalizeBlockquotes(text: string): string {
  return text.replace(/^\s*>\s?/gm, "引用: ");
}

function normalizeTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.includes("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      const isSeparator = cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
      if (cells.length >= 2 && !isSeparator) {
        out.push(cells.join(" | "));
        inTable = true;
        continue;
      }
    }
    if (inTable && !line.trim()) inTable = false;
    if (!inTable || !line.includes("|")) out.push(line);
  }
  return out.join("\n");
}

function normalizeCodeBlocks(text: string): string {
  return text.replace(/```([\w-]+)?\n?([\s\S]*?)```/g, (_m, lang: string | undefined, code: string) => {
    const label = lang?.trim() ? `代码(${lang.trim()}):` : "代码:";
    const body = code
      .trimEnd()
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    return `${label}\n${body}`;
  });
}

export function normalizeMarkdownForQQ(text: string): string {
  if (!text.trim()) return text;

  let next = text.replace(/\r\n/g, "\n");
  next = normalizeCodeBlocks(next);
  next = normalizeLinks(next);
  next = normalizeInlineCode(next);
  next = normalizeHeadings(next);
  next = normalizeLists(next);
  next = normalizeBlockquotes(next);
  next = normalizeTables(next);
  next = normalizeEmphasis(next);
  next = next.replace(/\n{3,}/g, "\n\n");
  return next.trim();
}
