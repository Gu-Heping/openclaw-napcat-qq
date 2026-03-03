import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function createInfoTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "qq_get_stranger_info",
      description: "查询 QQ 用户信息（昵称、性别、年龄等）",
      parameters: {
        type: "object", required: ["user_id"],
        properties: { user_id: { type: "string", description: "QQ 号" } },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const userId = String(params.user_id ?? "");
        if (!userId) return textResult("[错误] 缺少 user_id");
        const result = await ctx.api.getStrangerInfo(userId);
        if (result.status === "ok") {
          const data = result.data as Record<string, unknown>;
          const lines = ["用户信息:"];
          for (const k of ["nickname", "sex", "age", "user_id"]) {
            if (data[k] != null && data[k] !== "") lines.push(`${k}: ${data[k]}`);
          }
          lines.push(`头像: https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`);
          return textResult(lines.join("\n"));
        }
        return textResult(`查询失败: ${result.message ?? "未知错误"}`);
      },
    },
    {
      name: "qq_get_group_info",
      description: "查询 QQ 群信息（群名、人数等）",
      parameters: {
        type: "object", required: ["group_id"],
        properties: { group_id: { type: "string", description: "群号" } },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const groupId = String(params.group_id ?? "");
        if (!groupId) return textResult("[错误] 缺少 group_id");
        const result = await ctx.api.getGroupInfo(groupId);
        if (result.status === "ok") {
          const data = result.data as Record<string, unknown>;
          const lines = ["群信息:"];
          for (const k of ["group_id", "group_name", "member_count", "max_member_count"]) {
            if (data[k] != null) lines.push(`${k}: ${data[k]}`);
          }
          lines.push(`群头像: https://p.qlogo.cn/gh${groupId}/${groupId}/0`);
          return textResult(lines.join("\n"));
        }
        return textResult(`查询失败: ${result.message ?? "未知错误"}`);
      },
    },
    {
      name: "qq_get_user_avatar",
      description: "获取 QQ 用户头像 URL",
      parameters: {
        type: "object", required: ["user_id"],
        properties: { user_id: { type: "string", description: "QQ 号" } },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const userId = String(params.user_id ?? "");
        if (!userId) return textResult("[错误] 缺少 user_id");
        const url = `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;
        return { content: [{ type: "text", text: `用户 ${userId} 头像 URL: ${url}` }, { type: "image", uri: url, mimeType: "image/jpeg" }] };
      },
    },
    {
      name: "qq_get_group_avatar",
      description: "获取 QQ 群头像 URL 和图片",
      parameters: {
        type: "object", required: ["group_id"],
        properties: { group_id: { type: "string", description: "群号" } },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const groupId = String(params.group_id ?? "");
        if (!groupId) return textResult("[错误] 缺少 group_id");
        const url = `https://p.qlogo.cn/gh/${groupId}/${groupId}/0`;
        return { content: [{ type: "text", text: `群 ${groupId} 头像: ${url}` }, { type: "image", uri: url, mimeType: "image/jpeg" }] };
      },
    },
    {
      name: "qq_get_friend_list",
      description: "获取 Bot 的好友列表",
      parameters: { type: "object", properties: {} },
      async execute(): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const result = await ctx.api.getFriendList();
        if (result.status === "ok") {
          const list = result.data as Array<Record<string, unknown>>;
          if (!list?.length) return textResult("暂无好友");
          let text = `共 ${list.length} 个好友:\n`;
          for (const f of list.slice(0, 15)) {
            const nick = f.nickname ?? "未知";
            const remark = f.remark ? `(${f.remark})` : "";
            text += `- ${nick}${remark} ${f.user_id}\n`;
          }
          if (list.length > 15) text += `... 还有 ${list.length - 15} 个`;
          return textResult(text);
        }
        return textResult("获取好友列表失败");
      },
    },
    {
      name: "qq_get_group_list",
      description: "获取 Bot 加入的群列表",
      parameters: { type: "object", properties: {} },
      async execute(): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const result = await ctx.api.getGroupList();
        if (result.status === "ok") {
          const list = result.data as Array<Record<string, unknown>>;
          if (!list?.length) return textResult("暂无群");
          let text = `共 ${list.length} 个群:\n`;
          for (const g of list.slice(0, 10)) {
            text += `- ${g.group_name ?? "未知"} (${g.group_id})\n`;
          }
          if (list.length > 10) text += `... 还有 ${list.length - 10} 个`;
          return textResult(text);
        }
        return textResult("获取群列表失败");
      },
    },
    {
      name: "qq_get_group_member_list",
      description: "获取群成员列表",
      parameters: {
        type: "object", required: ["group_id"],
        properties: { group_id: { type: "string", description: "群号" } },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const groupId = String(params.group_id ?? "");
        if (!groupId) return textResult("[错误] 缺少 group_id");
        const result = await ctx.api.getGroupMemberList(groupId);
        if (result.status === "ok") {
          const members = result.data as Array<Record<string, unknown>>;
          if (!members?.length) return textResult(`群 ${groupId} 暂无成员`);
          let text = `群 ${groupId} 共 ${members.length} 名成员:\n`;
          for (const m of members.slice(0, 15)) {
            const role = m.role as string;
            const icon = role === "owner" ? "👑" : role === "admin" ? "🔧" : "👤";
            const card = m.card ? `${m.card}(${m.nickname})` : String(m.nickname ?? "未知");
            text += `${icon} ${card} ${m.user_id}\n`;
          }
          if (members.length > 15) text += `... 还有 ${members.length - 15} 名`;
          return textResult(text);
        }
        return textResult(`获取成员列表失败: ${result.message}`);
      },
    },
  ];
}
