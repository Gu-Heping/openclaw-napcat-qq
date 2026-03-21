import type { PluginContext } from "../context.js";
import type { QQMessage } from "../napcat/types.js";

export function pushStickerReplyTarget(ctx: PluginContext, msg: QQMessage): void {
  const isGroup = msg.messageType === "group" && msg.groupId;
  ctx.stickerReplyStack.push(
    isGroup ? { groupId: msg.groupId! } : { userId: msg.userId },
  );
}

export function popStickerReplyTarget(ctx: PluginContext): void {
  ctx.stickerReplyStack.pop();
}

export function peekStickerReplyTarget(
  ctx: PluginContext,
): { userId?: string; groupId?: string } | undefined {
  const s = ctx.stickerReplyStack;
  return s.length > 0 ? s[s.length - 1] : undefined;
}

export function formatStickerSendParamHint(
  target: { userId?: string; groupId?: string } | undefined,
): string {
  if (!target) return "";
  if (target.groupId) {
    return `[sticker_send 参数提示] 当前群会话请传 group_id="${target.groupId}"（与 sticker_id 一起）。`;
  }
  if (target.userId) {
    return `[sticker_send 参数提示] 当前私聊请传 user_id="${target.userId}"（与 sticker_id 一起）。`;
  }
  return "";
}
