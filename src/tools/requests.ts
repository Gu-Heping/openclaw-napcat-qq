import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";
import { getPendingRequests, popByFlag } from "../handlers/events.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function createRequestTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "qq_get_pending_requests",
      description: "查看待处理的加好友/加群请求",
      parameters: { type: "object", properties: {} },
      async execute(): Promise<AgentToolResult> {
        const items = getPendingRequests();
        if (!items.length) return textResult("暂无待处理请求");
        const lines = items.map((r, i) => {
          if (r.type === "friend") {
            return `${i + 1}. [加好友] user_id=${r.userId} 验证: ${r.comment.slice(0, 50)} flag=${r.flag}`;
          }
          return `${i + 1}. [加群] user_id=${r.userId} group_id=${r.groupId ?? "?"} sub=${r.subType ?? "add"} 验证: ${r.comment.slice(0, 50)} flag=${r.flag}`;
        });
        return textResult("待处理请求:\n" + lines.join("\n"));
      },
    },
    {
      name: "qq_handle_friend_request",
      description: "处理加好友请求",
      parameters: {
        type: "object", required: ["flag"],
        properties: {
          flag: { type: "string", description: "请求标识（从 qq_get_pending_requests 获取）" },
          approve: { type: "boolean", description: "是否通过，默认 true" },
          remark: { type: "string", description: "备注（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const flag = String(params.flag ?? "").trim();
        if (!flag) return textResult("[错误] 缺少 flag");
        const approve = params.approve !== false;
        const remark = String(params.remark ?? "");
        const result = await ctx.api.setFriendAddRequest(flag, approve, remark);
        if (result.status === "ok") {
          popByFlag(flag);
          return textResult(`加好友请求已${approve ? "通过" : "拒绝"}`);
        }
        return textResult(`操作失败: ${result.message}`);
      },
    },
    {
      name: "qq_handle_group_request",
      description: "处理加群/邀请请求",
      parameters: {
        type: "object", required: ["flag"],
        properties: {
          flag: { type: "string", description: "请求标识" },
          sub_type: { type: "string", description: "add（申请）或 invite（邀请），默认 add" },
          approve: { type: "boolean", description: "是否通过，默认 true" },
          reason: { type: "string", description: "拒绝原因（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        const flag = String(params.flag ?? "").trim();
        if (!flag) return textResult("[错误] 缺少 flag");
        let subType = String(params.sub_type ?? "add").toLowerCase();
        if (subType !== "add" && subType !== "invite") subType = "add";
        const approve = params.approve !== false;
        const reason = String(params.reason ?? "");
        const result = await ctx.api.setGroupAddRequest(flag, subType, approve, reason);
        if (result.status === "ok") {
          popByFlag(flag);
          return textResult(`加群请求已${approve ? "通过" : "拒绝"}`);
        }
        return textResult(`操作失败: ${result.message}`);
      },
    },
  ];
}
