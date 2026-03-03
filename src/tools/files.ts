import * as fs from "node:fs";
import * as path from "node:path";
import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function createFileTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "qq_send_image",
      description: "发送图片。url 可为网络链接或本地文件路径。必须使用此工具发图片。",
      parameters: {
        type: "object", required: ["url"],
        properties: {
          url: { type: "string", description: "图片 URL 或本地路径" },
          user_id: { type: "string", description: "私聊目标 QQ 号" },
          group_id: { type: "string", description: "群号" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        let imageUrl = String(params.url ?? "").trim();
        const userId = params.user_id ? String(params.user_id) : undefined;
        const groupId = params.group_id ? String(params.group_id) : undefined;
        if (!imageUrl) return textResult("[错误] 缺少图片 URL");

        let fileParam: string;
        if (imageUrl.startsWith("file:///")) imageUrl = imageUrl.slice(7);
        else if (imageUrl.startsWith("file://")) imageUrl = imageUrl.slice(6);

        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
          fileParam = imageUrl;
        } else if (fs.existsSync(imageUrl)) {
          const absPath = path.resolve(imageUrl);
          const size = fs.statSync(absPath).size;
          if (size > ctx.config.limits.imageMaxSize) return textResult("[错误] 图片超过大小限制");
          const b64 = fs.readFileSync(absPath).toString("base64");
          fileParam = `base64://${b64}`;
        } else {
          return textResult(`[错误] 文件不存在: ${imageUrl.slice(0, 80)}`);
        }

        const segment = [{ type: "image", data: { file: fileParam } }];
        if (groupId) {
          const result = await ctx.api.sendGroupMsg(groupId, segment);
          return textResult(`图片发送结果: ${result.status}`);
        }
        if (userId) {
          const result = await ctx.api.sendPrivateMsg(userId, segment);
          return textResult(`图片发送结果: ${result.status}`);
        }
        return textResult("[错误] 需要 user_id 或 group_id");
      },
    },
    {
      name: "qq_send_file",
      description: "发送文件给用户或群",
      parameters: {
        type: "object", required: ["file"],
        properties: {
          file: { type: "string", description: "本地文件路径或 URL" },
          name: { type: "string", description: "文件显示名（可选）" },
          user_id: { type: "string", description: "私聊目标 QQ 号" },
          group_id: { type: "string", description: "群号" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        if (!ctx.api) return textResult("[错误] API 未初始化");
        let filePath = String(params.file ?? "").trim();
        let fileName = params.name ? String(params.name) : "";
        const userId = params.user_id ? String(params.user_id) : undefined;
        const groupId = params.group_id ? String(params.group_id) : undefined;
        if (!filePath) return textResult("[错误] 缺少 file 参数");

        if (filePath.startsWith("http")) {
          try {
            const outDir = path.join(ctx.config.paths.workspace, "qq_files", "outgoing");
            fs.mkdirSync(outDir, { recursive: true });
            if (!fileName) fileName = filePath.split("/").pop()?.split("?")[0] || "download";
            const local = path.join(outDir, fileName);
            const resp = await fetch(filePath, { signal: AbortSignal.timeout(ctx.config.network.fetchTimeoutMs) });
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(local, buffer);
            filePath = local;
          } catch (e) {
            return textResult(`下载文件失败: ${e}`);
          }
        }

        if (filePath.startsWith("file:///")) filePath = filePath.slice(7);
        else if (filePath.startsWith("file://")) filePath = filePath.slice(6);

        if (!fs.existsSync(filePath)) return textResult(`[错误] 文件不存在: ${filePath}`);
        if (!fileName) fileName = path.basename(filePath);

        const absPath = path.resolve(filePath);
        const stat = fs.statSync(absPath);
        if (stat.size > ctx.config.limits.uploadFileMaxSize) return textResult("[错误] 文件超过大小限制");

        const b64File = `base64://${fs.readFileSync(absPath).toString("base64")}`;

        if (groupId) {
          const result = await ctx.api.uploadGroupFile(groupId, b64File, fileName);
          return textResult(result.status === "ok" ? `文件 ${fileName} 发送成功` : `发送失败: ${result.message}`);
        }
        if (userId) {
          const result = await ctx.api.uploadPrivateFile(userId, b64File, fileName);
          return textResult(result.status === "ok" ? `文件 ${fileName} 发送成功` : `发送失败: ${result.message}`);
        }
        return textResult("[错误] 需要 user_id 或 group_id");
      },
    },
  ];
}
