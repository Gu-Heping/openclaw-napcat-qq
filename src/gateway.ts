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
import { ContactProfileStore } from "./services/contact-profile-store.js";
import { expandInlineFaces } from "./util/cq-code.js";
import { getCurrentTimeBlock } from "./util/date.js";
import { getSenderDisplayName, buildGroupHeader } from "./util/identity.js";
import { getSyntheticMessageId } from "./util/synthetic-id.js";
import type { PluginContext } from "./context.js";
import type { CommandContext } from "./commands/types.js";
import type { QQMessage } from "./napcat/types.js";
import type { PluginLogger, PluginRuntime, OpenClawConfig } from "./types-compat.js";
import { zh as t } from "./locale/zh.js";

/** 鑻ュ唴瀹瑰儚鍐呴儴閿欒锛圝SON 瑙ｆ瀽銆丄PI 鏍￠獙銆佹祦寮忎簨浠堕『搴忕瓑锛夛紝杩斿洖鍙嬪ソ鎻愮ず锛岄伩鍏嶆妸鍫嗘爤/閿欒鍘熸枃鍙戠粰鐢ㄦ埛 */
function sanitizeReplyText(text: string): string {
  if (!text || typeof text !== "string") return text;
  const s = text.trim();
  if (
    /^Unexpected\s+non-whitespace\s+character\s+after\s+JSON/i.test(s) ||
    /Unexpected\s+event\s+order/i.test(s) ||
    /\bmessage_start\b.*\bmessage_stop\b|\bcontent_block_stop\b.*\bmessage_start\b/i.test(s) ||
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

const REASONING_HINTS = [
  "思考",
  "推理",
  "reasoning",
  "analysis",
  "chain of thought",
  "internal note",
  "工具规划",
];

function stripProactiveReasoning(text: string): string {
  if (!text?.trim()) return text;
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const keep = paragraphs.filter((paragraph) => {
    const normalized = paragraph.toLowerCase();
    return !REASONING_HINTS.some((hint) => normalized.includes(hint.toLowerCase()));
  });
  return (keep.length ? keep[keep.length - 1] : paragraphs[paragraphs.length - 1] || "").trim();
}

function isSuppressedReplyText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    text.includes("[\u95ea\u53ea\u5a01\u5a13\u5806\u5d36\u9510\u5dee\u69fb]") ||
    text.includes("[\u5a51\u64b3\u79f4\u8930\u4fd4]") ||
    normalized === "[\u4e0d\u53d1]" ||
    normalized === "\u4e0d\u53d1" ||
    normalized === "[no reply]" ||
    normalized === "no reply"
  );
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

type InboundSource = "chat" | "proactive" | "qzone" | "synthetic";
type QzoneDispatchRecipient = "actor" | "owner_copy";

interface QzoneSyntheticEvent {
  type: "comment" | "like" | "post";
  userId: string;
  content: string;
  nickname: string;
  detail: string;
  tid?: string;
}

function detectInboundSource(msg: QQMessage, body: string): InboundSource {
  const senderName = getSenderDisplayName(msg);
  if (senderName === "system") return "proactive";
  if (msg.content.startsWith("[QQ") || body.includes("tid=") || senderName === "QZone") return "qzone";
  return "chat";
}

function buildQzoneCoalesceKey(event: QzoneSyntheticEvent, recipient: QzoneDispatchRecipient): string {
  const contentKey = event.content.replace(/\s+/g, " ").slice(0, 80);
  return `${recipient}:${event.type}:${event.userId}:${event.tid ?? "-"}:${contentKey}`;
}

export async function startGateway(params: GatewayParams): Promise<void> {
  const { ctx, ocConfig, accountId, runtime, abortSignal, setStatus, gatewayLog } = params;
  const log = gatewayLog ?? ctx.log;
  const config = ctx.config;
  const ownerId = Number(config.qzone.notifyUserId) || Number(config.connection.selfId || 0);
  const selfId = Number(config.connection.selfId || 0);

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
  const contactProfiles = new ContactProfileStore(config.paths.workspace, log);
  contactProfiles.bootstrapFromMemoryFiles();

  ctx.api = api;
  ctx.msgManager = msgManager;
  ctx.sessionStore = sessionStore;
  ctx.memoryManager = memoryManager;
  ctx.fileDownloader = fileDownloader;
  ctx.messageSender = sender;
  ctx.imageResolver = imageResolver;
  ctx.crossContextCache = crossContextCache;
  ctx.confidentialNotes = confidentialNotes;
  ctx.contactProfiles = contactProfiles;

  if (config.qzone.enabled) {
    ctx.qzoneApi = new QzoneAPI(
      config.qzone.bridgeUrl,
      config.qzone.accessToken || undefined,
      { timeoutMs: config.limits.apiTimeoutMs },
    );
    log.info(`[QQ] QZone bridge enabled 鈫?${config.qzone.bridgeUrl}`);
  }

  setInterval(() => crossContextCache.cleanup(), 60_000);
  const dispatchChains = new Map<string, Promise<void>>();
  const qzoneDispatchDedup = new Map<string, number>();

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

  const enqueueSyntheticPrivateMessage = (
    recipientUserId: number,
    senderUserId: number,
    nickname: string,
    content: string,
    now: number,
  ): void => {
    inbound.handleMessageEvent({
      post_type: "message",
      message_type: "private",
      message_id: getSyntheticMessageId(),
      user_id: recipientUserId,
      message: [{ type: "text", data: { text: content } }],
      raw_message: content,
      sender: { user_id: senderUserId, nickname },
      time: now,
      self_id: selfId,
    });
  };

  const shouldDispatchQzoneEvent = (event: QzoneSyntheticEvent, recipient: QzoneDispatchRecipient): boolean => {
    const ttlMs = event.type === "like" ? 30_000 : 12_000;
    const nowMs = Date.now();
    const key = buildQzoneCoalesceKey(event, recipient);
    const lastSeen = qzoneDispatchDedup.get(key) ?? 0;
    if (nowMs - lastSeen < ttlMs) {
      log.info?.(
        `[QZone-Event] coalesced type=${event.type} recipient=${recipient} ` +
        `user=${event.userId} tid=${event.tid ?? "-"} detail=${event.detail.slice(0, 60)}`,
      );
      return false;
    }
    qzoneDispatchDedup.set(key, nowMs);
    for (const [dedupKey, seenAt] of qzoneDispatchDedup) {
      if (nowMs - seenAt > 5 * 60_000) qzoneDispatchDedup.delete(dedupKey);
    }
    return true;
  };

  const handleQzoneSyntheticEvent = (event: QzoneSyntheticEvent): void => {
    const now = Math.floor(Date.now() / 1000);
    const actorUserId = Number(event.userId) || 0;
    if (!actorUserId) return;

    log.info?.(
      `[QZone-Event] type=${event.type} actor=${event.userId} owner=${ownerId} tid=${event.tid ?? "-"} ` +
      `detail=${event.detail.slice(0, 80)}`,
    );
    memoryManager.updateQzoneMemory(event.type, event.userId, event.nickname, event.detail, event.tid);

    if (shouldDispatchQzoneEvent(event, "actor")) {
      enqueueSyntheticPrivateMessage(
        actorUserId,
        actorUserId,
        event.nickname || "QZone",
        event.content,
        now,
      );
    }

    if (actorUserId !== ownerId && shouldDispatchQzoneEvent(event, "owner_copy")) {
      enqueueSyntheticPrivateMessage(
        ownerId,
        ownerId,
        "QZone",
        event.content,
        now,
      );
    }
  };

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
          ? `\n[保密须知（切勿在群内提及或透露来源）] ${confNote}`
          : "";
        bodyForAgent = `${currentTimeLine}\n\n${groupHeader}\n${identityBlock}${confBlock}\n\n${body}`;
      } else {
        // Private: full identity + recent group activity supplement + confidential notes
        const supplement = crossContextCache.buildPrivateChatSupplement(msg.userId);
        const confNote = confidentialNotes.getNotesForUser(msg.userId);
        const confBlock = confNote
          ? `\n[保密须知（切勿向对方提及或透露来源）] ${confNote}`
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
      if (msg.groupId) msgCtx.GroupSubject = `QQ缇?${msg.groupId}`;

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
      const source = detectInboundSource(msg, body);
      const isProactive = source === "proactive";
      const providerOverride = ctx.modelOverrides.get(route.sessionKey);
      const modelLabel = providerOverride ? `${providerOverride.provider}/${providerOverride.model}` : "default";

      log.info?.(
        `[QQ] Dispatch start source=${source} session=${route.sessionKey} chatType=${chatType} ` +
        `from=${msg.userId} target=${to} messageId=${msg.id} model=${modelLabel}`,
      );
      const deliver = async (payload: Record<string, unknown>, _info: Record<string, unknown>) => {
        const deliveredAt = new Date().toISOString();
        if (payload.isReasoning) return;
        let text = payload.text as string | undefined;
        if (text && isSuppressedReplyText(text)) return;
        if (text && isProactive) {
          text = stripProactiveReasoning(text);
          if (!text) return;
        }
        text = text ? sanitizeReplyText(text) : undefined;
        const mediaUrl = (payload.mediaUrl as string) || ((payload.mediaUrls as string[] | undefined)?.[0]);
        if (text || mediaUrl) {
          log.info?.(
            `[QQ] Deliver payload at=${deliveredAt} source=${source} session=${route.sessionKey} ` +
            `messageId=${msg.id} textLen=${text?.length ?? 0} media=${mediaUrl ? "yes" : "no"} ` +
            `preview=${(text ?? "").replace(/\s+/g, " ").slice(0, 40)}`,
          );
          if (!text && !mediaUrl) return;
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

      const previous = dispatchChains.get(route.sessionKey) ?? Promise.resolve();
      let releaseChain!: () => void;
      const current = new Promise<void>((resolve) => {
        releaseChain = resolve;
      });
      dispatchChains.set(route.sessionKey, previous.then(() => current));
      await previous;

      try {
        const replyDispatchStartedAt = new Date().toISOString();
        log.info?.(
          `[QQ] Reply dispatch begin at=${replyDispatchStartedAt} source=${source} session=${route.sessionKey} messageId=${msg.id}`,
        );
        await runtime.channel.reply.dispatchReplyFromConfig({
          ctx: finalCtx,
          cfg: ocConfig,
          dispatcher: result.dispatcher,
          replyOptions: result.replyOptions,
        });
        const replyDispatchFinishedAt = new Date().toISOString();
        log.info?.(
          `[QQ] Reply dispatch end at=${replyDispatchFinishedAt} source=${source} session=${route.sessionKey} messageId=${msg.id}`,
        );
      } finally {
        releaseChain();
        if (dispatchChains.get(route.sessionKey) === current) {
          dispatchChains.delete(route.sessionKey);
        }
        clearInterval(typingInterval);
        result.dispatcher.markComplete();
        await result.dispatcher.waitForIdle();
      }

      return null;
    } catch (e) {
      const errStr = String(e);
      const source = detectInboundSource(msg, body);
      const sessionKey = resolveSessionKey(msg);
      const providerOverride = ctx.modelOverrides.get(sessionKey);
      log.error(
        `[QQ] Agent dispatch error source=${source} session=${sessionKey} ` +
        `from=${msg.userId} group=${msg.groupId ?? "-"} messageId=${msg.id} ` +
        `model=${providerOverride ? `${providerOverride.provider}/${providerOverride.model}` : "default"} ` +
        `error=${errStr}`,
      );

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
    contactProfiles,
    resolveSessionKey,
    dispatchToAgent,
  });

  const eventHandler = new EventHandler({
    api,
    config,
    log,
    inbound,
    fileDownloader,
    contactProfiles,
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
        self_id: selfId,
      });
    },
  });

  client.addMessageHandler((event) => inbound.handleMessageEvent(event));
  client.addNoticeHandler((event) => eventHandler.handleNotice(event));
  client.addRequestHandler((event) => eventHandler.handleRequest(event));

  if (config.qzone.enabled && config.qzone.notifyEvents.length > 0) {
    const qzoneEvents = new QzoneEventListener(
      config.qzone,
      (type, userId, content, nickname, detail, tid) => {
        handleQzoneSyntheticEvent({ type, userId, content, nickname, detail, tid });
      },
      log,
    );
    qzoneEvents.start(abortSignal).catch((e) => {
      log.warn?.(`[QZone-Event] Listener exited: ${e}`);
    });
    log.info(`[QQ] QZone event listener 鈫?${config.qzone.eventWsUrl} (events: ${config.qzone.notifyEvents.join(",")})`);
  }

  setStatus({ state: "connecting", label: `QQ ${config.connection.selfId}` });
  proactive.start(abortSignal);
  log.info(`[QQ] Channel started for account ${config.connection.selfId}`);

  await client.start(abortSignal);
  setStatus({ state: "disconnected", label: `QQ ${config.connection.selfId}` });
}
