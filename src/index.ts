import { resolveConfig } from "./config.js";
import { createPluginContext } from "./context.js";
import { createQQChannelPlugin } from "./channel.js";
import { createAllTools } from "./tools/index.js";
import { CommandRegistry } from "./commands/registry.js";
import { pingCommand, qqHelpZhCommand } from "./commands/help.js";
import { clearCommand, summaryClearCommand } from "./commands/session.js";
import { noteCommand } from "./commands/note.js";
import { historyCommand, clearHistoryCommand } from "./commands/history.js";
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
      qqHelpZhCommand,
      pingCommand,
      clearCommand,
      summaryClearCommand,
      noteCommand,
      historyCommand,
      clearHistoryCommand,
    ]);
    ctx.commandRegistry = registry;

    api.registerHook("before_model_resolve", (...args: unknown[]) => {
      const hookCtx = (args[1] ?? args[0] ?? {}) as Record<string, unknown>;
      const sk = String(hookCtx.sessionKey ?? "").trim();
      if (!sk || !ctx.sessionStore) {
        return undefined;
      }
      const fromDisk = ctx.sessionStore.readModelOverrideForKey(sk);
      if (fromDisk) {
        ctx.modelOverrides.set(sk, fromDisk);
        return { modelOverride: fromDisk.model, providerOverride: fromDisk.provider };
      }
      ctx.modelOverrides.delete(sk);
      return undefined;
    }, { name: "napcat-qq:before_model_resolve" });

    const qqChannel = createQQChannelPlugin(ctx, runtime);
    api.registerChannel({ plugin: qqChannel as never });

    const tools = createAllTools(ctx);
    for (const tool of tools) {
      api.registerTool(tool as never, { name: tool.name });
    }

    log.info(
      `[napcat-qq] v2.0.0 registered: QQ channel + ${tools.length} tools + ${registry.registeredCommandCount} QQ-local slash commands`,
    );
  },
};

export default plugin;
