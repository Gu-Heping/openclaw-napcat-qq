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
import type { ContinuityStore } from "./services/continuity-store.js";
import type { IStickerStore } from "./services/sticker-store.js";

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
  continuityStore: ContinuityStore | null;
  stickerStore: IStickerStore | null;
  /**
   * 当前 Agent 轮次对应的 sticker_send 默认目标（LIFO，支持嵌套/交错 await）。
   * 由 gateway 在 dispatch 前后 push/pop；供 sticker_search 提示与 sticker_send 缺参兜底。
   */
  stickerReplyStack: Array<{ userId?: string; groupId?: string }>;
  /**
   * 当前 Agent 轮次可用的入站图片路径列表（LIFO，与 stickerReplyStack 同步 push/pop）。
   * 供 sticker_collect 校验 local_image_path 是否为本条入站消息关联的媒体。
   */
  inboundMediaPathsStack: string[][];
  /**
   * 与 inboundMediaPathsStack 同步：同一条入站消息的 QQ 图片 URL（与路径按索引对应）。
   * 供 sticker_collect 在仅有 CDN 链接、本地解析失败时按 URL 下载到 imageTemp。
   */
  inboundImageUrlsStack: string[][];
  /**
   * 当前 Agent 轮次的入站消息引用（userId、messageId），供 sticker_collect 写入 source 字段。
   */
  inboundMessageRefStack: Array<{ userId: string; messageId: string }>;
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
    continuityStore: null,
    stickerStore: null,
    stickerReplyStack: [],
    inboundMediaPathsStack: [],
    inboundImageUrlsStack: [],
    inboundMessageRefStack: [],
  };
}
