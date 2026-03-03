import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";
import { convertPlainAtToCq, expandInlineFaces } from "../util/cq-code.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function createMessagingTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "qq_send_message",
      description: "发送 QQ 私聊消息。message 内可写 [表情:名称]。",
      parameters: {
        type: "object", required: ["user_id", "message"],
        properties: {
          user_id: { type: "string", description: "目标 QQ 号" },
          message: { type: "string", description: "消息内容" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const userId = String(params.user_id ?? "");
        const message = String(params.message ?? "");
        if (!userId || !message) return textResult("[错误] 缺少 user_id 或 message");
        const content = expandInlineFaces(message);
        const result = await ctx.api.sendPrivateMsg(userId, content);
        if (result.status === "ok" && ctx.msgManager) {
          const msgId = (result.data as Record<string, unknown>)?.message_id;
          if (msgId) ctx.msgManager.add(String(msgId), `p:${userId}`, message, "private", userId);
        }
        return textResult(result.status !== "ok" ? `发送结果: ${result.status}。原因: ${result.message ?? "未知"}` : "发送结果: ok");
      },
    },
    {
      name: "qq_send_group_message",
      description: "发送 QQ 群聊消息。message 内可写 @QQ号 或 @all 来 @群成员，也可写 [表情:名称]。",
      parameters: {
        type: "object", required: ["group_id", "message"],
        properties: {
          group_id: { type: "string", description: "目标群号" },
          message: { type: "string", description: "消息内容" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const groupId = String(params.group_id ?? "");
        const message = String(params.message ?? "");
        if (!groupId || !message) return textResult("[错误] 缺少 group_id 或 message");
        const withAt = convertPlainAtToCq(message);
        const content = expandInlineFaces(withAt);
        const result = await ctx.api.sendGroupMsg(groupId, content);
        if (result.status === "ok" && ctx.msgManager) {
          const msgId = (result.data as Record<string, unknown>)?.message_id;
          if (msgId) ctx.msgManager.add(String(msgId), `g:${groupId}`, message, "group", groupId);
        }
        return textResult(result.status !== "ok" ? `群消息发送结果: ${result.status}。原因: ${result.message ?? "未知"}` : "群消息发送结果: ok");
      },
    },
    {
      name: "qq_send_poke",
      description: "戳一戳。私聊提供 user_id，群聊提供 group_id + target_qq。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "私聊戳一戳目标 QQ 号" },
          group_id: { type: "string", description: "群号" },
          target_qq: { type: "string", description: "群内被戳者 QQ 号" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const groupId = params.group_id ? String(params.group_id) : undefined;
        const targetQq = params.target_qq ? String(params.target_qq) : userId;
        if (groupId) {
          if (!targetQq) return textResult("[错误] 群聊戳一戳需提供 target_qq");
          const result = await ctx.api.groupPoke(groupId, targetQq);
          return textResult(result.status === "ok" ? `已戳一戳 群${groupId} 用户${targetQq}` : `发送失败: ${result.message}`);
        }
        if (userId) {
          const result = await ctx.api.friendPoke(userId);
          return textResult(result.status === "ok" ? `已戳一戳 ${userId}` : `发送失败: ${result.message}`);
        }
        return textResult("[错误] 需要 user_id 或 group_id");
      },
    },
    {
      name: "qq_recall_message",
      description: "撤回已发送的消息。通过 message_id 或 content_pattern（内容关键词）匹配。",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "消息 ID" },
          content_pattern: { type: "string", description: "消息内容关键词" },
          session_id: { type: "string", description: "会话 ID（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api || !ctx.msgManager) return textResult("[错误] 未初始化");
        const messageId = params.message_id ? String(params.message_id) : undefined;
        const pattern = params.content_pattern ? String(params.content_pattern) : undefined;
        const sessionId = params.session_id ? String(params.session_id) : "";
        if (messageId) return textResult(await ctx.msgManager.recall(messageId, ctx.api));
        if (pattern) {
          const found = ctx.msgManager.findByContent(sessionId, pattern);
          if (found) return textResult(await ctx.msgManager.recall(found.messageId, ctx.api));
          return textResult(`未找到包含 '${pattern}' 的消息`);
        }
        return textResult("[错误] 需要 message_id 或 content_pattern");
      },
    },
    {
      name: "qq_get_recent_messages",
      description: "查看 Bot 最近发送的消息记录",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "会话 ID（如 p:QQ号 或 g:群号），不填则全部" },
          count: { type: "number", description: "返回条数，默认 5" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.msgManager) return textResult("[错误] 未初始化");
        const sessionId = params.session_id ? String(params.session_id) : "";
        const count = Number(params.count ?? 5);
        const recent = ctx.msgManager.getRecent(sessionId, count);
        if (!recent.length) return textResult("暂无发送记录");
        const lines = recent.map((m) => {
          const time = new Date(m.timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
          return `[${time}] (${m.messageId}) ${m.content.slice(0, 50)}${m.content.length > 50 ? "…" : ""}`;
        });
        return textResult(`最近 ${lines.length} 条:\n${lines.join("\n")}`);
      },
    },
  ];
}
