import * as fs from "node:fs";
import * as crypto from "node:crypto";

/**
 * Appends a single "assistant" message line to an openclaw session jsonl file,
 * so that when the target user/group later chats, the AI sees that we had sent this content.
 * Matches the core's message line format (type, id, parentId, timestamp, message).
 */
export function appendAssistantMessageToSessionFile(filePath: string, text: string): void {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const now = new Date();
  const timestamp = now.toISOString();
  const timestampMs = now.getTime();

  const message = {
    type: "message",
    id,
    parentId: null as string | null,
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "qq-plugin-outbound",
      provider: "openclaw",
      model: "tool-send",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: timestampMs,
    },
  };

  const line = JSON.stringify(message) + "\n";
  fs.appendFileSync(filePath, line, "utf-8");
}
