import type { NapCatAPI } from "../napcat/api.js";

export interface SentMessage {
  messageId: string;
  sessionId: string;
  content: string;
  timestamp: number;
  chatType: "private" | "group";
  targetId: string;
}

export class MessageManager {
  private messages: SentMessage[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  add(messageId: string, sessionId: string, content: string, chatType: "private" | "group", targetId: string) {
    this.messages.push({ messageId, sessionId, content, timestamp: Date.now() / 1000, chatType, targetId });
    if (this.messages.length > this.maxSize) this.messages.shift();
  }

  getRecent(sessionId: string, count = 5): SentMessage[] {
    return this.messages.filter((m) => m.sessionId === sessionId).slice(-count);
  }

  findByContent(sessionId: string, pattern: string): SentMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.sessionId === sessionId && m.content.includes(pattern)) return m;
    }
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].content.includes(pattern)) return this.messages[i];
    }
    return undefined;
  }

  async recall(messageId: string, api: NapCatAPI): Promise<string> {
    const result = await api.deleteMsg(messageId);
    return result.status === "ok" ? `消息 ${messageId} 已撤回` : `撤回失败: ${result.message ?? "未知错误"}`;
  }

  clearSession(sessionId: string): number {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => m.sessionId !== sessionId);
    return before - this.messages.length;
  }

  get size() {
    return this.messages.length;
  }
}
