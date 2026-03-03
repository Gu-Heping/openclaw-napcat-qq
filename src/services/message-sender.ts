import type { NapCatAPI } from "../napcat/api.js";
import type { BotConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";
import type { QQMessage } from "../napcat/types.js";
import { MessageManager } from "../util/message-manager.js";
import { convertPlainAtToCq, expandInlineFaces } from "../util/cq-code.js";

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
    const doSend = async () => {
      if (mediaUrl) {
        const segments: unknown[] = [{ type: "image", data: { file: mediaUrl } }];
        if (text) segments.push({ type: "text", data: { text } });
        return isGroup
          ? await this.api.sendGroupMsg(target, segments)
          : await this.api.sendPrivateMsg(target, segments);
      }
      let content: string | unknown[] = text;
      if (isGroup) content = convertPlainAtToCq(text);
      content = expandInlineFaces(typeof content === "string" ? content : text);
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
        this.msgManager.add(String(rMsgId), sid, text, isGroup ? "group" : "private", target);
      }
      this.log.info(`[QQ] Reply sent to ${isGroup ? "group" : "user"} ${target}: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    } else {
      this.log.warn?.(`[QQ] Send failed after ${maxRetries} attempts to ${target}: ${result.message ?? result.retcode}`);
    }

    return result;
  }

  async sendReply(msg: QQMessage, text: string): Promise<void> {
    const isGroup = msg.messageType === "group";
    const target = isGroup && msg.groupId ? msg.groupId : msg.userId;
    await this.send(target, isGroup, text);
  }
}
