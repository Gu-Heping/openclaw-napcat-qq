import type { PluginContext } from "../context.js";
import type { AnyAgentTool } from "../types-compat.js";
import { createInfoTools } from "./info.js";
import { createMessagingTools } from "./messaging.js";
import { createGroupAdminTools } from "./group-admin.js";
import { createFileTools } from "./files.js";
import { createRequestTools } from "./requests.js";

export function createAllTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    ...createInfoTools(ctx),
    ...createMessagingTools(ctx),
    ...createGroupAdminTools(ctx),
    ...createFileTools(ctx),
    ...createRequestTools(ctx),
  ];
}
