/**
 * Short-lived in-memory cache of each user's recent group messages.
 * Used to inject a user's own recent group activity into their private chat context,
 * enabling continuity between group and private conversations.
 */

export interface CachedGroupMessage {
  groupId: string;
  nickname: string;
  content: string;
  timestamp: number;
}

export class CrossContextCache {
  /** key = userId, value = ring buffer of recent messages across all groups */
  private perUser = new Map<string, CachedGroupMessage[]>();
  private maxPerUser: number;
  private ttlMs: number;

  constructor(opts?: { maxPerUser?: number; ttlMs?: number }) {
    this.maxPerUser = opts?.maxPerUser ?? 15;
    this.ttlMs = opts?.ttlMs ?? 10 * 60_000;
  }

  /**
   * Record a group message sent by a user (called from inbound on every group msg).
   */
  push(userId: string, groupId: string, nickname: string, content: string): void {
    let buf = this.perUser.get(userId);
    if (!buf) {
      buf = [];
      this.perUser.set(userId, buf);
    }
    buf.push({ groupId, nickname, content: content.slice(0, 300), timestamp: Date.now() });
    if (buf.length > this.maxPerUser) buf.shift();
  }

  /**
   * Retrieve a user's recent group messages (for injection into private chat).
   * Returns newest-first, already filtered by TTL.
   */
  getRecentForUser(userId: string, limit = 5): CachedGroupMessage[] {
    const buf = this.perUser.get(userId);
    if (!buf?.length) return [];
    const cutoff = Date.now() - this.ttlMs;
    const valid = buf.filter((m) => m.timestamp > cutoff);
    return valid.slice(-limit).reverse();
  }

  /**
   * Build a context snippet for a private chat turn, summarising the user's
   * recent group activity. Returns empty string if nothing relevant.
   */
  buildPrivateChatSupplement(userId: string): string {
    const recent = this.getRecentForUser(userId, 5);
    if (!recent.length) return "";
    const lines = recent.map((m) => `  [Group ${m.groupId}] ${m.nickname}: ${m.content}`);
    return [
      "[近期群发言（仅作本次私聊参考，不写入长期记忆）]",
      ...lines,
    ].join("\n");
  }

  /** Periodic cleanup — remove expired entries to avoid unbounded growth. */
  cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [userId, buf] of this.perUser) {
      const valid = buf.filter((m) => m.timestamp > cutoff);
      if (valid.length === 0) this.perUser.delete(userId);
      else this.perUser.set(userId, valid);
    }
  }
}
