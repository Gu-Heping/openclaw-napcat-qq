import type { QQMessage } from "../napcat/types.js";
import type { NapCatAPI } from "../napcat/api.js";
import type { BotConfig } from "../config.js";
import type { MessageManager } from "../util/message-manager.js";
import type { MemoryManager } from "../services/memory-manager.js";
import type { PluginLogger } from "../types-compat.js";

export interface CommandContext {
  config: BotConfig;
  api: NapCatAPI;
  msgManager: MessageManager;
  memoryManager: MemoryManager;
  log: PluginLogger;
  resolveSessionKey: (msg: QQMessage) => string;
  resetSession: (sessionKey: string) => Promise<boolean>;
  hasSession: (sessionKey: string) => boolean;
  setModelOverride: (sessionKey: string, provider: string, model: string) => void;
  persistSessionModel: (sessionKey: string, provider: string, model: string) => Promise<boolean>;
  dispatchToAgent: (msg: QQMessage, body: string, identityBlock: string) => Promise<string | null>;
}

export interface Command {
  names: string[];
  description: string;
  execute: (msg: QQMessage, args: string, ctx: CommandContext) => string | Promise<string>;
}
