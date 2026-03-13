import { resolveConfig } from "./config.js";
import { createPluginContext } from "./context.js";
import { createQQChannelPlugin } from "./channel.js";
import { createAllTools } from "./tools/index.js";
import { CommandRegistry } from "./commands/registry.js";
import { helpCommand, pingCommand } from "./commands/help.js";
import { clearCommand, summaryClearCommand, modelCommand } from "./commands/session.js";
import { noteCommand } from "./commands/note.js";
import { historyCommand, clearHistoryCommand } from "./commands/history.js";
import { statusCommand } from "./commands/status.js";
import type { OpenClawPluginApi } from "./types-compat.js";

const plugin = {
  id: "napcat-qq",
  name: "napcat-qq",
  description: "QQ channel integration via NapCat (OneBot v11)",
  version: "2.0.0",

  register(api: OpenClawPluginApi) {
    const log = api.logger;
    const pluginConfig = api.pluginConfig;
    const runtime = api.runtime;
    const channelsQq = (api.config?.channels as Record<string, unknown> | undefined)?.qq;
    const config = resolveConfig(pluginConfig, channelsQq as Record<string, unknown> | null | undefined);
    const ctx = createPluginContext(config, log);

    const registry = new CommandRegistry();
    registry.registerAll([
      helpCommand,
      pingCommand,
      clearCommand,
      summaryClearCommand,
      modelCommand,
      noteCommand,
      historyCommand,
      clearHistoryCommand,
      statusCommand,
    ]);
    ctx.commandRegistry = registry;

    api.registerHook("before_model_resolve", (...args: unknown[]) => {
      const hookCtx = (args[1] ?? args[0] ?? {}) as Record<string, unknown>;
      const sk = String(hookCtx.sessionKey ?? "");
      const override = ctx.modelOverrides.get(sk);
      if (override) {
        return { modelOverride: override.model, providerOverride: override.provider };
      }
    }, { name: "napcat-qq:before_model_resolve" });

    const qqChannel = createQQChannelPlugin(ctx, runtime);
    api.registerChannel({ plugin: qqChannel as never });

    const tools = createAllTools(ctx);
    for (const tool of tools) {
      api.registerTool(tool as never, { name: tool.name });
    }

    log.info(`[napcat-qq] v2.0.0 registered: QQ channel + ${tools.length} tools + ${registry["commands"].length} commands`);
  },
};

export default plugin;
