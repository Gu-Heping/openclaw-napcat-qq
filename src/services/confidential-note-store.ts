/**
 * Persistent storage for "confidential notes about a person".
 *
 * When user A privately tells the bot something about user B,
 * the bot can save it as a confidential note keyed by B's userId.
 * The note stores only the content — never who said it — so that
 * the bot can use it for tone/attitude adjustment without leaking the source.
 *
 * Storage: `memory/confidential/about_{userId}.md`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BotConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";

export interface ConfidentialNote {
  content: string;
  timestamp: number;
}

export class ConfidentialNoteStore {
  private dir: string;
  private log: PluginLogger;
  private cache = new Map<string, ConfidentialNote[]>();

  constructor(config: BotConfig, log: PluginLogger) {
    this.dir = path.join(config.paths.workspace, "memory", "confidential");
    this.log = log;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Add a confidential note about a user.
   * Called by the bot tool — content should NOT contain the source identity.
   */
  addNote(aboutUserId: string, content: string): void {
    const notes = this.loadNotes(aboutUserId);
    notes.push({ content: content.slice(0, 500), timestamp: Date.now() });
    if (notes.length > 20) notes.shift();
    this.cache.set(aboutUserId, notes);
    this.persist(aboutUserId, notes);
  }

  /**
   * Get a formatted string of all confidential notes about a user,
   * ready to inject into the bot's context. Returns empty string if none.
   */
  getNotesForUser(aboutUserId: string): string {
    const notes = this.loadNotes(aboutUserId);
    if (!notes.length) return "";
    const lines = notes.map((n) => {
      const date = new Date(n.timestamp).toLocaleDateString("zh-CN");
      return `- (${date}) ${n.content}`;
    });
    return `有人曾私下提到关于此人的信息：\n${lines.join("\n")}`;
  }

  /**
   * List all user IDs that have confidential notes.
   */
  listSubjects(): string[] {
    try {
      return fs.readdirSync(this.dir)
        .filter((f) => f.startsWith("about_") && f.endsWith(".json"))
        .map((f) => f.replace("about_", "").replace(".json", ""));
    } catch {
      return [];
    }
  }

  private loadNotes(aboutUserId: string): ConfidentialNote[] {
    if (this.cache.has(aboutUserId)) return this.cache.get(aboutUserId)!;
    const filePath = path.join(this.dir, `about_${aboutUserId}.json`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const notes: ConfidentialNote[] = Array.isArray(raw) ? raw : [];
      this.cache.set(aboutUserId, notes);
      return notes;
    } catch {
      return [];
    }
  }

  private persist(aboutUserId: string, notes: ConfidentialNote[]): void {
    const filePath = path.join(this.dir, `about_${aboutUserId}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(notes, null, 2));
    } catch (e) {
      this.log.warn?.(`[QQ] Failed to persist confidential note for ${aboutUserId}: ${e}`);
    }
  }
}
