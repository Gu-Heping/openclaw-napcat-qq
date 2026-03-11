import type { PluginContext } from "../context.js";
import type { AnyAgentTool } from "../types-compat.js";
import { createInfoTools } from "./info.js";
import { createMessagingTools } from "./messaging.js";
import { createGroupAdminTools } from "./group-admin.js";
import { createFileTools } from "./files.js";
import { createRequestTools } from "./requests.js";
import { createQzoneTools } from "./qzone.js";
import { createConfidentialTools } from "./confidential.js";

export function createAllTools(ctx: PluginContext): AnyAgentTool[] {
  const tools: AnyAgentTool[] = [
    ...createInfoTools(ctx),
    ...createMessagingTools(ctx),
    ...createGroupAdminTools(ctx),
    ...createFileTools(ctx),
    ...createRequestTools(ctx),
    ...createConfidentialTools(ctx),
  ];

  if (ctx.config.qzone.enabled) {
    tools.push(...createQzoneTools(ctx));
  }

  return tools;
}
