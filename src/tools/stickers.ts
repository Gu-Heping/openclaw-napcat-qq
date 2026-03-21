import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

function parseTextArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

export function createStickerTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "sticker_search",
      description: "按语义关键词检索已收藏表情包，返回可发送的 sticker_id。",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "检索关键词，例如：无语/赞同/笑哭" },
          top_k: { type: "number", description: "返回数量，默认 5" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const query = String(params.query ?? "").trim();
        const topK = Number(params.top_k ?? 5);
        if (!query) return textResult("[错误] 缺少 query");
        const rows = store.search(query, topK);
        if (!rows.length) return textResult("未找到匹配表情包");
        const lines = rows.map((r) => {
          return `${r.id} | ${r.semantics.title} | ${r.semantics.meaning} | aliases=${r.semantics.aliases.join(",") || "-"}`;
        });
        return textResult(lines.join("\n"));
      },
    },
    {
      name: "sticker_send",
      description: "发送已收藏表情包。私聊传 user_id，群聊传 group_id。",
      parameters: {
        type: "object",
        required: ["sticker_id"],
        properties: {
          sticker_id: { type: "string", description: "sticker_search 返回的 ID" },
          user_id: { type: "string", description: "私聊目标 QQ" },
          group_id: { type: "string", description: "群号" },
          text: { type: "string", description: "可选附带文本" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store || !ctx.messageSender) return textResult("[错误] 未初始化");
        const stickerId = String(params.sticker_id ?? "").trim();
        if (!stickerId) return textResult("[错误] 缺少 sticker_id");
        const record = store.getById(stickerId);
        if (!record) return textResult("[错误] sticker_id 不存在");
        const userId = String(params.user_id ?? "").trim();
        const groupId = String(params.group_id ?? "").trim();
        if (!userId && !groupId) return textResult("[错误] 需要 user_id 或 group_id");
        const target = groupId || userId;
        const isGroup = Boolean(groupId);
        const outPath = store.resolveFilePath(record);
        const text = String(params.text ?? "");
        const res = await ctx.messageSender.send(target, isGroup, text, outPath);
        if (res.status === "ok") {
          store.incrementUsage(stickerId);
          return textResult("发送成功");
        }
        return textResult(`发送失败: ${res.message ?? res.retcode ?? "unknown"}`);
      },
    },
    {
      name: "sticker_get_semantics",
      description: "读取表情包语义定义与历史。",
      parameters: {
        type: "object",
        required: ["sticker_id"],
        properties: {
          sticker_id: { type: "string", description: "表情包 ID" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const stickerId = String(params.sticker_id ?? "");
        const rec = store.getById(stickerId);
        if (!rec) return textResult("[错误] 未找到该表情包");
        return textResult(JSON.stringify({
          id: rec.id,
          semantics: rec.semantics,
          semanticHistory: rec.semanticHistory.slice(-10),
        }, null, 2));
      },
    },
    {
      name: "sticker_update_semantics",
      description: "更新表情包语义（支持自动或人工指导来源）。",
      parameters: {
        type: "object",
        required: ["sticker_id", "reason"],
        properties: {
          sticker_id: { type: "string", description: "表情包 ID" },
          reason: { type: "string", description: "变更原因" },
          source: { type: "string", description: "auto 或 user-guided" },
          title: { type: "string" },
          meaning: { type: "string" },
          emotion_tags: { type: "array", items: { type: "string" } },
          intent_tags: { type: "array", items: { type: "string" } },
          use_when: { type: "array", items: { type: "string" } },
          avoid_when: { type: "array", items: { type: "string" } },
          aliases: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const stickerId = String(params.sticker_id ?? "");
        const reason = String(params.reason ?? "");
        const source = String(params.source ?? "auto") === "user-guided" ? "user-guided" : "auto";
        const rec = store.updateSemantics(stickerId, {
          title: params.title ? String(params.title) : undefined,
          meaning: params.meaning ? String(params.meaning) : undefined,
          emotionTags: parseTextArray(params.emotion_tags),
          intentTags: parseTextArray(params.intent_tags),
          useWhen: parseTextArray(params.use_when),
          avoidWhen: parseTextArray(params.avoid_when),
          aliases: parseTextArray(params.aliases),
          confidence: params.confidence != null ? Number(params.confidence) : undefined,
        }, reason, source);
        if (!rec) return textResult("[错误] 更新失败或表情不存在");
        return textResult(`已更新 ${rec.id}: ${rec.semantics.title}`);
      },
    },
    {
      name: "sticker_alias_add",
      description: "给表情包追加检索别名。",
      parameters: {
        type: "object",
        required: ["sticker_id", "alias"],
        properties: {
          sticker_id: { type: "string", description: "表情包 ID" },
          alias: { type: "string", description: "别名" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const rec = store.addAlias(String(params.sticker_id ?? ""), String(params.alias ?? ""));
        if (!rec) return textResult("[错误] 添加别名失败");
        return textResult(`已添加别名，当前 aliases=${rec.semantics.aliases.join(", ")}`);
      },
    },
  ];
}
