import type { BotConfig } from "./config.js";
import type { PluginLogger } from "./types-compat.js";
import type { NapCatAPI } from "./napcat/api.js";
import type { QzoneAPI } from "./napcat/qzone-api.js";
import type { MessageManager } from "./util/message-manager.js";
import type { SessionStore } from "./services/session-store.js";
import type { MemoryManager } from "./services/memory-manager.js";
import type { FileDownloader } from "./services/file-downloader.js";
import type { MessageSender } from "./services/message-sender.js";
import type { ImageResolver } from "./services/image-resolver.js";
import type { CommandRegistry } from "./commands/registry.js";
import type { CrossContextCache } from "./services/cross-context-cache.js";
import type { ConfidentialNoteStore } from "./services/confidential-note-store.js";
import type { ContactProfileStore } from "./services/contact-profile-store.js";

export interface PluginContext {
  readonly config: BotConfig;
  readonly log: PluginLogger;
  readonly modelOverrides: Map<string, { provider: string; model: string }>;

  api: NapCatAPI | null;
  qzoneApi: QzoneAPI | null;
  msgManager: MessageManager | null;
  sessionStore: SessionStore | null;
  /** Resolve sessionKey for a peer (userId for private, groupId for group). Set by gateway. */
  resolveSessionKeyForPeer?: (peerId: string, isGroup: boolean) => string;
  memoryManager: MemoryManager | null;
  fileDownloader: FileDownloader | null;
  messageSender: MessageSender | null;
  imageResolver: ImageResolver | null;
  commandRegistry: CommandRegistry | null;
  crossContextCache: CrossContextCache | null;
  confidentialNotes: ConfidentialNoteStore | null;
  contactProfiles: ContactProfileStore | null;
}

export function createPluginContext(config: BotConfig, log: PluginLogger): PluginContext {
  return {
    config,
    log,
    modelOverrides: new Map(),
    api: null,
    qzoneApi: null,
    msgManager: null,
    sessionStore: null,
    memoryManager: null,
    fileDownloader: null,
    messageSender: null,
    imageResolver: null,
    commandRegistry: null,
    crossContextCache: null,
    confidentialNotes: null,
    contactProfiles: null,
  };
}
