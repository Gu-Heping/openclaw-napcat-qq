import type { Command, CommandContext } from "./types.js";
import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";
import { MODEL_DISPLAY_NAMES } from "../config.js";
import { buildIdentityBlock } from "../util/identity.js";

export const clearCommand: Command = {
  names: ["clear", "重置", "new", "新对话", "reset"],
  description: "清空当前会话上下文并重新开始",
  async execute(msg: QQMessage, _args: string, ctx: CommandContext): Promise<string> {
    const chatType = msg.messageType === "group" ? t.chatTypeGroup : t.chatTypePrivate;
    try {
      const sessionKey = ctx.resolveSessionKey(msg);
      const ok = await ctx.resetSession(sessionKey);
      return ok ? t.clearSuccess(chatType) : t.clearNoSession(chatType);
    } catch (e) {
      ctx.log.warn?.(`[QQ] clear session error: ${e}`);
      return t.clearFailed(e);
    }
  },
};

export const summaryClearCommand: Command = {
  names: ["summary_clear", "总结并清空"],
  description: "让 AI 把会话总结写入记忆后，再清空当前会话",
  async execute(msg: QQMessage, _args: string, ctx: CommandContext): Promise<string> {
    const chatType = msg.messageType === "group" ? t.chatTypeGroup : t.chatTypePrivate;
    try {
      const sessionKey = ctx.resolveSessionKey(msg);
      if (!ctx.hasSession(sessionKey)) {
        return t.summaryNoSession(chatType);
      }

      const identityBlock = buildIdentityBlock(msg);
      const result = await ctx.runSummaryClearTask(msg, identityBlock);
      if (!result.ok) {
        return `总结并清空失败: ${result.reason ?? "AI 未成功写入记忆，当前会话已保留。"} `;
      }

      const ok = await ctx.resetSession(sessionKey);
      if (!ok) {
        return `总结已写入记忆，但清空当前${chatType}会话失败，请稍后重试。`;
      }

      return `会话总结已写入记忆并清空当前${chatType}会话。\n\n${result.summary ?? "已完成总结。"}`
    } catch (e) {
      ctx.log.warn?.(`[QQ] summary_clear error: ${e}`);
      return t.summaryFailed(e);
    }
  },
};

export const modelCommand: Command = {
  names: ["model", "模型"],
  description: "切换当前会话使用的模型",
  async execute(msg: QQMessage, args: string, ctx: CommandContext): Promise<string> {
    const arg = args.trim().toLowerCase();
    const sessionKey = ctx.resolveSessionKey(msg);
    const models = ctx.config.models;
    const choice = models[arg] || models.kimi;
    if (!choice) return t.modelSwitchFailed;

    ctx.setModelOverride(sessionKey, choice[0], choice[1]);

    const ok = await ctx.persistSessionModel(sessionKey, choice[0], choice[1]);
    if (!ok) ctx.log.warn?.("[QQ] Failed to persist model to sessions.json, in-memory override still active");

    const name = MODEL_DISPLAY_NAMES[arg] ?? `${choice[0]}/${choice[1]}`;
    return t.modelSwitched(name);
  },
};
