import type { StickerSemantics } from "./sticker-store.js";

/** FTS / 全文拼接用，与启发式 haystack 字段一致（不含 avoidWhen）。 */
export function buildStickerSearchCorpus(semantics: StickerSemantics): string {
  return [
    semantics.title,
    semantics.meaning,
    ...semantics.aliases,
    ...semantics.intentTags,
    ...semantics.emotionTags,
    ...semantics.useWhen,
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(" ");
}

/** 与 JSON / SQLite 后端共用的检索打分；字段权重：title/alias > useWhen/tags > meaning。 */
export function tokenizeSearchQuery(raw: string): string[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const spaceTokens = q.split(/\s+/).filter(Boolean);
  const out = new Set<string>(spaceTokens);
  const hasSpace = /\s/.test(q);
  if (!hasSpace && q.length >= 4) {
    const maxBigrams = Math.min(24, Math.max(0, q.length - 1));
    for (let i = 0; i < maxBigrams; i++) {
      out.add(q.slice(i, i + 2));
    }
  }
  if (!hasSpace && q.length >= 5) {
    const maxTri = Math.min(16, Math.max(0, q.length - 2));
    for (let i = 0; i < maxTri; i++) {
      out.add(q.slice(i, i + 3));
    }
  }
  return [...out];
}

function joinLower(parts: string[]): string {
  return parts.map((s) => s.toLowerCase()).join(" ");
}

/**
 * 单条表情的启发式分数；不含 FTS/BM25。
 * avoidWhen：仅当某条 avoid 短语（长度≥2）出现在查询 q 中时才小幅降分，降低误伤。
 */
export function scoreStickerSemanticMatch(
  query: string,
  semantics: StickerSemantics,
  usageCount: number,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const title = semantics.title.toLowerCase();
  const meaning = semantics.meaning.toLowerCase();
  const useHay = joinLower(semantics.useWhen);
  const tagsHay = joinLower([...semantics.intentTags, ...semantics.emotionTags]);
  const aliasesLower = semantics.aliases.map((a) => a.toLowerCase());

  let score = Math.min(3, Math.log10(Math.max(0, usageCount) + 1));

  if (title.includes(q)) score += 6;
  if (aliasesLower.some((a) => a === q)) score += 7;
  else if (aliasesLower.some((a) => a.includes(q))) score += 4;
  if (useHay.includes(q)) score += 5;
  if (tagsHay.includes(q)) score += 3;
  if (meaning.includes(q)) score += 2;

  const tokens = tokenizeSearchQuery(q);
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (title.includes(tok)) score += 2;
    else if (aliasesLower.some((a) => a.includes(tok))) score += 1.5;
    else if (useHay.includes(tok)) score += 1.5;
    else if (tagsHay.includes(tok)) score += 1;
    else if (meaning.includes(tok)) score += 0.5;
  }

  for (const avoid of semantics.avoidWhen) {
    const a = avoid.trim().toLowerCase();
    if (a.length >= 2 && q.includes(a)) score -= 1.5;
  }

  return score;
}

export function usageBoostScore(usageCount: number): number {
  return Math.min(3, Math.log10(Math.max(0, usageCount) + 1));
}

/** 非空 query 的排序列表；空 query 请由调用方走 listRecent。 */
export function rankStickerRecordsByQuery<T extends { semantics: StickerSemantics; usageCount: number }>(
  query: string,
  records: T[],
  topK: number,
): Array<{ record: T; score: number }> {
  const q = query.trim().toLowerCase();
  const k = Math.max(1, Math.min(20, topK));
  if (!q) return [];

  return records
    .map((r) => ({
      record: r,
      score: scoreStickerSemanticMatch(q, r.semantics, r.usageCount),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
