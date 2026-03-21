import type { NapCatAPI } from "../napcat/api.js";
import type { OneBotMessageEvent, QQMessage } from "../napcat/types.js";
import type { BotConfig, ChannelPolicyConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";
import type { MessageSender } from "../services/message-sender.js";
import type { MemoryManager } from "../services/memory-manager.js";
import type { FileDownloader } from "../services/file-downloader.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";
import type { CrossContextCache } from "../services/cross-context-cache.js";
import type { ContactProfileStore } from "../services/contact-profile-store.js";
import type { ContinuityStore } from "../services/continuity-store.js";
import { parseMessageEvent } from "../napcat/parse.js";
import { buildIdentityBlock, getContextSummary, getSenderDisplayName } from "../util/identity.js";
import { getFaceName } from "../napcat/face-map.js";
import { zh as t } from "../locale/zh.js";

export interface InboundDeps {
  config: BotConfig;
  api: NapCatAPI;
  log: PluginLogger;
  sender: MessageSender;
  memoryManager: MemoryManager;
  fileDownloader: FileDownloader;
  commandRegistry: CommandRegistry;
  cmdCtx: CommandContext;
  crossContextCache?: CrossContextCache;
  contactProfiles?: ContactProfileStore;
  continuityStore?: ContinuityStore;
  resolveSessionKey: (msg: QQMessage) => string;
  dispatchToAgent: (msg: QQMessage, body: string, identityBlock: string) => Promise<string | null>;
}

interface PendingPrivateMessage {
  msg: QQMessage;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  done: Promise<void>;
}

export class InboundHandler {
  private recentIds = new Map<string, number>();
  private groupLastReply = new Map<string, number>();
  private lastMsgTime = new Map<string, number>();
  private turnCounts = new Map<string, number>();
  private pendingPrivateMessages = new Map<string, PendingPrivateMessage>();
  private deps: InboundDeps;

  constructor(deps: InboundDeps) {
    this.deps = deps;
    setInterval(() => this.cleanupDedup(), 30_000);
  }

  async handleMessageEvent(event: OneBotMessageEvent): Promise<void> {
    const { config } = this.deps;
    const msg = parseMessageEvent(event, config.connection.selfId);

    if (this.isDuplicate(msg.id)) return;

    if (this.shouldBufferPrivateMessage(msg)) {
      await this.bufferPrivateMessage(msg);
      return;
    }

    const buffered = await this.flushPendingPrivateMessage(msg.userId);
    if (!buffered && this.isRateLimited(msg)) return;

    await this.handleParsedMessage(msg);
  }

  private shouldBufferPrivateMessage(msg: QQMessage): boolean {
    if (msg.messageType !== "private") return false;
    if (msg.content.trim().startsWith("/")) return false;
    if (msg.files.length > 0 || msg.imageUrls.length > 0) return false;
    const senderName = getSenderDisplayName(msg);
    if (senderName === "system" || senderName === "QZone") return false;
    return true;
  }

  private async bufferPrivateMessage(msg: QQMessage): Promise<void> {
    const key = msg.userId;
    const existing = this.pendingPrivateMessages.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.msg.content = `${existing.msg.content}\n${msg.content}`.trim();
      existing.msg.rawMessage = existing.msg.rawMessage
        ? `${existing.msg.rawMessage}\n${msg.rawMessage || msg.content}`.trim()
        : msg.rawMessage || msg.content;
      existing.msg.id = msg.id;
      existing.msg.timestamp = msg.timestamp;
      existing.msg.sender = msg.sender;
      existing.timer = this.createPrivateMessageTimer(key);
      return existing.done;
    }

    let resolve!: () => void;
    const done = new Promise<void>((r) => {
      resolve = r;
    });
    this.pendingPrivateMessages.set(key, {
      msg,
      timer: this.createPrivateMessageTimer(key),
      resolve,
      done,
    });
    await done;
  }

  private createPrivateMessageTimer(userId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.flushPendingPrivateMessage(userId).catch((e) => {
        this.deps.log.warn?.(`[QQ] Flush private buffer failed for ${userId}: ${e}`);
      });
    }, 1500);
  }

  private async flushPendingPrivateMessage(userId: string): Promise<boolean> {
    const pending = this.pendingPrivateMessages.get(userId);
    if (!pending) return false;
    this.pendingPrivateMessages.delete(userId);
    clearTimeout(pending.timer);
    try {
      if (this.isRateLimited(pending.msg)) return true;
      await this.handleParsedMessage(pending.msg);
      return true;
    } finally {
      pending.resolve();
    }
  }

  private async handleParsedMessage(msg: QQMessage): Promise<void> {
    const { config, log, sender, memoryManager, commandRegistry, cmdCtx } = this.deps;

    if (config.channelPolicy && !this.isAllowedByPolicy(msg, config.channelPolicy)) {
      log.info?.(
        `[QQ] Policy denied ${msg.messageType === "group" ? `group ${msg.groupId}` : "private"} from ${msg.userId}`,
      );
      return;
    }

    log.info?.(
      `[QQ] ${msg.messageType === "group" ? `group ${msg.groupId}` : "private"} ` +
      `${getSenderDisplayName(msg)}(${msg.userId}): ${msg.content.slice(0, 60)}`,
    );

    if (msg.messageType === "group" && msg.groupId) {
      this.deps.contactProfiles?.recordGroupMessage(msg.groupId, msg.userId, getSenderDisplayName(msg));
    } else {
      this.deps.contactProfiles?.recordPrivateContact(msg.userId, getSenderDisplayName(msg));
    }

    memoryManager.autoUpdateContextMemory(
      msg.userId,
      getSenderDisplayName(msg),
      msg.messageType === "group" ? msg.groupId : undefined,
    );

    if (msg.messageType === "group" && msg.groupId && this.deps.crossContextCache) {
      this.deps.crossContextCache.push(
        msg.userId, msg.groupId, getSenderDisplayName(msg), msg.content,
      );
    }

    if (msg.messageType === "group" && msg.groupId) {
      this.deps.continuityStore?.recordGroupMessage(
        msg.userId,
        msg.groupId,
        getSenderDisplayName(msg),
        msg.content,
      );
    } else {
      this.deps.continuityStore?.recordPrivateMessage(
        msg.userId,
        getSenderDisplayName(msg),
        msg.content,
      );
    }

    if (msg.messageType === "group" && msg.atBot) {
      msg.content = this.cleanAtMessage(msg.content, config.connection.selfId);
    }

    const cmdReply = commandRegistry.execute(msg, cmdCtx);
    if (cmdReply != null) {
      const reply = await cmdReply;
      await sender.sendReply(msg, reply);
      return;
    }

    if (msg.messageType === "group" && !this.shouldRespondInGroup(msg)) {
      return;
    }

    try {
      this.deps.api.setInputStatus(msg.userId, 1).catch(() => {});
    } catch {
      // ignore
    }

    if (msg.files.length > 0) {
      await this.tryDownloadFiles(msg);
    }

    await this.tryFetchForwardMessages(msg);
    await this.tryFetchReplyMessage(msg);

    const contextPrefix = getContextSummary(msg);
    const identityBlock = buildIdentityBlock(msg, { selfId: config.connection.selfId });
    let body = contextPrefix + msg.content;

    if (msg.messageType === "group" && !msg.atBot) {
      body = t.groupMessagePrefix + body;
    } else if (msg.messageType === "private") {
      body = t.privateMessagePrefix + body;
    }

    await this.deps.dispatchToAgent(msg, body, identityBlock);

    const sk = this.deps.resolveSessionKey(msg);
    this.turnCounts.set(sk, (this.turnCounts.get(sk) ?? 0) + 1);

    if (msg.messageType === "group" && msg.groupId) {
      this.groupLastReply.set(msg.groupId, Date.now());
    }
  }

  private isAllowedByPolicy(msg: QQMessage, policy: ChannelPolicyConfig): boolean {
    const allowFrom = (policy.allowFrom ?? []).map((e) => String(e).trim());
    const groupAllowFrom = (policy.groupAllowFrom ?? []).map((e) => String(e).trim());

    if (msg.messageType === "group" && msg.groupId) {
      const gp = policy.groupPolicy ?? "open";
      if (gp === "disabled") return false;
      if (gp === "open") return true;
      if (gp === "allowlist") {
        if (groupAllowFrom.includes("*")) return true;
        return groupAllowFrom.includes(msg.groupId);
      }
      return false;
    }

    const dm = policy.dmPolicy ?? "open";
    if (dm === "disabled") return false;
    const senderId = msg.userId;
    if (dm === "open") {
      if (allowFrom.includes("*")) return true;
      return allowFrom.length === 0 || allowFrom.includes(senderId);
    }
    if (dm === "allowlist" || dm === "pairing") {
      if (allowFrom.includes("*")) return true;
      return allowFrom.includes(senderId);
    }
    return true;
  }

  private isDuplicate(id: string): boolean {
    if (this.recentIds.has(id)) return true;
    this.recentIds.set(id, Date.now());
    return false;
  }

  private getRateLimitKey(msg: QQMessage): string {
    if (msg.messageType === "group" && msg.groupId) {
      return `group:${msg.groupId}:user:${msg.userId}`;
    }
    return `private:${msg.userId}`;
  }

  private isRateLimited(msg: QQMessage): boolean {
    const now = Date.now();
    const key = this.getRateLimitKey(msg);
    const last = this.lastMsgTime.get(key) ?? 0;
    if (now - last < this.deps.config.behavior.minIntervalMs) return true;
    this.lastMsgTime.set(key, now);
    return false;
  }

  private cleanupDedup(): void {
    const now = Date.now();
    const ttl = this.deps.config.behavior.dedupTtlMs;
    for (const [id, ts] of this.recentIds) {
      if (now - ts > ttl) this.recentIds.delete(id);
    }
    for (const [uid, ts] of this.lastMsgTime) {
      if (now - ts > 60_000) this.lastMsgTime.delete(uid);
    }
  }

  private shouldRespondInGroup(msg: QQMessage): boolean {
    if (msg.atBot) return true;
    const content = msg.content.toLowerCase();
    const {
      botNames,
      helpKeywords,
      questionPatterns,
      groupReplyProbInConvo,
      groupReplyProbRandom,
      groupReplyWindowMs,
    } = this.deps.config.behavior;

    if (botNames.some((n) => content.includes(n))) return true;
    if (helpKeywords.some((w) => content.includes(w))) return true;

    const isQuestion = content.length > 4 && questionPatterns.some((k) => content.includes(k));
    if (isQuestion) return true;

    const inConvo =
      msg.groupId &&
      Date.now() - (this.groupLastReply.get(msg.groupId) ?? 0) < groupReplyWindowMs;
    if (inConvo) return Math.random() < groupReplyProbInConvo;

    return Math.random() < groupReplyProbRandom;
  }

  private cleanAtMessage(text: string, selfId: string): string {
    return text.replace(new RegExp(`@${selfId}\\s*`, "g"), "").trim();
  }

  private async tryFetchForwardMessages(msg: QQMessage): Promise<void> {
    const forwardRe = /\[转发消息:([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    const ids: string[] = [];
    while ((match = forwardRe.exec(msg.content)) !== null) {
      if (match[1]) ids.push(match[1]);
    }
    if (!ids.length) return;

    for (const fwdId of ids.slice(0, 3)) {
      try {
        const result = await this.deps.api.getForwardMsg(fwdId);
        if (result.status !== "ok" || !result.data) continue;
        const messages =
          (result.data as Record<string, unknown>).messages ??
          (result.data as Record<string, unknown>).message;
        if (!Array.isArray(messages)) continue;

        const lines: string[] = [];
        for (const m of (messages as Array<Record<string, unknown>>).slice(0, 10)) {
          const sender = m.sender as Record<string, unknown> | undefined;
          const name = sender?.nickname ?? sender?.card ?? "未知";
          const segs = m.message ?? m.content;
          let text = "";
          if (Array.isArray(segs)) {
            text = (segs as Array<Record<string, unknown>>)
              .filter((s) => s.type === "text")
              .map((s) => (s.data as Record<string, unknown>)?.text ?? "")
              .join("");
          } else if (typeof segs === "string") {
            text = segs;
          }
          if (text) lines.push(`${name}: ${text.slice(0, 200)}`);
        }
        if (lines.length) {
          const summary = `[转发消息内容 (${lines.length} 条):\n${lines.join("\n")}\n]`;
          msg.content = msg.content.replace(`[转发消息:${fwdId}]`, summary);
        }
      } catch (e) {
        this.deps.log.warn?.(`[QQ] Fetch forward ${fwdId} failed: ${e}`);
      }
    }
  }

  private async tryFetchReplyMessage(msg: QQMessage): Promise<void> {
    const replyRe = /\[回复消息:([^\]]+)\]/g;
    const ids: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = replyRe.exec(msg.content)) !== null) {
      if (match[1]) ids.push(match[1]);
    }
    if (!ids.length) return;

    for (const replyId of ids.slice(0, 3)) {
      try {
        const result = await this.deps.api.getMsg(replyId);
        if (result.status !== "ok" || !result.data) continue;
        const d = result.data as Record<string, unknown>;
        const raw = d.message;
        let text = "";
        if (typeof raw === "string") {
          text = raw.replace(/\[CQ:[^\]]+\]/g, "").trim().slice(0, 500);
        } else if (Array.isArray(raw)) {
          const parts = (raw as Array<Record<string, unknown>>).map((seg) => {
            if (seg.type === "text") return String((seg.data as Record<string, unknown>)?.text ?? "");
            if (seg.type === "face") {
              return `[表情:${getFaceName(String((seg.data as Record<string, unknown>)?.id ?? ""))}]`;
            }
            return "";
          });
          text = parts.join("").trim().slice(0, 500);
        }
        const replacement = text
          ? `[引用消息内容: ${text}]`
          : `[引用消息: 无法获取原文 (id=${replyId})]`;
        msg.content = msg.content.replace(`[回复消息:${replyId}]`, replacement);
      } catch (e) {
        this.deps.log.warn?.(`[QQ] Fetch reply ${replyId} failed: ${e}`);
        msg.content = msg.content.replace(
          `[回复消息:${replyId}]`,
          `[引用消息: 获取失败 (id=${replyId})]`,
        );
      }
    }
  }

  private async tryDownloadFiles(msg: QQMessage): Promise<void> {
    const { fileDownloader, api, log, config } = this.deps;
    const maxSize = config.limits.fileMaxSize;

    for (const file of msg.files) {
      const resolved = await fileDownloader.resolveFileUrl(
        api,
        file.fileId,
        file.url,
        file.name || "未知文件",
      );
      if (resolved.url) file.url = resolved.url;
      file.name = resolved.name;

      if (!file.url || file.size > maxSize) continue;

      const subDir = msg.messageType === "group" ? `group_${msg.groupId}` : `user_${msg.userId}`;
      const result = await fileDownloader.downloadToLocal(file.url, file.name, subDir);

      if (result) {
        msg.content += `\n[已下载到: ${result.path}]`;
        if (result.preview) {
          msg.content += `\n[文件内容预览:\n${result.preview}\n]`;
        }
        log.info?.(`[QQ] Downloaded file ${file.name} to ${result.path}`);
      }
    }
  }
}
