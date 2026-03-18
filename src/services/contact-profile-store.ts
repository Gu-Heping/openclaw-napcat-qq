import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginLogger } from "../types-compat.js";

interface UserProfile {
  userId: string;
  nickname: string;
  aliases: string[];
  groups: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastSeenIn: "private" | "group" | "event";
  friendAddedAt?: string;
}

interface GroupMemberProfile {
  userId: string;
  nickname: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "active" | "left";
}

interface GroupProfile {
  groupId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  memberCount: number;
  members: Record<string, GroupMemberProfile>;
}

type UserStore = Record<string, UserProfile>;
type GroupStore = Record<string, GroupProfile>;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeNickname(nickname: string | undefined, fallback: string): string {
  const trimmed = (nickname ?? "").trim();
  return trimmed || fallback;
}

export class ContactProfileStore {
  private readonly usersPath: string;
  private readonly groupsPath: string;
  private readonly log: PluginLogger;

  constructor(workspace: string, log: PluginLogger) {
    const dir = path.join(workspace, "memory", "_meta");
    fs.mkdirSync(dir, { recursive: true });
    this.usersPath = path.join(dir, "users.json");
    this.groupsPath = path.join(dir, "groups.json");
    this.log = log;
  }

  bootstrapFromMemoryFiles(): void {
    this.importUsersFromMemory();
    this.importGroupsFromMemory();
  }

  recordPrivateContact(userId: string, nickname?: string): void {
    const store = this.loadUsers();
    const now = nowIso();
    const displayName = normalizeNickname(nickname, userId);
    const existing = store[userId];
    if (existing) {
      existing.nickname = displayName;
      if (!existing.aliases.includes(displayName)) existing.aliases.unshift(displayName);
      existing.aliases = existing.aliases.slice(0, 10);
      existing.lastSeenAt = now;
      existing.lastSeenIn = "private";
    } else {
      store[userId] = {
        userId,
        nickname: displayName,
        aliases: [displayName],
        groups: [],
        firstSeenAt: now,
        lastSeenAt: now,
        lastSeenIn: "private",
      };
    }
    this.saveUsers(store);
  }

  recordGroupMessage(groupId: string, userId: string, nickname?: string): void {
    const users = this.loadUsers();
    const groups = this.loadGroups();
    const now = nowIso();
    const displayName = normalizeNickname(nickname, userId);

    const user = users[userId] ?? {
      userId,
      nickname: displayName,
      aliases: [displayName],
      groups: [],
      firstSeenAt: now,
      lastSeenAt: now,
      lastSeenIn: "group" as const,
    };
    user.nickname = displayName;
    if (!user.aliases.includes(displayName)) user.aliases.unshift(displayName);
    user.aliases = user.aliases.slice(0, 10);
    if (!user.groups.includes(groupId)) user.groups.push(groupId);
    user.groups.sort();
    user.lastSeenAt = now;
    user.lastSeenIn = "group";
    users[userId] = user;

    const group = groups[groupId] ?? {
      groupId,
      firstSeenAt: now,
      lastSeenAt: now,
      memberCount: 0,
      members: {},
    };
    const member = group.members[userId] ?? {
      userId,
      nickname: displayName,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "active" as const,
    };
    member.nickname = displayName;
    member.lastSeenAt = now;
    member.status = "active";
    group.members[userId] = member;
    group.lastSeenAt = now;
    group.memberCount = Object.values(group.members).filter((item) => item.status === "active").length;
    groups[groupId] = group;

    this.saveUsers(users);
    this.saveGroups(groups);
  }

  recordFriendAdded(userId: string, nickname?: string): void {
    const store = this.loadUsers();
    const now = nowIso();
    const displayName = normalizeNickname(nickname, userId);
    const user = store[userId] ?? {
      userId,
      nickname: displayName,
      aliases: [displayName],
      groups: [],
      firstSeenAt: now,
      lastSeenAt: now,
      lastSeenIn: "event" as const,
    };
    user.nickname = displayName;
    if (!user.aliases.includes(displayName)) user.aliases.unshift(displayName);
    user.aliases = user.aliases.slice(0, 10);
    user.friendAddedAt = now;
    user.lastSeenAt = now;
    user.lastSeenIn = "event";
    store[userId] = user;
    this.saveUsers(store);
  }

  recordGroupMembership(groupId: string, userId: string, nickname: string | undefined, status: "active" | "left"): void {
    const groups = this.loadGroups();
    const now = nowIso();
    const displayName = normalizeNickname(nickname, userId);
    const group = groups[groupId] ?? {
      groupId,
      firstSeenAt: now,
      lastSeenAt: now,
      memberCount: 0,
      members: {},
    };
    const member = group.members[userId] ?? {
      userId,
      nickname: displayName,
      firstSeenAt: now,
      lastSeenAt: now,
      status,
    };
    member.nickname = displayName;
    member.lastSeenAt = now;
    member.status = status;
    group.members[userId] = member;
    group.lastSeenAt = now;
    group.memberCount = Object.values(group.members).filter((item) => item.status === "active").length;
    groups[groupId] = group;
    this.saveGroups(groups);
  }

  getUserProfile(userId: string): UserProfile | null {
    return this.loadUsers()[userId] ?? null;
  }

  private loadUsers(): UserStore {
    return this.readJson<UserStore>(this.usersPath);
  }

  private loadGroups(): GroupStore {
    return this.readJson<GroupStore>(this.groupsPath);
  }

  private saveUsers(store: UserStore): void {
    this.writeJson(this.usersPath, store);
  }

  private saveGroups(store: GroupStore): void {
    this.writeJson(this.groupsPath, store);
  }

  private readJson<T>(filePath: string): T {
    try {
      if (!fs.existsSync(filePath)) return {} as T;
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch (e) {
      this.log.warn?.(`[QQ] Contact profile read error ${path.basename(filePath)}: ${e}`);
      return {} as T;
    }
  }

  private writeJson(filePath: string, data: unknown): void {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      this.log.warn?.(`[QQ] Contact profile write error ${path.basename(filePath)}: ${e}`);
    }
  }

  private importUsersFromMemory(): void {
    const dir = path.join(path.dirname(this.usersPath), "..", "users");
    if (!fs.existsSync(dir)) return;
    const store = this.loadUsers();
    let changed = false;

    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.endsWith(".md")) continue;
      const userId = fileName.replace(/\.md$/, "");
      if (!/^\d+$/.test(userId) || store[userId]) continue;
      const filePath = path.join(dir, fileName);
      let nickname = userId;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const heading = content.match(/^#\s+(.+?)\((\d+)\)/m);
        if (heading?.[1]) nickname = heading[1].trim();
      } catch { /* ignore */ }
      const now = nowIso();
      store[userId] = {
        userId,
        nickname,
        aliases: [nickname],
        groups: [],
        firstSeenAt: now,
        lastSeenAt: now,
        lastSeenIn: "event",
      };
      changed = true;
    }

    if (changed) this.saveUsers(store);
  }

  private importGroupsFromMemory(): void {
    const dir = path.join(path.dirname(this.groupsPath), "..", "groups");
    if (!fs.existsSync(dir)) return;
    const store = this.loadGroups();
    let changed = false;

    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.endsWith(".md")) continue;
      const groupId = fileName.replace(/\.md$/, "");
      if (!/^\d+$/.test(groupId) || store[groupId]) continue;
      const filePath = path.join(dir, fileName);
      const now = nowIso();
      const group: GroupProfile = {
        groupId,
        firstSeenAt: now,
        lastSeenAt: now,
        memberCount: 0,
        members: {},
      };

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const memberMatches = [...content.matchAll(/^- (.+?)\((\d+)\)/gm)];
        for (const match of memberMatches) {
          const userId = match[2];
          const nickname = match[1].trim();
          group.members[userId] = {
            userId,
            nickname,
            firstSeenAt: now,
            lastSeenAt: now,
            status: "active",
          };
        }
        group.memberCount = Object.keys(group.members).length;
      } catch { /* ignore */ }

      store[groupId] = group;
      changed = true;
    }

    if (changed) this.saveGroups(store);
  }
}
