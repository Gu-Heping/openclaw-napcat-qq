import type { NapCatAPI } from "../napcat/api.js";
import type { BotConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";
import type { QQMessage } from "../napcat/types.js";
import { MessageManager } from "../util/message-manager.js";
import { convertPlainAtToCq, expandInlineFaces } from "../util/cq-code.js";
import { toImageFileParam } from "../util/image-file-param.js";
import { normalizeMarkdownForQQ } from "../util/qq-text.js";

export class MessageSender {
  constructor(
    private api: NapCatAPI,
    private msgManager: MessageManager,
    private config: BotConfig,
    private log: PluginLogger,
  ) {}

  async send(
    target: string,
    isGroup: boolean,
    text: string,
    mediaUrl?: string,
  ): Promise<{ status: string; data?: unknown; message?: string; retcode?: number }> {
    const normalizedText = normalizeMarkdownForQQ(text);
    const doSend = async () => {
      if (mediaUrl) {
        const fileParam = toImageFileParam(mediaUrl, this.config.limits.imageMaxSize);
        const segments: unknown[] = [{ type: "image", data: { file: fileParam } }];
        if (normalizedText) segments.push({ type: "text", data: { text: normalizedText } });
        return isGroup
          ? await this.api.sendGroupMsg(target, segments)
          : await this.api.sendPrivateMsg(target, segments);
      }
      let content: string | unknown[] = normalizedText;
      if (isGroup) content = convertPlainAtToCq(normalizedText);
      content = expandInlineFaces(typeof content === "string" ? content : normalizedText);
      return isGroup
        ? await this.api.sendGroupMsg(target, content)
        : await this.api.sendPrivateMsg(target, content);
    };

    const { maxRetries, retryBaseDelayMs } = this.config.limits;
    let result: { status: string; data?: unknown; message?: string; retcode?: number } = { status: "failed" };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await doSend();
        if (result.status === "ok") break;
      } catch (e) {
        this.log.warn?.(`[QQ] Send attempt ${attempt}/${maxRetries} error: ${e}`);
      }
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, attempt * retryBaseDelayMs));
    }

    if (result.status === "ok") {
      const rMsgId = (result.data as Record<string, unknown>)?.message_id;
      if (rMsgId) {
        const sid = isGroup ? `g:${target}` : `p:${target}`;
        this.msgManager.add(String(rMsgId), sid, normalizedText, isGroup ? "group" : "private", target);
      }
      this.log.info(`[QQ] Reply sent to ${isGroup ? "group" : "user"} ${target}: ${normalizedText.slice(0, 60)}${normalizedText.length > 60 ? "…" : ""}`);
    } else {
      this.log.warn?.(`[QQ] Send failed after ${maxRetries} attempts to ${target}: ${result.message ?? result.retcode}`);
    }

    return result;
  }

  private buildReplySegments(messageId: string, text: string, mediaUrl?: string): string | unknown[] {
    const normalizedText = normalizeMarkdownForQQ(text);
    const segments: unknown[] = [{ type: "reply", data: { id: messageId } }];

    if (mediaUrl) {
      const fileParam = toImageFileParam(mediaUrl, this.config.limits.imageMaxSize);
      segments.push({ type: "image", data: { file: fileParam } });
    }

    if (normalizedText) {
      const content = expandInlineFaces(convertPlainAtToCq(normalizedText));
      if (typeof content === "string") {
        segments.push({ type: "text", data: { text: content } });
      } else {
        segments.push(...content);
      }
    }

    return segments;
  }

  async sendReply(msg: QQMessage, text: string): Promise<void> {
    const isGroup = msg.messageType === "group";
    const target = isGroup && msg.groupId ? msg.groupId : msg.userId;
    if (isGroup) {
      const result = await this.api.sendGroupMsg(target, this.buildReplySegments(msg.id, text));
      if (result.status === "ok") {
        const rMsgId = (result.data as Record<string, unknown>)?.message_id;
        if (rMsgId) {
          this.msgManager.add(String(rMsgId), `g:${target}`, normalizeMarkdownForQQ(text), "group", target);
        }
      } else {
        this.log.warn?.(`[QQ] Group reply-with-quote failed for ${target}: ${result.message ?? result.retcode}`);
      }
      return;
    }
    await this.send(target, isGroup, text);
  }
}
