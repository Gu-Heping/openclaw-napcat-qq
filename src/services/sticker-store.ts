import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { BotConfig } from "../config.js";
import type { QQMessage } from "../napcat/types.js";
import type { PluginLogger } from "../types-compat.js";

export interface StickerSemantics {
  title: string;
  meaning: string;
  emotionTags: string[];
  intentTags: string[];
  useWhen: string[];
  avoidWhen: string[];
  aliases: string[];
  confidence: number;
}

interface SemanticHistoryItem {
  at: string;
  source: "auto" | "user-guided";
  reason: string;
  patchSummary: string;
}

export interface StickerRecord {
  id: string;
  hash: string;
  ext: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  sourceType: "image" | "mface" | "marketface";
  sourceUserId: string;
  sourceMessageId: string;
  protocolEmoji: boolean;
  semantics: StickerSemantics;
  semanticHistory: SemanticHistoryItem[];
}

interface StickerIndex {
  records: StickerRecord[];
}

function normalizeTerms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 30);
}

function ensureSemantics(raw?: Partial<StickerSemantics>): StickerSemantics {
  return {
    title: String(raw?.title ?? "未命名表情"),
    meaning: String(raw?.meaning ?? "暂无说明"),
    emotionTags: normalizeTerms(raw?.emotionTags),
    intentTags: normalizeTerms(raw?.intentTags),
    useWhen: normalizeTerms(raw?.useWhen),
    avoidWhen: normalizeTerms(raw?.avoidWhen),
    aliases: normalizeTerms(raw?.aliases),
    confidence: Number.isFinite(raw?.confidence) ? Math.max(0, Math.min(1, Number(raw?.confidence))) : 0.55,
  };
}

function summarizePatch(before: StickerSemantics, after: StickerSemantics): string {
  const changed: string[] = [];
  if (before.title !== after.title) changed.push("title");
  if (before.meaning !== after.meaning) changed.push("meaning");
  if (before.confidence !== after.confidence) changed.push("confidence");
  if (before.aliases.join("|") !== after.aliases.join("|")) changed.push("aliases");
  if (before.emotionTags.join("|") !== after.emotionTags.join("|")) changed.push("emotionTags");
  if (before.intentTags.join("|") !== after.intentTags.join("|")) changed.push("intentTags");
  if (before.useWhen.join("|") !== after.useWhen.join("|")) changed.push("useWhen");
  if (before.avoidWhen.join("|") !== after.avoidWhen.join("|")) changed.push("avoidWhen");
  return changed.length ? `changed:${changed.join(",")}` : "no-op";
}

export class StickerStore {
  private readonly rootDir: string;
  private readonly metaFile: string;
  private readonly filesDir: string;
  private readonly maxSemanticHistory: number;

  constructor(private config: BotConfig, private log: PluginLogger) {
    this.rootDir = config.paths.stickerStore;
    this.metaFile = path.join(this.rootDir, "index.json");
    this.filesDir = path.join(this.rootDir, "files");
    this.maxSemanticHistory = Math.max(5, config.stickers.maxSemanticHistory);
    fs.mkdirSync(this.filesDir, { recursive: true });
    if (!fs.existsSync(this.metaFile)) {
      this.writeIndex({ records: [] });
    }
  }

  private readIndex(): StickerIndex {
    try {
      const raw = fs.readFileSync(this.metaFile, "utf-8");
      const parsed = JSON.parse(raw) as StickerIndex;
      if (!Array.isArray(parsed.records)) return { records: [] };
      return parsed;
    } catch {
      return { records: [] };
    }
  }

  private writeIndex(index: StickerIndex): void {
    const tmp = `${this.metaFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
    fs.renameSync(tmp, this.metaFile);
  }

  private scoreCandidate(msg: QQMessage, mediaPath: string): { collect: boolean; reason: string } {
    const byProtocol = msg.stickerCandidates.some((c) => c.protocolEmoji);
    const explicitSticker = msg.stickerCandidates.some((c) => c.kind === "mface" || c.kind === "marketface");
    if (byProtocol || explicitSticker) return { collect: true, reason: "protocol-emoji" };
    if (this.config.stickers.autoCollectStickerOnly) return { collect: false, reason: "sticker-only-enabled" };
    if (!this.config.stickers.autoCollectFromImage) return { collect: false, reason: "image-auto-collect-disabled" };

    const lower = msg.content.toLowerCase();
    const blockedHints = ["截图", "发票", "票据", "文档", "报表", "身份证", "风景", "合照", "聊天记录"];
    if (blockedHints.some((h) => lower.includes(h))) return { collect: false, reason: "privacy-blocked-by-text" };
    const ext = path.extname(mediaPath).toLowerCase();
    if (ext === ".gif" || ext === ".webp") return { collect: true, reason: "animated-like" };
    return { collect: false, reason: "low-confidence-image" };
  }

  private detectExt(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext || ".jpg";
  }

  private hashBuffer(buf: Buffer): string {
    return crypto.createHash("sha256").update(buf).digest("hex");
  }

  private findByHash(index: StickerIndex, hash: string): StickerRecord | undefined {
    return index.records.find((r) => r.hash === hash);
  }

  listRecent(limit = 10): StickerRecord[] {
    const index = this.readIndex();
    return index.records
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, Math.max(1, Math.min(50, limit)));
  }

  search(query: string, topK = 5): StickerRecord[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.listRecent(topK);
    const index = this.readIndex();
    const scored = index.records.map((r) => {
      const hay = [
        r.semantics.title,
        r.semantics.meaning,
        ...r.semantics.aliases,
        ...r.semantics.intentTags,
        ...r.semantics.emotionTags,
      ].join(" ").toLowerCase();
      let score = 0;
      if (hay.includes(q)) score += 3;
      for (const token of q.split(/\s+/).filter(Boolean)) {
        if (hay.includes(token)) score += 1;
      }
      score += Math.min(3, Math.log10(r.usageCount + 1));
      return { r, score };
    });
    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, topK)))
      .map((x) => x.r);
  }

  getById(id: string): StickerRecord | null {
    const index = this.readIndex();
    return index.records.find((r) => r.id === id) ?? null;
  }

  incrementUsage(id: string): void {
    const index = this.readIndex();
    const hit = index.records.find((r) => r.id === id);
    if (!hit) return;
    hit.usageCount += 1;
    hit.updatedAt = new Date().toISOString();
    this.writeIndex(index);
  }

  updateSemantics(
    id: string,
    patch: Partial<StickerSemantics>,
    reason: string,
    source: "auto" | "user-guided",
  ): StickerRecord | null {
    const index = this.readIndex();
    const hit = index.records.find((r) => r.id === id);
    if (!hit) return null;
    const before = ensureSemantics(hit.semantics);
    const merged = ensureSemantics({
      ...before,
      ...patch,
      aliases: patch.aliases ? normalizeTerms(patch.aliases) : before.aliases,
      emotionTags: patch.emotionTags ? normalizeTerms(patch.emotionTags) : before.emotionTags,
      intentTags: patch.intentTags ? normalizeTerms(patch.intentTags) : before.intentTags,
      useWhen: patch.useWhen ? normalizeTerms(patch.useWhen) : before.useWhen,
      avoidWhen: patch.avoidWhen ? normalizeTerms(patch.avoidWhen) : before.avoidWhen,
    });
    const patchSummary = summarizePatch(before, merged);
    hit.semantics = merged;
    hit.updatedAt = new Date().toISOString();
    hit.semanticHistory.push({
      at: hit.updatedAt,
      source,
      reason: reason || "update",
      patchSummary,
    });
    if (hit.semanticHistory.length > this.maxSemanticHistory) {
      hit.semanticHistory = hit.semanticHistory.slice(-this.maxSemanticHistory);
    }
    this.writeIndex(index);
    return hit;
  }

  addAlias(id: string, alias: string): StickerRecord | null {
    const trimmed = alias.trim();
    if (!trimmed) return null;
    const record = this.getById(id);
    if (!record) return null;
    const aliases = Array.from(new Set([...record.semantics.aliases, trimmed]));
    return this.updateSemantics(id, { aliases }, "alias-add", "user-guided");
  }

  async collectFromInbound(msg: QQMessage, mediaPaths: string[]): Promise<number> {
    if (!this.config.stickers.enabled || mediaPaths.length === 0) return 0;
    const decision = this.scoreCandidate(msg, mediaPaths[0]);
    if (!decision.collect) {
      this.log.info?.(
        `[QQ] Sticker skipped: reason=${decision.reason} messageId=${msg.id} user=${msg.userId}`,
      );
      return 0;
    }

    const maxN = Math.max(1, this.config.stickers.maxAutoCollectPerMessage);
    const selected = mediaPaths.slice(0, maxN);
    let saved = 0;
    const index = this.readIndex();
    for (const srcPath of selected) {
      try {
        if (!fs.existsSync(srcPath)) continue;
        const buf = fs.readFileSync(srcPath);
        if (!buf.length || buf.length > this.config.limits.imageMaxSize) continue;
        const hash = this.hashBuffer(buf);
        const exists = this.findByHash(index, hash);
        if (exists) {
          exists.usageCount += 1;
          exists.updatedAt = new Date().toISOString();
          continue;
        }
        const ext = this.detectExt(srcPath);
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const relFile = `files/${id}${ext}`;
        const targetPath = path.join(this.rootDir, relFile);
        fs.writeFileSync(targetPath, buf);
        const title = msg.stickerCandidates.find((c) => c.name)?.name || "新表情";
        const protocolEmoji = msg.stickerCandidates.some((c) => c.protocolEmoji);
        const sourceType = (msg.stickerCandidates[0]?.kind ?? "image") as "image" | "mface" | "marketface";
        const now = new Date().toISOString();
        index.records.push({
          id,
          hash,
          ext,
          filePath: relFile,
          createdAt: now,
          updatedAt: now,
          usageCount: 1,
          sourceType,
          sourceUserId: msg.userId,
          sourceMessageId: msg.id,
          protocolEmoji,
          semantics: ensureSemantics({
            title,
            meaning: protocolEmoji ? "来自 QQ 表情段，通常用于轻松表达情绪" : "待补充语义",
            aliases: title ? [title] : [],
            confidence: protocolEmoji ? 0.85 : 0.55,
          }),
          semanticHistory: [{
            at: now,
            source: "auto",
            reason: `auto-collect:${decision.reason}`,
            patchSummary: "created",
          }],
        });
        saved += 1;
      } catch (e) {
        this.log.warn?.(`[QQ] Sticker save failed: ${e}`);
      }
    }
    if (saved > 0) {
      this.writeIndex(index);
      this.log.info(`[QQ] Sticker collected: ${saved} item(s) from message ${msg.id} reason=${decision.reason}`);
    }
    return saved;
  }

  resolveFilePath(rec: StickerRecord): string {
    return path.join(this.rootDir, rec.filePath);
  }
}
