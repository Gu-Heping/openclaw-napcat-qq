import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function createConfidentialTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "add_confidential_note",
      description:
        "记录关于某人的保密备注（例如有人私下对你提到某人的情况）。" +
        "内容中不要包含信息来源（谁说的），只写事实或评价。" +
        "此信息将在你与该人互动时自动注入，帮助你调整态度与分寸，" +
        "但绝不可在群内或对当事人复述、引用或透露来源。",
      parameters: {
        type: "object",
        required: ["about_user_id", "content"],
        properties: {
          about_user_id: {
            type: "string",
            description: "被记录者的 QQ 号",
          },
          content: {
            type: "string",
            description: "保密备注内容（不要包含谁说的）",
          },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.confidentialNotes) return textResult("[错误] 保密备注服务未初始化");
        const aboutUserId = String(params.about_user_id ?? "").trim();
        const content = String(params.content ?? "").trim();
        if (!aboutUserId || !content) return textResult("[错误] 缺少 about_user_id 或 content");
        ctx.confidentialNotes.addNote(aboutUserId, content);
        return textResult(`已记录关于 ${aboutUserId} 的保密备注。此信息将在与该用户互动时自动参考，不会透露来源。`);
      },
    },
    {
      name: "get_confidential_notes",
      description: "查看关于某人的保密备注（仅供你参考，切勿向任何人透露内容或来源）。",
      parameters: {
        type: "object",
        required: ["about_user_id"],
        properties: {
          about_user_id: {
            type: "string",
            description: "要查看备注的 QQ 号",
          },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.confidentialNotes) return textResult("[错误] 保密备注服务未初始化");
        const aboutUserId = String(params.about_user_id ?? "").trim();
        if (!aboutUserId) return textResult("[错误] 缺少 about_user_id");
        const notes = ctx.confidentialNotes.getNotesForUser(aboutUserId);
        return textResult(notes || `暂无关于 ${aboutUserId} 的保密备注。`);
      },
    },
  ];
}
