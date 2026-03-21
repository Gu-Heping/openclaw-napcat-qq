import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { BotConfig } from "../config.js";
import type { QQMessage } from "../napcat/types.js";
import type { PluginLogger } from "../types-compat.js";
import { rankStickerRecordsByQuery, usageBoostScore } from "./sticker-search-score.js";

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

/**
 * 收藏入库结果。内容去重依据为 **文件原始字节的 SHA256**（十六进制）；
 * 与「同一图像的 Base64 解码后再哈希」一致，无需单独传 Base64。
 */
export type StickerImportFromFileResult =
  | { kind: "created"; record: StickerRecord }
  | { kind: "duplicate"; record: StickerRecord; contentSha256: string }
  | { kind: "failed"; message: string };

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

/** 供 JSON 与 SQLite 后端共用的存储接口 */
export interface IStickerStore {
  listRecent(limit?: number): StickerRecord[];
  search(query: string, topK?: number): StickerRecord[];
  searchWithScores(query: string, topK?: number): Array<{ record: StickerRecord; score: number }>;
  getById(id: string): StickerRecord | null;
  incrementUsage(id: string): void;
  updateSemantics(id: string, patch: Partial<StickerSemantics>, reason: string, source: "auto" | "user-guided"): StickerRecord | null;
  addAlias(id: string, alias: string): StickerRecord | null;
  importFromFile(
    msg: QQMessage,
    absPath: string,
    meta: { reason: string; source: "auto" | "user-guided"; semantics?: Partial<StickerSemantics> },
  ): StickerImportFromFileResult;
  collectFromInbound(msg: QQMessage, mediaPaths: string[]): Promise<number>;
  resolveFilePath(rec: StickerRecord): string;
  sweepOrphanFiles(): number;
}

const STICKER_INDEX_SCHEMA_VERSION = 1;

interface StickerIndex {
  schemaVersion?: number;
  records: StickerRecord[];
}

export function normalizeTerms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function ensureSemantics(raw?: Partial<StickerSemantics>): StickerSemantics {
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

export function summarizePatch(before: StickerSemantics, after: StickerSemantics): string {
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
      this.writeIndex({ schemaVersion: STICKER_INDEX_SCHEMA_VERSION, records: [] });
    }
  }

  private readIndex(): StickerIndex {
    try {
      const raw = fs.readFileSync(this.metaFile, "utf-8");
      const parsed = JSON.parse(raw) as StickerIndex;
      if (!Array.isArray(parsed.records)) return { schemaVersion: STICKER_INDEX_SCHEMA_VERSION, records: [] };
      const version = parsed.schemaVersion ?? 0;
      if (version < STICKER_INDEX_SCHEMA_VERSION) {
        return this.migrateIndex(parsed, version);
      }
      return parsed;
    } catch {
      return { schemaVersion: STICKER_INDEX_SCHEMA_VERSION, records: [] };
    }
  }

  private migrateIndex(parsed: StickerIndex, fromVersion: number): StickerIndex {
    let records = parsed.records;
    if (fromVersion < 1) {
      records = records.map((r) => ({
        ...r,
        semantics: ensureSemantics(r.semantics),
        semanticHistory: Array.isArray(r.semanticHistory) ? r.semanticHistory : [],
      }));
    }
    const migrated = { schemaVersion: STICKER_INDEX_SCHEMA_VERSION as number, records };
    this.writeIndex(migrated);
    this.log.info?.(`[QQ] Sticker index migrated schemaVersion ${fromVersion} -> ${STICKER_INDEX_SCHEMA_VERSION}`);
    return migrated;
  }

  private writeIndex(index: StickerIndex): void {
    const tmp = `${this.metaFile}.tmp`;
    const toWrite = { schemaVersion: STICKER_INDEX_SCHEMA_VERSION, records: index.records };
    fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2));
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

  searchWithScores(query: string, topK = 5): Array<{ record: StickerRecord; score: number }> {
    const k = Math.max(1, Math.min(20, topK));
    const q = query.trim().toLowerCase();
    if (!q) {
      return this.listRecent(k).map((r) => ({ record: r, score: usageBoostScore(r.usageCount) }));
    }
    const index = this.readIndex();
    return rankStickerRecordsByQuery(q, index.records, k);
  }

  search(query: string, topK = 5): StickerRecord[] {
    return this.searchWithScores(query, topK).map((x) => x.record);
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

  /**
   * 将本地图片文件导入收藏库（供 collectFromInbound 与 sticker_collect 复用）。
   * @returns 新创建的记录；若已存在则 bump usage 并返回 null；出错返回 null。
   */
  importFromFile(
    msg: QQMessage,
    absPath: string,
    meta: {
      reason: string;
      source: "auto" | "user-guided";
      semantics?: Partial<StickerSemantics>;
    },
  ): StickerImportFromFileResult {
    if (!this.config.stickers.enabled) return { kind: "failed", message: "sticker 功能已关闭" };
    try {
      if (!fs.existsSync(absPath)) return { kind: "failed", message: "文件不存在或路径无效" };
      const buf = fs.readFileSync(absPath);
      if (!buf.length) return { kind: "failed", message: "文件为空" };
      if (buf.length > this.config.limits.imageMaxSize) {
        return { kind: "failed", message: `文件超过大小限制（>${this.config.limits.imageMaxSize}）` };
      }
      const hash = this.hashBuffer(buf);
      const index = this.readIndex();
      const exists = this.findByHash(index, hash);
      if (exists) {
        exists.usageCount += 1;
        exists.updatedAt = new Date().toISOString();
        this.writeIndex(index);
        return { kind: "duplicate", record: exists, contentSha256: hash };
      }
      const ext = this.detectExt(absPath);
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const relFile = `files/${id}${ext}`;
      const targetPath = path.join(this.rootDir, relFile);
      fs.writeFileSync(targetPath, buf);
      const defaultTitle = msg.stickerCandidates.find((c) => c.name)?.name || "新表情";
      const protocolEmoji = msg.stickerCandidates.some((c) => c.protocolEmoji);
      const sourceType = (msg.stickerCandidates[0]?.kind ?? "image") as "image" | "mface" | "marketface";
      const now = new Date().toISOString();
      const record: StickerRecord = {
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
          title: defaultTitle,
          meaning: protocolEmoji ? "来自 QQ 表情段，通常用于轻松表达情绪" : "待补充语义",
          aliases: defaultTitle && defaultTitle !== "新表情" ? [defaultTitle] : [],
          confidence: protocolEmoji ? 0.85 : 0.55,
          ...meta.semantics,
        }),
        semanticHistory: [{
          at: now,
          source: meta.source,
          reason: meta.reason,
          patchSummary: "created",
        }],
      };
      index.records.push(record);
      this.writeIndex(index);
      return { kind: "created", record };
    } catch (e) {
      this.log.warn?.(`[QQ] Sticker import failed: ${e}`);
      return { kind: "failed", message: `入库异常: ${e}` };
    }
  }

  async collectFromInbound(msg: QQMessage, mediaPaths: string[]): Promise<number> {
    if (!this.config.stickers.enabled || mediaPaths.length === 0) return 0;
    if (!this.config.stickers.inboundAutoCollect) return 0;
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
    for (const srcPath of selected) {
      const title = msg.stickerCandidates.find((c) => c.name)?.name || "新表情";
      const protocolEmoji = msg.stickerCandidates.some((c) => c.protocolEmoji);
      const outcome = this.importFromFile(msg, srcPath, {
        reason: `auto-collect:${decision.reason}`,
        source: "auto",
        semantics: {
          title,
          meaning: protocolEmoji ? "来自 QQ 表情段，通常用于轻松表达情绪" : "待补充语义",
          aliases: title ? [title] : [],
          confidence: protocolEmoji ? 0.85 : 0.55,
        },
      });
      if (outcome.kind === "created") saved += 1;
    }
    if (saved > 0) {
      this.log.info(`[QQ] Sticker collected: ${saved} item(s) from message ${msg.id} reason=${decision.reason}`);
    }
    return saved;
  }

  resolveFilePath(rec: StickerRecord): string {
    return path.join(this.rootDir, rec.filePath);
  }

  /**
   * 扫描 files/ 目录，删除 index 中不存在的孤儿文件。
   * @returns 删除的文件数量
   */
  sweepOrphanFiles(): number {
    const index = this.readIndex();
    const knownPaths = new Set(index.records.map((r) => path.join(this.rootDir, r.filePath)));
    let removed = 0;
    try {
      const entries = fs.readdirSync(this.filesDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const absPath = path.join(this.filesDir, ent.name);
        if (!knownPaths.has(absPath)) {
          fs.unlinkSync(absPath);
          removed += 1;
          this.log.info?.(`[QQ] Sticker orphan removed: ${ent.name}`);
        }
      }
    } catch (e) {
      this.log.warn?.(`[QQ] Sticker orphan sweep failed: ${e}`);
    }
    return removed;
  }
}
