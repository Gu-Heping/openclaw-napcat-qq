import type { QQMessage } from "../napcat/types.js";

/**
 * Build a lightweight identity block (~80-120 tokens) for the AI,
 * telling it who the current user is and where memory files are.
 */
export function buildIdentityBlock(msg: QQMessage, opts?: { selfId?: string }): string {
  const userId = msg.userId;
  const nickname = getSenderDisplayName(msg);
  const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;

  const lines: string[] = [`[身份] ${nickname}(${userId}) 头像: ${avatarUrl}`];
  const paths = [`memory/users/${userId}.md`];

  if (msg.messageType === "group" && msg.groupId) {
    const groupAvatar = `https://p.qlogo.cn/gh${msg.groupId}/${msg.groupId}/0`;
    lines.push(`[群聊] ${msg.groupId} 群头像: ${groupAvatar}`);
    paths.push(`memory/groups/${msg.groupId}.md`);
  }

  paths.push("memory/social/relationships.md");
  lines.push(`[记忆] ${paths.join(" | ")}`);
  lines.push("[提示] 用 memory_search 语义检索记忆，用 write 更新记忆文件");
  lines.push("[回复] 只输出要发给对方的那一句话或几句话，不要输出内心独白、推理过程、「用户说…」「我应该…」「让我…」等元描述；不要向用户提及「系统」「系统问你」「主动对话」等内部流程。");

  if (msg.content?.startsWith("[QQ空间")) {
    const myQQ = opts?.selfId || userId;
    lines.push(`[QQ空间事件] 这是QQ空间推送。你可以用 qzone_comment(user_id="${myQQ}", tid=..., content=...) 回复评论，qzone_like 点赞回赞，qzone_get_comments 查看完整评论。说说ID(tid)在消息中。互动日志: memory/qzone/feeds/`);
  }

  return lines.join("\n");
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
