import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { BotConfig } from "../config.js";
import type { QQMessage } from "../napcat/types.js";
import type { PluginLogger } from "../types-compat.js";
import type { StickerImportFromFileResult, StickerRecord, StickerSemantics } from "./sticker-store.js";
import {
  ensureSemantics,
  normalizeTerms,
  summarizePatch,
} from "./sticker-store.js";
import {
  buildStickerSearchCorpus,
  rankStickerRecordsByQuery,
  scoreStickerSemanticMatch,
  usageBoostScore,
} from "./sticker-search-score.js";

const require = createRequire(import.meta.url);
const SCHEMA_VERSION = 1;

function rowToRecord(row: Record<string, unknown>): StickerRecord {
  const semantics = JSON.parse(String(row.semantics ?? "{}")) as Partial<StickerSemantics>;
  const semanticHistory = JSON.parse(String(row.semanticHistory ?? "[]"));
  return {
    id: String(row.id),
    hash: String(row.hash),
    ext: String(row.ext),
    filePath: String(row.filePath),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    usageCount: Number(row.usageCount ?? 0),
    sourceType: String(row.sourceType ?? "image") as StickerRecord["sourceType"],
    sourceUserId: String(row.sourceUserId ?? ""),
    sourceMessageId: String(row.sourceMessageId ?? ""),
    protocolEmoji: Boolean(row.protocolEmoji),
    semantics: ensureSemantics(semantics),
    semanticHistory: Array.isArray(semanticHistory) ? semanticHistory : [],
  };
}

type DatabaseSyncCtor = new (path: string) => {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => Record<string, unknown> | undefined; all: (...args: unknown[]) => Record<string, unknown>[] };
  close: () => void;
};

export function createStickerStoreSqlite(
  config: BotConfig,
  log: PluginLogger,
): StickerStoreSqlite | null {
  try {
    const sqlite = require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return new StickerStoreSqlite(config, log, sqlite.DatabaseSync);
  } catch (e) {
    log.warn?.(`[QQ] SQLite backend unavailable (Node 22+ required): ${e}`);
    return null;
  }
}

export class StickerStoreSqlite {
  private readonly rootDir: string;
  private readonly dbPath: string;
  private readonly filesDir: string;
  private readonly maxSemanticHistory: number;
  private db: {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...args: unknown[]) => void;
      get: (...args: unknown[]) => Record<string, unknown> | undefined;
      all: (...args: unknown[]) => Record<string, unknown>[];
    };
    close: () => void;
  };

  constructor(
    private config: BotConfig,
    private log: PluginLogger,
    DatabaseSync: DatabaseSyncCtor,
  ) {
    this.rootDir = config.paths.stickerStore;
    this.dbPath = path.join(this.rootDir, "index.db");
    this.filesDir = path.join(this.rootDir, "files");
    this.maxSemanticHistory = Math.max(5, config.stickers.maxSemanticHistory);
    fs.mkdirSync(this.filesDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO _meta (key, value) VALUES ('schemaVersion', '${SCHEMA_VERSION}');
      CREATE TABLE IF NOT EXISTS stickers (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        ext TEXT NOT NULL,
        filePath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        usageCount INTEGER NOT NULL DEFAULT 0,
        sourceType TEXT NOT NULL,
        sourceUserId TEXT NOT NULL,
        sourceMessageId TEXT NOT NULL,
        protocolEmoji INTEGER NOT NULL,
        semantics TEXT NOT NULL,
        semanticHistory TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stickers_hash ON stickers(hash);
      CREATE INDEX IF NOT EXISTS idx_stickers_updatedAt ON stickers(updatedAt);
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS stickers_fts USING fts5(
        stickerId UNINDEXED,
        corpus,
        tokenize = 'unicode61 remove_diacritics 1'
      );
    `);
    this.migrateFromJsonIfNeeded();
    this.ensureStickerFtsSynced();
  }

  private rebuildStickerFts(): void {
    this.db.exec("DELETE FROM stickers_fts");
    const rows = this.db.prepare("SELECT * FROM stickers").all() as Record<string, unknown>[];
    const ins = this.db.prepare("INSERT INTO stickers_fts (stickerId, corpus) VALUES (?, ?)");
    for (const row of rows) {
      const r = rowToRecord(row);
      ins.run(r.id, buildStickerSearchCorpus(r.semantics));
    }
  }

  private upsertStickerFts(rec: StickerRecord): void {
    this.db.prepare("DELETE FROM stickers_fts WHERE stickerId = ?").run(rec.id);
    this.db.prepare("INSERT INTO stickers_fts (stickerId, corpus) VALUES (?, ?)").run(
      rec.id,
      buildStickerSearchCorpus(rec.semantics),
    );
  }

  /** stickers 与 FTS 行数不一致时全量重建（升级或迁移后）。 */
  private ensureStickerFtsSynced(): void {
    try {
      const nSticker = (this.db.prepare("SELECT COUNT(*) AS n FROM stickers").get() as { n: number }).n;
      const nFts = (this.db.prepare("SELECT COUNT(*) AS n FROM stickers_fts").get() as { n: number }).n;
      if (nSticker > 0 && nFts !== nSticker) {
        this.rebuildStickerFts();
        this.log.info?.(`[QQ] stickers_fts rebuilt (${nSticker} row(s))`);
      }
    } catch (e) {
      this.log.warn?.(`[QQ] stickers_fts sync check failed: ${e}`);
    }
  }

  /** FTS5 MATCH 短语；多词空白则 AND。 */
  private buildFtsMatchQuery(raw: string): string {
    const t = raw.trim().toLowerCase().replace(/"/g, " ");
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";
    const esc = (p: string) => p.replace(/"/g, '""');
    if (parts.length === 1) return `corpus : "${esc(parts[0]!)}"`;
    return parts.map((p) => `corpus : "${esc(p)}"`).join(" AND ");
  }

  private ftsCandidateStickerIds(query: string, limit: number): string[] {
    const match = this.buildFtsMatchQuery(query);
    if (!match) return [];
    const stmt = this.db.prepare(
      "SELECT stickerId FROM stickers_fts WHERE stickers_fts MATCH ? ORDER BY bm25(stickers_fts) ASC LIMIT ?",
    );
    const rows = stmt.all(match, limit) as { stickerId: string }[];
    return rows.map((r) => r.stickerId);
  }

  private searchHeuristicScored(query: string, topK: number): Array<{ record: StickerRecord; score: number }> {
    const q = query.trim().toLowerCase();
    const k = Math.max(1, Math.min(20, topK));
    if (!q) {
      return this.listRecent(k).map((r) => ({ record: r, score: usageBoostScore(r.usageCount) }));
    }
    const stmt = this.db.prepare("SELECT * FROM stickers");
    const rows = stmt.all() as Record<string, unknown>[];
    const records = rows.map(rowToRecord);
    return rankStickerRecordsByQuery(q, records, k);
  }

  private migrateFromJsonIfNeeded(): void {
    const jsonPath = path.join(this.rootDir, "index.json");
    if (!fs.existsSync(jsonPath)) return;
    const countStmt = this.db.prepare("SELECT COUNT(*) as n FROM stickers");
    const { n } = countStmt.get() as { n: number };
    if (n > 0) return;
    try {
      const raw = fs.readFileSync(jsonPath, "utf-8");
      const parsed = JSON.parse(raw) as { records?: StickerRecord[] };
      const records = Array.isArray(parsed?.records) ? parsed.records : [];
      if (records.length === 0) return;
      const insert = this.db.prepare(
        "INSERT OR REPLACE INTO stickers (id, hash, ext, filePath, createdAt, updatedAt, usageCount, sourceType, sourceUserId, sourceMessageId, protocolEmoji, semantics, semanticHistory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const r of records) {
        insert.run(
          r.id, r.hash, r.ext, r.filePath, r.createdAt, r.updatedAt, r.usageCount,
          r.sourceType, r.sourceUserId, r.sourceMessageId, r.protocolEmoji ? 1 : 0,
          JSON.stringify(r.semantics), JSON.stringify(r.semanticHistory ?? []),
        );
      }
      this.log.info?.(`[QQ] Sticker index migrated ${records.length} record(s) from JSON to SQLite`);
      this.rebuildStickerFts();
    } catch (e) {
      this.log.warn?.(`[QQ] Sticker JSON->SQLite migration failed: ${e}`);
    }
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

  listRecent(limit = 10): StickerRecord[] {
    const stmt = this.db.prepare("SELECT * FROM stickers ORDER BY updatedAt DESC LIMIT ?");
    const rows = stmt.all(Math.max(1, Math.min(50, limit)));
    return rows.map(rowToRecord);
  }

  searchWithScores(query: string, topK = 5): Array<{ record: StickerRecord; score: number }> {
    const k = Math.max(1, Math.min(20, topK));
    const q = query.trim().toLowerCase();
    if (!q) {
      return this.listRecent(k).map((r) => ({ record: r, score: usageBoostScore(r.usageCount) }));
    }
    const mode = this.config.stickers.searchMode ?? "heuristic";
    if (mode === "fts") {
      try {
        const poolLimit = Math.min(200, Math.max(k * 4, 40));
        const ids = this.ftsCandidateStickerIds(query, poolLimit);
        if (ids.length > 0) {
          const scored: Array<{ record: StickerRecord; score: number }> = [];
          for (const id of ids) {
            const r = this.getById(id);
            if (!r) continue;
            scored.push({
              record: r,
              score: scoreStickerSemanticMatch(q, r.semantics, r.usageCount),
            });
          }
          scored.sort((a, b) => b.score - a.score);
          if (scored.length > 0 && scored[0]!.score > 0) {
            return scored.slice(0, k);
          }
        }
      } catch (e) {
        this.log.warn?.(`[QQ] stickers_fts MATCH failed, fallback heuristic: ${e}`);
      }
    }
    return this.searchHeuristicScored(query, k);
  }

  search(query: string, topK = 5): StickerRecord[] {
    return this.searchWithScores(query, topK).map((x) => x.record);
  }

  getById(id: string): StickerRecord | null {
    const stmt = this.db.prepare("SELECT * FROM stickers WHERE id = ?");
    const row = stmt.get(id);
    return row ? rowToRecord(row) : null;
  }

  incrementUsage(id: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare("UPDATE stickers SET usageCount = usageCount + 1, updatedAt = ? WHERE id = ?");
    stmt.run(now, id);
  }

  updateSemantics(
    id: string,
    patch: Partial<StickerSemantics>,
    reason: string,
    source: "auto" | "user-guided",
  ): StickerRecord | null {
    const rec = this.getById(id);
    if (!rec) return null;
    const before = ensureSemantics(rec.semantics);
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
    const history = [...rec.semanticHistory, {
      at: new Date().toISOString(),
      source,
      reason: reason || "update",
      patchSummary,
    }].slice(-this.maxSemanticHistory);
    const stmt = this.db.prepare(
      "UPDATE stickers SET semantics = ?, semanticHistory = ?, updatedAt = ? WHERE id = ?",
    );
    stmt.run(JSON.stringify(merged), JSON.stringify(history), history[history.length - 1]?.at ?? new Date().toISOString(), id);
    const updated = this.getById(id);
    if (updated) this.upsertStickerFts(updated);
    return updated;
  }

  addAlias(id: string, alias: string): StickerRecord | null {
    const trimmed = alias.trim();
    if (!trimmed) return null;
    const record = this.getById(id);
    if (!record) return null;
    const aliases = Array.from(new Set([...record.semantics.aliases, trimmed]));
    return this.updateSemantics(id, { aliases }, "alias-add", "user-guided");
  }

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
      const getByHash = this.db.prepare("SELECT * FROM stickers WHERE hash = ?");
      const exists = getByHash.get(hash) as Record<string, unknown> | undefined;
      if (exists) {
        this.incrementUsage(String(exists.id));
        const rec = this.getById(String(exists.id));
        if (!rec) return { kind: "failed", message: "重复条目读取失败" };
        return { kind: "duplicate", record: rec, contentSha256: hash };
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
      const semantics = ensureSemantics({
        title: defaultTitle,
        meaning: protocolEmoji ? "来自 QQ 表情段，通常用于轻松表达情绪" : "待补充语义",
        aliases: defaultTitle && defaultTitle !== "新表情" ? [defaultTitle] : [],
        confidence: protocolEmoji ? 0.85 : 0.55,
        ...meta.semantics,
      });
      const insert = this.db.prepare(
        "INSERT INTO stickers (id, hash, ext, filePath, createdAt, updatedAt, usageCount, sourceType, sourceUserId, sourceMessageId, protocolEmoji, semantics, semanticHistory) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
      );
      insert.run(
        id, hash, ext, relFile, now, now,
        sourceType, msg.userId, msg.id, protocolEmoji ? 1 : 0,
        JSON.stringify(semantics),
        JSON.stringify([{ at: now, source: meta.source, reason: meta.reason, patchSummary: "created" }]),
      );
      const created = this.getById(id);
      if (!created) return { kind: "failed", message: "入库后读取记录失败" };
      this.upsertStickerFts(created);
      return { kind: "created", record: created };
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
      this.log.info?.(`[QQ] Sticker skipped: reason=${decision.reason} messageId=${msg.id} user=${msg.userId}`);
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

  sweepOrphanFiles(): number {
    const stmt = this.db.prepare("SELECT filePath FROM stickers");
    const rows = stmt.all() as { filePath: string }[];
    const knownPaths = new Set(rows.map((r) => path.join(this.rootDir, r.filePath)));
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
