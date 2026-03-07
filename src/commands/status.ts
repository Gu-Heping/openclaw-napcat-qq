import type { Command, CommandContext } from "./types.js";
import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";

export const statusCommand: Command = {
  names: ["status", "状态"],
  description: "查看运行状态",
  execute(msg: QQMessage, _args: string, ctx: CommandContext): string {
    const chatType = msg.messageType === "group" ? t.chatTypeGroup : t.chatTypePrivate;
    const sk = ctx.resolveSessionKey(msg);

    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const uptimeStr = h > 0 ? `${h}h${m}m` : `${m}m`;

    const hasEntry = ctx.hasSession(sk);

    return `${t.statusTitle}

运行: 正常 | 已运行: ${uptimeStr}
当前: ${chatType} | 会话key: ${sk.slice(-20)}
会话: ${hasEntry ? t.sessionAllocated : t.sessionNotAllocated}
发送记录: ${ctx.msgManager.size} 条 ${t.sentCountHint}`;
  },
};
