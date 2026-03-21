import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";

/**
 * Build a lightweight identity block for the AI.
 * For **private chat**: full identity (who is speaking + memory paths + hints).
 * For **group chat**: only the "current speaker" line — the stable group header
 * is provided separately via `buildGroupHeader()` so that it appears once per
 * session rather than repeated in every history turn.
 */
export function buildIdentityBlock(msg: QQMessage, opts?: { selfId?: string }): string {
  const userId = msg.userId;
  const nickname = getSenderDisplayName(msg);
  const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;

  if (msg.messageType === "group" && msg.groupId) {
    return buildGroupTurnIdentity(msg);
  }

  const lines: string[] = [`[身份] ${nickname}(${userId}) 头像: ${avatarUrl}`];
  const paths = [`memory/users/${userId}.md`];
  paths.push("memory/social/relationships.md");
  lines.push(`[记忆] ${paths.join(" | ")}`);
  lines.push(t.identityHintPrivate);
  lines.push("[回复] 只输出要发给对方的那一句话或几句话，不要输出内心独白、推理过程、「用户说…」「我应该…」「让我…」等元描述；不要向用户提及「系统」「系统问你」「主动对话」等内部流程。");
  lines.push("[QQ] 表情：少用 Unicode emoji（如 😀🎉），多用 QQ 表情，格式为 [表情:名称]（如 [表情:微笑]、[表情:狗头]、[表情:赞]）。");
  lines.push("[表情包提示] 若本条消息是图片并且你判断其可能是表情包，可使用收藏相关能力；是否收藏由你自行判断。");
  lines.push("[表情包工具] 发送表情包时先用 sticker_search 检索，再用 sticker_send 发送；解释含义用 sticker_get_semantics，修订含义用 sticker_update_semantics 或 sticker_alias_add。不要只口头说“可以收藏/发送”而不实际调用工具。");

  if (msg.content?.startsWith("[QQ空间")) {
    lines.push(`[QQ空间事件] 回复评论用 qzone_comment（tid、content、reply_comment_id、reply_uin），勿用 qq_send_message 发工具名或参数。点赞 qzone_like，查评论 qzone_get_comments。`);
  }

  return lines.join("\n");
}

/**
 * Stable group header — included once in the current-turn context for group chats.
 * Tells the model it is the same bot across the whole group conversation.
 */
export function buildGroupHeader(groupId: string): string {
  const groupAvatar = `https://p.qlogo.cn/gh${groupId}/${groupId}/0`;
  return [
    `[群聊模式] 你是 QQ 群 ${groupId} 里的同一个机器人。以下为群内多人对话，请以群成员身份连贯参与，保持统一人格。`,
    `[群头像] ${groupAvatar}`,
    `[群记忆] memory/groups/${groupId}.md | memory/social/relationships.md`,
    t.identityHintGroup,
    `[回复] 只输出要发给群里的消息，不要输出内心独白、推理过程等元描述。`,
    `[QQ] 表情：少用 Unicode emoji，多用 QQ 表情（格式 [表情:名称]，如 [表情:狗头]、[表情:赞]）。`,
    `[表情包工具] 涉及表情包发送时先用 sticker_search，再用 sticker_send；解释或修订含义用 sticker_get_semantics / sticker_update_semantics / sticker_alias_add。不要只口头描述能力。`,
  ].join("\n");
}

/**
 * Per-turn identity for group chat — lightweight, only identifies who is
 * currently speaking and their personal memory path.  This is what gets
 * included in BodyForAgent (current turn only), NOT persisted into history.
 */
export function buildGroupTurnIdentity(msg: QQMessage): string {
  const nickname = getSenderDisplayName(msg);
  const userId = msg.userId;
  return `[当前发言者] ${nickname}(${userId}) 个人记忆: memory/users/${userId}.md`;
}

export function getSenderDisplayName(msg: QQMessage): string {
  return msg.sender.card || msg.sender.nickname || msg.userId;
}

export function getContextSummary(msg: QQMessage): string {
  const sender = getSenderDisplayName(msg);
  if (msg.messageType === "group" && msg.groupId) {
    return `[Group ${msg.groupId}] ${sender}(${msg.userId}): `;
  }
  return `[Private] ${sender}(${msg.userId}): `;
}

export function getSessionId(msg: QQMessage): string {
  if (msg.messageType === "group" && msg.groupId) {
    return `group_${msg.groupId}_user_${msg.userId}`;
  }
  return `user_${msg.userId}`;
}
