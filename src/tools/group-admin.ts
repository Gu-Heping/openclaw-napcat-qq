import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function createGroupAdminTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "qq_kick_group_member",
      description: "将成员移出群聊（需 Bot 为管理员/群主）",
      parameters: {
        type: "object", required: ["group_id", "user_id"],
        properties: {
          group_id: { type: "string", description: "群号" },
          user_id: { type: "string", description: "被踢者 QQ 号" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const groupId = String(params.group_id ?? "");
        const userId = String(params.user_id ?? "");
        if (!groupId || !userId) return textResult("[错误] 缺少 group_id 或 user_id");
        const result = await ctx.api.setGroupKick(groupId, userId);
        return textResult(result.status === "ok" ? `已将 ${userId} 移出群 ${groupId}` : `移出失败: ${result.message}`);
      },
    },
    {
      name: "qq_ban_group_member",
      description: "禁言群成员（需 Bot 为管理员/群主）",
      parameters: {
        type: "object", required: ["group_id", "user_id"],
        properties: {
          group_id: { type: "string", description: "群号" },
          user_id: { type: "string", description: "被禁言者 QQ 号" },
          duration: { type: "number", description: "禁言时长（秒），默认 1800" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const groupId = String(params.group_id ?? "");
        const userId = String(params.user_id ?? "");
        const duration = Number(params.duration ?? 1800);
        if (!groupId || !userId) return textResult("[错误] 缺少 group_id 或 user_id");
        const result = await ctx.api.setGroupBan(groupId, userId, duration);
        return textResult(result.status === "ok" ? `已禁言 ${userId} ${Math.floor(duration / 60)} 分钟` : `禁言失败: ${result.message}`);
      },
    },
    {
      name: "qq_set_group_card",
      description: "设置群成员名片",
      parameters: {
        type: "object", required: ["group_id", "user_id", "card"],
        properties: {
          group_id: { type: "string", description: "群号" },
          user_id: { type: "string", description: "目标 QQ 号" },
          card: { type: "string", description: "新群名片" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const groupId = String(params.group_id ?? "");
        const userId = String(params.user_id ?? "");
        const card = String(params.card ?? "");
        if (!groupId || !userId) return textResult("[错误] 缺少参数");
        const result = await ctx.api.setGroupCard(groupId, userId, card);
        return textResult(result.status === "ok" ? `已设置 ${userId} 群名片为: ${card}` : `设置失败: ${result.message}`);
      },
    },
    {
      name: "qq_set_group_name",
      description: "修改群名称",
      parameters: {
        type: "object", required: ["group_id", "group_name"],
        properties: {
          group_id: { type: "string", description: "群号" },
          group_name: { type: "string", description: "新群名" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const groupId = String(params.group_id ?? "");
        const groupName = String(params.group_name ?? "");
        if (!groupId || !groupName) return textResult("[错误] 缺少参数");
        const result = await ctx.api.setGroupName(groupId, groupName);
        return textResult(result.status === "ok" ? `已将群名改为: ${groupName}` : `修改失败: ${result.message}`);
      },
    },
  ];
}
