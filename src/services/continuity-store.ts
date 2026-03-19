import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginLogger } from "../types-compat.js";

interface ContinuitySnippet {
  text: string;
  timestamp: number;
}

interface GroupContinuityState {
  groupId: string;
  nickname: string;
  updatedAt: number;
  snippets: ContinuitySnippet[];
}

interface UserContinuityState {
  userId: string;
  nickname: string;
  updatedAt: number;
  privateSnippets: ContinuitySnippet[];
  groups: Record<string, GroupContinuityState>;
}

function clampSnippet(text: string, maxLen = 160): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export class ContinuityStore {
  private readonly dir: string;
  private readonly log: PluginLogger;
  private readonly maxPrivateSnippets: number;
  private readonly maxGroupSnippets: number;
  private readonly maxGroupsPerUser: number;
  private readonly ttlMs: number;

  constructor(
    workspace: string,
    log: PluginLogger,
    opts?: {
      maxPrivateSnippets?: number;
      maxGroupSnippets?: number;
      maxGroupsPerUser?: number;
      ttlMs?: number;
    },
  ) {
    this.dir = path.join(workspace, "memory", "_meta", "bridges");
    fs.mkdirSync(this.dir, { recursive: true });
    this.log = log;
    this.maxPrivateSnippets = opts?.maxPrivateSnippets ?? 3;
    this.maxGroupSnippets = opts?.maxGroupSnippets ?? 2;
    this.maxGroupsPerUser = opts?.maxGroupsPerUser ?? 3;
    this.ttlMs = opts?.ttlMs ?? 24 * 60 * 60_000;
  }

  recordPrivateMessage(userId: string, nickname: string, content: string): void {
    const text = clampSnippet(content);
    if (!text) return;
    const state = this.load(userId);
    state.userId = userId;
    state.nickname = nickname || state.nickname || userId;
    state.updatedAt = Date.now();
    state.privateSnippets = this.pushSnippet(state.privateSnippets, text, this.maxPrivateSnippets);
    this.pruneGroups(state);
    this.save(state);
  }

  recordGroupMessage(userId: string, groupId: string, nickname: string, content: string): void {
    const text = clampSnippet(content);
    if (!text) return;
    const now = Date.now();
    const state = this.load(userId);
    state.userId = userId;
    state.nickname = nickname || state.nickname || userId;
    state.updatedAt = now;
    const group = state.groups[groupId] ?? {
      groupId,
      nickname: nickname || userId,
      updatedAt: now,
      snippets: [],
    };
    group.nickname = nickname || group.nickname || userId;
    group.updatedAt = now;
    group.snippets = this.pushSnippet(group.snippets, text, this.maxGroupSnippets);
    state.groups[groupId] = group;
    this.pruneGroups(state);
    this.save(state);
  }

  buildPrivateSupplement(userId: string): string {
    const state = this.load(userId);
    const recentGroups = Object.values(state.groups)
      .filter((group) => Date.now() - group.updatedAt < this.ttlMs)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, this.maxGroupsPerUser);
    if (!recentGroups.length) return "";
    const lines = recentGroups.flatMap((group) =>
      group.snippets
        .slice()
        .reverse()
        .map((snippet) => `- [Group ${group.groupId}] ${group.nickname}: ${snippet.text}`),
    );
    if (!lines.length) return "";
    return ["[Recent group continuity]", ...lines].join("\n");
  }

  buildGroupSupplement(userId: string, currentGroupId: string): string {
    const state = this.load(userId);
    const privateLines = state.privateSnippets
      .filter((snippet) => Date.now() - snippet.timestamp < this.ttlMs)
      .slice()
      .reverse()
      .map((snippet) => `- Private: ${snippet.text}`);
    const otherGroupLines = Object.values(state.groups)
      .filter((group) => group.groupId !== currentGroupId && Date.now() - group.updatedAt < this.ttlMs)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 2)
      .flatMap((group) =>
        group.snippets
          .slice()
          .reverse()
          .map((snippet) => `- [Other Group ${group.groupId}] ${group.nickname}: ${snippet.text}`),
      );
    const lines = [...privateLines, ...otherGroupLines].slice(0, 4);
    if (!lines.length) return "";
    return [
      "[Cross-context continuity]",
      "[Use only to continue tone/tasks for this speaker. Do not expose private details in group.]",
      ...lines,
    ].join("\n");
  }

  private getFilePath(userId: string): string {
    return path.join(this.dir, `${userId}.json`);
  }

  private load(userId: string): UserContinuityState {
    const filePath = this.getFilePath(userId);
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as UserContinuityState;
      }
    } catch (e) {
      this.log.warn?.(`[QQ] Continuity read error ${userId}: ${e}`);
    }
    return {
      userId,
      nickname: userId,
      updatedAt: 0,
      privateSnippets: [],
      groups: {},
    };
  }

  private save(state: UserContinuityState): void {
    try {
      fs.writeFileSync(this.getFilePath(state.userId), JSON.stringify(state, null, 2));
    } catch (e) {
      this.log.warn?.(`[QQ] Continuity write error ${state.userId}: ${e}`);
    }
  }

  private pushSnippet(existing: ContinuitySnippet[], text: string, limit: number): ContinuitySnippet[] {
    const next = [...existing, { text, timestamp: Date.now() }];
    return next.slice(-limit);
  }

  private pruneGroups(state: UserContinuityState): void {
    const recent = Object.values(state.groups)
      .filter((group) => Date.now() - group.updatedAt < this.ttlMs)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, this.maxGroupsPerUser);
    state.groups = Object.fromEntries(recent.map((group) => [group.groupId, group]));
  }
}
