import { NapCatAPI } from "./napcat/api.js";
import { NapCatClient } from "./napcat/client.js";
import { QzoneAPI } from "./napcat/qzone-api.js";
import { InboundHandler } from "./handlers/inbound.js";
import { EventHandler } from "./handlers/events.js";
import { ProactiveManager } from "./handlers/proactive.js";
import { MessageManager } from "./util/message-manager.js";
import { MessageSender } from "./services/message-sender.js";
import { SessionStore } from "./services/session-store.js";
import { MemoryManager } from "./services/memory-manager.js";
import { FileDownloader } from "./services/file-downloader.js";
import { ImageResolver } from "./services/image-resolver.js";
import { QzoneEventListener } from "./services/qzone-event-listener.js";
import { CrossContextCache } from "./services/cross-context-cache.js";
import { ConfidentialNoteStore } from "./services/confidential-note-store.js";
import { expandInlineFaces } from "./util/cq-code.js";
import { getCurrentTimeBlock } from "./util/date.js";
import { getSenderDisplayName, buildGroupHeader } from "./util/identity.js";
import { getSyntheticMessageId } from "./util/synthetic-id.js";
import type { PluginContext } from "./context.js";
import type { CommandContext } from "./commands/types.js";
import type { QQMessage } from "./napcat/types.js";
import type { PluginLogger, PluginRuntime, OpenClawConfig } from "./types-compat.js";
import { zh as t } from "./locale/zh.js";

/** 若内容像内部错误（JSON 解析、API 校验等），返回友好提示，避免把堆栈/错误原文发给用户 */
function sanitizeReplyText(text: string): string {
  if (!text || typeof text !== "string") return text;
  const s = text.trim();
  if (
    /^Unexpected\s+non-whitespace\s+character\s+after\s+JSON/i.test(s) ||
    /position\s+\d+.*column\s+\d+/i.test(s) ||
    /SyntaxError|JSON\.parse/i.test(s) ||
    /validation\s+errors?.*Field\s+required/i.test(s) ||
    /request\s+could\s+not\s+be\s+processed/i.test(s) ||
    /^\s*\{\s*"error"/i.test(s)
  ) {
    return t.errorReplyParse;
  }
  return text;
}

const REASONING_RE = /发一条|合适时机|不会太晚|结合\s*[^。]*兴趣|简短自然|若适合|只写\s*一条|不要解释|免打扰|上次对话已经|约?\s*\d+\s*分钟\s*前|分钟前发过/;

function stripProactiveReasoning(text: string): string {
  if (!text?.trim()) return text;
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const keep = paragraphs.filter((p) => !REASONING_RE.test(p));
  if (!keep.length) return paragraphs[paragraphs.length - 1] || "";
  let last = keep[keep.length - 1];
  last = last.replace(/^(?:发一条[^。]+。|结合[^。]+。|(?:简短|自然)[^。]*。)\s*/, "").trim();
  if (/^(发一条|结合|简短自然)/.test(last)) {
    last = last.replace(/^[^。]+。\s*/, "").trim();
  }
  return last || keep[keep.length - 1];
}

export interface GatewayParams {
  ctx: PluginContext;
  ocConfig: OpenClawConfig;
  accountId: string;
  runtime: PluginRuntime;
  abortSignal: AbortSignal;
  setStatus: (next: Record<string, unknown>) => void;
  gatewayLog?: PluginLogger;
}

export async function startGateway(params: GatewayParams): Promise<void> {
  const { ctx, ocConfig, accountId, runtime, abortSignal, setStatus, gatewayLog } = params;
  const log = gatewayLog ?? ctx.log;
  const config = ctx.config;

  const api = new NapCatAPI(config.connection.httpUrl, config.connection.token, {
    timeoutMs: config.limits.apiTimeoutMs,
    retryBackoffMs: config.limits.apiRetryBackoffMs,
  });
  const client = new NapCatClient(config.connection.wsUrl, config.connection.token, log, {
    reconnectDelayMs: config.network.reconnectDelayMs,
    maxReconnectDelayMs: config.network.maxReconnectDelayMs,
    pingIntervalMs: config.network.pingIntervalMs,
  });
  const msgManager = new MessageManager(config.limits.maxMessageHistory);
  const sessionStore = new SessionStore(config, log);
  const memoryManager = new MemoryManager(config, log);
  const fileDownloader = new FileDownloader(config, log);
  const sender = new MessageSender(api, msgManager, config, log);
  const imageResolver = new ImageResolver(api, config);

  const crossContextCache = new CrossContextCache();
  const confidentialNotes = new ConfidentialNoteStore(config, log);

  ctx.api = api;
  ctx.msgManager = msgManager;
  ctx.sessionStore = sessionStore;
  ctx.memoryManager = memoryManager;
  ctx.fileDownloader = fileDownloader;
  ctx.messageSender = sender;
  ctx.imageResolver = imageResolver;
  ctx.crossContextCache = crossContextCache;
  ctx.confidentialNotes = confidentialNotes;

  if (config.qzone.enabled) {
    ctx.qzoneApi = new QzoneAPI(
      config.qzone.bridgeUrl,
      config.qzone.accessToken || undefined,
      { timeoutMs: config.limits.apiTimeoutMs },
    );
    log.info(`[QQ] QZone bridge enabled → ${config.qzone.bridgeUrl}`);
  }

  setInterval(() => crossContextCache.cleanup(), 60_000);

  for (const [sk, override] of sessionStore.loadModelOverrides()) {
    ctx.modelOverrides.set(sk, override);
  }

  const resolveSessionKey = (msg: QQMessage): string => {
    try {
      const route = runtime.channel.routing.resolveAgentRoute({
        cfg: ocConfig,
        channel: "qq",
        accountId,
        peer: { id: msg.messageType === "group" && msg.groupId ? msg.groupId : msg.userId },
        guildId: msg.messageType === "group" ? msg.groupId : undefined,
      });
      return route.sessionKey;
    } catch {
      const peerId = msg.messageType === "group" && msg.groupId ? msg.groupId : msg.userId;
      const chatType = msg.messageType === "group" ? "group" : "direct";
      return `agent:main:qq:${chatType}:${peerId}`;
    }
  };

  const resolveSessionKeyForPeer = (peerId: string, isGroup: boolean): string => {
    try {
      const route = runtime.channel.routing.resolveAgentRoute({
        cfg: ocConfig,
        channel: "qq",
        accountId,
        peer: { id: peerId },
        guildId: isGroup ? peerId : undefined,
      });
      return route.sessionKey;
    } catch {
      return `agent:main:qq:${isGroup ? "group" : "direct"}:${peerId}`;
    }
  };

  ctx.resolveSessionKeyForPeer = resolveSessionKeyForPeer;

  const dispatchToAgent = async (msg: QQMessage, body: string, identityBlock: string): Promise<string | null> => {
    try {
      const peer = { id: msg.userId };
      const guildId = msg.groupId ?? null;
      const route = runtime.channel.routing.resolveAgentRoute({
        cfg: ocConfig, channel: "qq", accountId, peer, guildId,
      });

      const chatType = msg.messageType === "group" ? "group" : "dm";
      const to = msg.messageType === "group" && msg.groupId ? `g:${msg.groupId}` : `p:${msg.userId}`;
      const senderName = getSenderDisplayName(msg);
      const mediaPaths = await imageResolver.resolveImagePaths(msg);

      const isGroup = msg.messageType === "group" && !!msg.groupId;

      // --- Build BodyForAgent with context supplements ---
      const currentTimeLine = `[当前时间] ${getCurrentTimeBlock()}`;
      let bodyForAgent: string;
      if (isGroup) {
        // Group: stable header + per-turn speaker identity + body
        // Body (persisted in history) stays lean; BodyForAgent (current turn) is enriched
        const groupHeader = buildGroupHeader(msg.groupId!);
        const confNote = confidentialNotes.getNotesForUser(msg.userId);
        const confBlock = confNote
          ? `\n[保密参考（切勿在群内复述或透露来源）] ${confNote}`
          : "";
        bodyForAgent = `${currentTimeLine}\n\n${groupHeader}\n${identityBlock}${confBlock}\n\n${body}`;
      } else {
        // Private: full identity + recent group activity supplement + confidential notes
        const supplement = crossContextCache.buildPrivateChatSupplement(msg.userId);
        const confNote = confidentialNotes.getNotesForUser(msg.userId);
        const confBlock = confNote
          ? `\n[保密参考（切勿向对方复述或透露来源）] ${confNote}`
          : "";
        const extra = [supplement, confBlock].filter(Boolean).join("\n");
        bodyForAgent = extra
          ? `${currentTimeLine}\n\n${identityBlock}\n${extra}\n\n${body}`
          : `${currentTimeLine}\n\n${identityBlock}\n\n${body}`;
      }

      const msgCtx: Record<string, unknown> = {
        Body: body,
        BodyForAgent: bodyForAgent,
        RawBody: msg.content,
        CommandBody: msg.content,
        BodyForCommands: msg.content,
        From: msg.userId,
        To: to,
        SessionKey: route.sessionKey,
        AccountId: accountId,
        MessageSid: msg.id,
        ChatType: chatType,
        SenderName: senderName,
        SenderId: msg.userId,
        Timestamp: msg.timestamp,
        Provider: "qq",
        OriginatingChannel: "qq",
        OriginatingTo: to,
        WasMentioned: msg.atBot,
        CommandAuthorized: true,
      };
      if (msg.groupId) msgCtx.GroupSubject = `QQ群 ${msg.groupId}`;

      if (mediaPaths.length > 0) {
        msgCtx.MediaPaths = mediaPaths;
        msgCtx.MediaTypes = mediaPaths.map(() => "image/jpeg");
        msgCtx.MediaPath = mediaPaths[0];
        msgCtx.MediaType = "image/jpeg";
      } else if (msg.imageUrls.length > 0) {
        msgCtx.MediaUrls = msg.imageUrls;
        msgCtx.MediaTypes = msg.imageUrls.map(() => "image/jpeg");
        msgCtx.MediaUrl = msg.imageUrls[0];
        msgCtx.MediaType = "image/jpeg";
      }

      const finalCtx = runtime.channel.reply.finalizeInboundContext(msgCtx);
      const isProactive = body.includes("[系统提示-主动对话]");

      const deliver = async (payload: Record<string, unknown>, _info: Record<string, unknown>) => {
        if (payload.isReasoning) return;
        let text = payload.text as string | undefined;
        if (text && (text.includes("[无需回复]") || text.toLowerCase().includes("[no reply]") || text.includes("[不发]"))) return;
        if (text && isProactive) {
          text = stripProactiveReasoning(text);
          if (!text) return;
        }
        text = text ? sanitizeReplyText(text) : undefined;
        const mediaUrl = (payload.mediaUrl as string) || ((payload.mediaUrls as string[] | undefined)?.[0]);
        if (text || mediaUrl) {
          const outTo = msg.messageType === "group" && msg.groupId ? msg.groupId : msg.userId;
          const isGroup = msg.messageType === "group";
          await sender.send(outTo, isGroup, text ?? "", mediaUrl);
        }
      };

      const result = runtime.channel.reply.createReplyDispatcherWithTyping({
        deliver,
      }) as { dispatcher: Record<string, unknown> & {
        markComplete: () => void;
        waitForIdle: () => Promise<void>;
      }; replyOptions: Record<string, unknown>; markDispatchIdle: () => void };

      const typingInterval = setInterval(() => {
        api.setInputStatus(msg.userId, 1).catch(() => {});
      }, 1500);

      try {
        await runtime.channel.reply.dispatchReplyFromConfig({
          ctx: finalCtx,
          cfg: ocConfig,
          dispatcher: result.dispatcher,
          replyOptions: result.replyOptions,
        });
      } finally {
        clearInterval(typingInterval);
        result.dispatcher.markComplete();
        await result.dispatcher.waitForIdle();
      }

      return null;
    } catch (e) {
      const errStr = String(e);
      log.error(`[QQ] Agent dispatch error: ${errStr}`);

      let friendly: string = t.errorGeneric;
      if (errStr.includes("context_length") || errStr.includes("token")) {
        friendly = t.errorContextLength;
      } else if (errStr.includes("rate_limit") || errStr.includes("429")) {
        friendly = t.errorRateLimit;
      } else if (errStr.includes("timeout")) {
        friendly = t.errorTimeout;
      }

      try {
        const isGroup = msg.messageType === "group";
        const target = isGroup && msg.groupId ? msg.groupId : msg.userId;
        const segments = expandInlineFaces(friendly);
        if (isGroup) await api.sendGroupMsg(target, segments);
        else await api.sendPrivateMsg(target, segments);
      } catch { /* suppress secondary send error */ }
      return null;
    }
  };

  const cmdCtx: CommandContext = {
    config,
    api,
    msgManager,
    memoryManager,
    log,
    resolveSessionKey,
    resetSession: (sk) => sessionStore.resetSession(sk),
    hasSession: (sk) => sessionStore.hasSession(sk),
    setModelOverride: (sk, p, m) => ctx.modelOverrides.set(sk, { provider: p, model: m }),
    persistSessionModel: (sk, p, m) => sessionStore.persistSessionModel(sk, p, m),
    dispatchToAgent,
  };

  const inbound = new InboundHandler({
    config,
    api,
    log,
    sender,
    memoryManager,
    fileDownloader,
    commandRegistry: ctx.commandRegistry!,
    cmdCtx,
    crossContextCache,
    resolveSessionKey,
    dispatchToAgent,
  });

  const eventHandler = new EventHandler({
    api,
    config,
    log,
    inbound,
    fileDownloader,
  });

  const proactive = new ProactiveManager({
    api,
    config,
    log,
    runtime,
    cfg: ocConfig,
    accountId,
    memoryManager,
    async dispatchSynthetic(userId: string, content: string) {
      inbound.handleMessageEvent({
        post_type: "message",
        message_type: "private",
        message_id: getSyntheticMessageId(),
        user_id: Number(userId),
        message: [{ type: "text", data: { text: content } }],
        raw_message: content,
        sender: { user_id: Number(userId), nickname: "system" },
        time: Math.floor(Date.now() / 1000),
        self_id: Number(config.connection.selfId || 0),
      });
    },
  });

  client.addMessageHandler((event) => inbound.handleMessageEvent(event));
  client.addNoticeHandler((event) => eventHandler.handleNotice(event));
  client.addRequestHandler((event) => eventHandler.handleRequest(event));

  if (config.qzone.enabled && config.qzone.notifyEvents.length > 0) {
    let qzoneSeq = Date.now();
    const ownerId = Number(config.qzone.notifyUserId) || Number(config.connection.selfId || 0);
    const selfId = Number(config.connection.selfId || 0);
    const qzoneEvents = new QzoneEventListener(config.qzone, (type, userId, content, nickname, detail, tid) => {
      log.info(`[QZone-Event] ${nickname}(${userId}): ${content.slice(0, 80)}`);
      memoryManager.updateQzoneMemory(type, userId, nickname, detail, tid);
      const now = Math.floor(Date.now() / 1000);
      const numUserId = Number(userId) || 0;

      // 1) 投递到评论者/点赞者会话 — bot 可以和对方互动
      inbound.handleMessageEvent({
        post_type: "message",
        message_type: "private",
        message_id: ++qzoneSeq,
        user_id: numUserId,
        message: [{ type: "text", data: { text: content } }],
        raw_message: content,
        sender: { user_id: numUserId, nickname: nickname || "QZone" },
        time: now,
        self_id: selfId,
      });

      // 2) 投递到主人会话 — 主人收到通知
      if (numUserId !== ownerId) {
        inbound.handleMessageEvent({
          post_type: "message",
          message_type: "private",
          message_id: ++qzoneSeq,
          user_id: ownerId,
          message: [{ type: "text", data: { text: content } }],
          raw_message: content,
          sender: { user_id: ownerId, nickname: "QZone" },
          time: now,
          self_id: selfId,
        });
      }
    }, log);
    qzoneEvents.start(abortSignal).catch((e) => {
      log.warn?.(`[QZone-Event] Listener exited: ${e}`);
    });
    log.info(`[QQ] QZone event listener → ${config.qzone.eventWsUrl} (events: ${config.qzone.notifyEvents.join(",")})`);
  }

  setStatus({ state: "connecting", label: `QQ ${config.connection.selfId}` });
  proactive.start(abortSignal);
  log.info(`[QQ] Channel started for account ${config.connection.selfId}`);

  await client.start(abortSignal);
  setStatus({ state: "disconnected", label: `QQ ${config.connection.selfId}` });
}
