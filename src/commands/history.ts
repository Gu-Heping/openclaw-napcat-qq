import type { Command, CommandContext } from "./types.js";
import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";

export const historyCommand: Command = {
  names: ["history", "记录"],
  description: "查看最近发送的消息",
  execute(msg: QQMessage, _args: string, ctx: CommandContext): string {
    const sessionId = msg.messageType === "group" && msg.groupId ? `g:${msg.groupId}` : `p:${msg.userId}`;
    const recent = ctx.msgManager.getRecent(sessionId, 5);
    if (!recent.length) return t.historyEmpty;
    let result = `最近 ${recent.length} 条：\n`;
    for (let i = recent.length - 1; i >= 0; i--) {
      const m = recent[i];
      const time = new Date(m.timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      result += `${recent.length - i}. [${time}] ${m.content.slice(0, 36)}${m.content.length > 36 ? "…" : ""}\n`;
    }
    return result;
  },
};

export const clearHistoryCommand: Command = {
  names: ["clear_history", "清除历史"],
  description: "清除消息发送记录",
  execute(msg: QQMessage, _args: string, ctx: CommandContext): string {
    const sessionId = msg.messageType === "group" && msg.groupId ? `g:${msg.groupId}` : `p:${msg.userId}`;
    ctx.msgManager.clearSession(sessionId);
    return t.historyCleared;
  },
};
