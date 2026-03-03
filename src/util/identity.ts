import type { QQMessage } from "../napcat/types.js";

/**
 * Build a lightweight identity block (~80-120 tokens) for the AI,
 * telling it who the current user is and where memory files are.
 */
export function buildIdentityBlock(msg: QQMessage): string {
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
