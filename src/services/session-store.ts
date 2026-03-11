import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { BotConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";

export class SessionStore {
  private sessionsPath: string;
  private log: PluginLogger;

  constructor(config: BotConfig, log: PluginLogger) {
    this.sessionsPath = path.join(config.paths.sessionsDir, "sessions.json");
    this.log = log;
  }

  async resetSession(sessionKey: string): Promise<boolean> {
    try {
      if (!fs.existsSync(this.sessionsPath)) return false;
      const store = JSON.parse(fs.readFileSync(this.sessionsPath, "utf-8"));
      const entry = store[sessionKey];
      if (!entry) return false;

      if (entry.sessionFile && fs.existsSync(entry.sessionFile)) {
        fs.writeFileSync(entry.sessionFile, "");
        this.log.info(`[QQ] Cleared session file: ${entry.sessionFile}`);
      }

      delete entry.systemSent;
      entry.updatedAt = Date.now();
      entry.sessionId = crypto.randomUUID();
      const newFile = this.sessionsPath.replace("sessions.json", `${entry.sessionId}.jsonl`);
      entry.sessionFile = newFile;
      store[sessionKey] = entry;
      fs.writeFileSync(this.sessionsPath, JSON.stringify(store, null, 2));

      this.log.info(`[QQ] Reset session: ${sessionKey} → ${entry.sessionId}`);
      return true;
    } catch (e) {
      this.log.warn?.(`[QQ] resetSession error: ${e}`);
      return false;
    }
  }

  async persistSessionModel(
    sessionKey: string,
    modelProvider: string,
    model: string,
  ): Promise<boolean> {
    try {
      const store: Record<string, Record<string, unknown>> = fs.existsSync(this.sessionsPath)
        ? JSON.parse(fs.readFileSync(this.sessionsPath, "utf-8"))
        : {};
      if (!store || typeof store !== "object") return false;

      let entry = store[sessionKey];
      if (!entry || typeof entry !== "object") {
        entry = { updatedAt: Date.now() };
        store[sessionKey] = entry;
      }
      entry.providerOverride = modelProvider;
      entry.modelOverride = model;
      entry.updatedAt = Date.now();

      fs.mkdirSync(path.dirname(this.sessionsPath), { recursive: true });
      fs.writeFileSync(this.sessionsPath, JSON.stringify(store, null, 2));
      this.log.info?.(`[QQ] Persisted session model: ${sessionKey} → ${modelProvider}/${model}`);
      return true;
    } catch (e) {
      this.log.warn?.(`[QQ] persistSessionModel error: ${e}`);
      return false;
    }
  }

  loadModelOverrides(): Map<string, { provider: string; model: string }> {
    const result = new Map<string, { provider: string; model: string }>();
    try {
      if (!fs.existsSync(this.sessionsPath)) return result;
      const store = JSON.parse(fs.readFileSync(this.sessionsPath, "utf-8"));
      for (const [key, entry] of Object.entries(store)) {
        const e = entry as Record<string, unknown>;
        const provider = e.providerOverride as string | undefined;
        const model = e.modelOverride as string | undefined;
        if (provider && model) {
          result.set(key, { provider, model });
        }
      }
      this.log.info?.(`[QQ] Loaded ${result.size} model overrides from sessions.json`);
    } catch (e) {
      this.log.warn?.(`[QQ] loadModelOverrides error: ${e}`);
    }
    return result;
  }

  hasSession(sessionKey: string): boolean {
    try {
      if (!fs.existsSync(this.sessionsPath)) return false;
      const store = JSON.parse(fs.readFileSync(this.sessionsPath, "utf-8"));
      return !!store[sessionKey];
    } catch {
      return false;
    }
  }

  /**
   * Returns the session jsonl file path for the given sessionKey, if the session exists
   * in sessions.json (created by the core when that session has been used).
   * Used to append "assistant" lines when recording tool-sent messages to that session.
   */
  getSessionFilePath(sessionKey: string): string | null {
    try {
      if (!fs.existsSync(this.sessionsPath)) return null;
      const store = JSON.parse(fs.readFileSync(this.sessionsPath, "utf-8"));
      const entry = store[sessionKey];
      if (!entry || typeof entry !== "object") return null;
      const pathVal = entry.sessionFile;
      return typeof pathVal === "string" && pathVal ? pathVal : null;
    } catch {
      return null;
    }
  }
}
