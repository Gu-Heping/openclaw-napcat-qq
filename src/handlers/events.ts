import type { NapCatAPI } from "../napcat/api.js";
import type { BotConfig } from "../config.js";
import type { OneBotNoticeEvent, OneBotRequestEvent, QQMessage } from "../napcat/types.js";
import type { InboundHandler } from "./inbound.js";
import type { FileDownloader } from "../services/file-downloader.js";
import type { PluginLogger } from "../types-compat.js";
import type { ContactProfileStore } from "../services/contact-profile-store.js";
import { getSyntheticMessageId } from "../util/synthetic-id.js";

interface PendingRequest {
  type: "friend" | "group";
  flag: string;
  userId: string;
  comment: string;
  groupId?: string;
  subType?: string;
  createdAt: number;
}

let pendingRequests: PendingRequest[] = [];

export function getPendingRequests(): PendingRequest[] {
  return pendingRequests;
}
export function popByFlag(flag: string): PendingRequest | undefined {
  const idx = pendingRequests.findIndex((r) => r.flag === flag);
  if (idx === -1) return undefined;
  return pendingRequests.splice(idx, 1)[0];
}

export interface EventContext {
  api: NapCatAPI;
  config: BotConfig;
  log: PluginLogger;
  inbound: InboundHandler;
  fileDownloader: FileDownloader;
  contactProfiles?: ContactProfileStore;
}

export class EventHandler {
  private ctx: EventContext;

  constructor(ctx: EventContext) {
    this.ctx = ctx;
  }

  handleNotice(event: OneBotNoticeEvent): void {
    const { notice_type, sub_type } = event;

    if (notice_type === "group_increase") {
      if (event.group_id && event.user_id) {
        this.ctx.contactProfiles?.recordGroupMembership(String(event.group_id), String(event.user_id), undefined, "active");
      }
      this.ctx.log.info?.(`[QQ] 群 ${event.group_id} 新成员: ${event.user_id}`);
    } else if (notice_type === "group_decrease") {
      if (event.group_id && event.user_id) {
        this.ctx.contactProfiles?.recordGroupMembership(String(event.group_id), String(event.user_id), undefined, "left");
      }
      this.ctx.log.info?.(`[QQ] 群 ${event.group_id} 成员离开: ${event.user_id}`);
    } else if (notice_type === "friend_add") {
      if (event.user_id) {
        this.ctx.contactProfiles?.recordFriendAdded(String(event.user_id));
      }
      this.ctx.log.info?.(`[QQ] 新好友: ${event.user_id}`);
    } else if (notice_type === "offline_file") {
      this.handleOfflineFile(event);
    } else if (notice_type === "poke" || (notice_type === "notify" && sub_type === "poke")) {
      this.handlePoke(event);
    } else if (notice_type === "notify" && sub_type === "input_status") {
      // suppress
    } else {
      this.ctx.log.info?.(`[QQ] Notice: ${notice_type} ${JSON.stringify(event).slice(0, 200)}`);
    }
  }

  handleRequest(event: OneBotRequestEvent): void {
    const { request_type, user_id, comment, flag, group_id, sub_type } = event;
    if (!flag) return;

    const maxPending = this.ctx.config.limits.maxPendingRequests;

    if (request_type === "friend") {
      pendingRequests.push({
        type: "friend", flag, userId: String(user_id),
        comment: comment ?? "", createdAt: Date.now(),
      });
      this.ctx.log.info?.(`[QQ] 加好友请求: ${user_id} - ${comment}`);
    } else if (request_type === "group") {
      pendingRequests.push({
        type: "group", flag, userId: String(user_id),
        comment: comment ?? "",
        groupId: group_id ? String(group_id) : undefined,
        subType: sub_type, createdAt: Date.now(),
      });
      this.ctx.log.info?.(`[QQ] 加群请求: ${user_id} group=${group_id} sub=${sub_type}`);
    }

    if (pendingRequests.length > maxPending) pendingRequests.shift();
  }

  private handlePoke(event: OneBotNoticeEvent): void {
    const targetId = String(event.target_id ?? "");
    const selfId = String(event.self_id ?? "");
    const userId = String(event.user_id ?? "");
    const groupId = event.group_id ? String(event.group_id) : undefined;
    const botQQ = this.ctx.config.connection.selfId;

    const isPokeMe =
      (botQQ && (targetId === botQQ || (!targetId && selfId === botQQ))) ||
      (!botQQ && targetId && targetId === selfId);

    if (!isPokeMe || !userId) return;

    const raw = event.suffix ?? event.content ?? event.comment ?? event.text ?? event.poke_message;
    const pokeText = typeof raw === "string" ? raw.trim() : "";
    const content = pokeText ? `[用户戳了戳你，并说：${pokeText}]` : "[用户戳了戳你]";

    this.ctx.log.info?.(`[QQ] 戳一戳 → AI: ${userId}${groupId ? ` 群${groupId}` : ""}`);
    this.ctx.inbound.handleMessageEvent({
      post_type: "message",
      message_type: groupId ? "group" : "private",
      message_id: getSyntheticMessageId(),
      user_id: Number(userId),
      group_id: groupId ? Number(groupId) : undefined,
      message: [{ type: "text", data: { text: content } }],
      raw_message: content,
      sender: {},
      time: Math.floor(Date.now() / 1000),
      self_id: Number(this.ctx.config.connection.selfId || 0),
    });
  }

  private async handleOfflineFile(event: OneBotNoticeEvent): Promise<void> {
    const userId = String(event.user_id ?? "");
    const file = event.file;
    if (!userId || !file) return;

    const fileName = file.name ?? "未知文件";
    const fileSize = Number(file.size ?? 0);
    const fileUrl = file.url ?? "";
    const maxSize = this.ctx.config.limits.fileMaxSize;

    this.ctx.log.info?.(`[QQ] 离线文件: ${fileName} from ${userId} size=${fileSize} url=${fileUrl?.slice(0, 60)}`);

    let sizeStr = "";
    if (fileSize > 0) {
      if (fileSize < 1024) sizeStr = `, ${fileSize}B`;
      else if (fileSize < 1024 * 1024) sizeStr = `, ${(fileSize / 1024).toFixed(1)}KB`;
      else sizeStr = `, ${(fileSize / (1024 * 1024)).toFixed(1)}MB`;
    }

    let fileInfo = `[文件:${fileName}${sizeStr}]`;

    if (fileUrl && fileSize <= maxSize) {
      try {
        const downloaded = await this.ctx.fileDownloader.downloadToLocal(
          fileUrl, fileName, `user_${userId}`,
        );
        if (downloaded) {
          fileInfo += `\n[已下载到: ${downloaded.path}]`;
          if (downloaded.preview) fileInfo += `\n[文件内容预览:\n${downloaded.preview}\n]`;
        }
      } catch (e) {
        this.ctx.log.warn?.(`[QQ] File download error: ${e}`);
      }
    }

    this.ctx.inbound.handleMessageEvent({
      post_type: "message",
      message_type: "private",
      message_id: getSyntheticMessageId(),
      user_id: Number(userId),
      message: [{ type: "text", data: { text: fileInfo } }],
      raw_message: fileInfo,
      sender: { user_id: Number(userId), nickname: userId },
      time: Math.floor(Date.now() / 1000),
      self_id: Number(this.ctx.config.connection.selfId || 0),
    });
  }
}
