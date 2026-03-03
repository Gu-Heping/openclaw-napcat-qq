import type { BotConfig } from "./config.js";
import type { PluginLogger } from "./types-compat.js";
import type { NapCatAPI } from "./napcat/api.js";
import type { MessageManager } from "./util/message-manager.js";
import type { SessionStore } from "./services/session-store.js";
import type { MemoryManager } from "./services/memory-manager.js";
import type { FileDownloader } from "./services/file-downloader.js";
import type { MessageSender } from "./services/message-sender.js";
import type { ImageResolver } from "./services/image-resolver.js";
import type { CommandRegistry } from "./commands/registry.js";

export interface PluginContext {
  readonly config: BotConfig;
  readonly log: PluginLogger;
  readonly modelOverrides: Map<string, { provider: string; model: string }>;

  api: NapCatAPI | null;
  msgManager: MessageManager | null;
  sessionStore: SessionStore | null;
  memoryManager: MemoryManager | null;
  fileDownloader: FileDownloader | null;
  messageSender: MessageSender | null;
  imageResolver: ImageResolver | null;
  commandRegistry: CommandRegistry | null;
}

export function createPluginContext(config: BotConfig, log: PluginLogger): PluginContext {
  return {
    config,
    log,
    modelOverrides: new Map(),
    api: null,
    msgManager: null,
    sessionStore: null,
    memoryManager: null,
    fileDownloader: null,
    messageSender: null,
    imageResolver: null,
    commandRegistry: null,
  };
}
