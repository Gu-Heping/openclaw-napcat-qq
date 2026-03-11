import type { Command, CommandContext } from "./types.js";
import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";
import { MODEL_DISPLAY_NAMES } from "../config.js";
import { getLocalDateString } from "../util/date.js";
import { buildIdentityBlock, getSenderDisplayName } from "../util/identity.js";

export const clearCommand: Command = {
  names: ["clear", "清除", "new", "新会话", "reset"],
  description: "清空当前 AI 对话上下文",
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
  description: "先总结对话写入记忆，再清空会话",
  async execute(msg: QQMessage, _args: string, ctx: CommandContext): Promise<string> {
    const chatType = msg.messageType === "group" ? t.chatTypeGroup : t.chatTypePrivate;
    try {
      const sessionKey = ctx.resolveSessionKey(msg);
      const identityBlock = buildIdentityBlock(msg);
      const summary = await ctx.dispatchToAgent(msg, t.summaryPrompt, identityBlock);

      if (summary && msg.userId) {
        try {
          const now = getLocalDateString();
          const entry = `- [${now}] 对话总结: ${summary.replace(/\n/g, " ").slice(0, 200)}`;
          const nickname = getSenderDisplayName(msg);
          ctx.memoryManager.writeUserNote(msg.userId, nickname, t.sectionNotes, entry);
        } catch (e) {
          ctx.log.warn?.(`[QQ] write summary to memory failed: ${e}`);
        }
      }

      const ok = await ctx.resetSession(sessionKey);
      const memoryNote = summary ? "总结已写入长期记忆，" : "";
      return ok
        ? t.summaryResult(summary, memoryNote, chatType)
        : t.summaryNoSession(chatType);
    } catch (e) {
      ctx.log.warn?.(`[QQ] summary_clear error: ${e}`);
      return t.summaryFailed(e);
    }
  },
};

export const modelCommand: Command = {
  names: ["model", "模型"],
  description: "切换当前会话的模型",
  async execute(msg: QQMessage, args: string, ctx: CommandContext): Promise<string> {
    const arg = args.trim().toLowerCase();
    const sessionKey = ctx.resolveSessionKey(msg);
    const models = ctx.config.models;
    const choice = models[arg] || models["kimi"];
    if (!choice) return t.modelSwitchFailed;

    ctx.setModelOverride(sessionKey, choice[0], choice[1]);

    const ok = await ctx.persistSessionModel(sessionKey, choice[0], choice[1]);
    if (!ok) ctx.log.warn?.(`[QQ] Failed to persist model to sessions.json, in-memory override still active`);

    const name = MODEL_DISPLAY_NAMES[arg] ?? `${choice[0]}/${choice[1]}`;
    return t.modelSwitched(name);
  },
};
