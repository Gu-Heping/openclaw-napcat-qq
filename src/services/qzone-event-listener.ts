import WebSocket from "ws";
import type { QzoneConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";

interface QzoneEvent {
  post_type: string;
  notice_type?: string;
  meta_event_type?: string;
  message_type?: string;
  sub_type?: string;
  self_id?: number;
  time?: number;
  user_id?: number;
  sender_name?: string;
  sender?: { user_id?: number; nickname?: string };
  raw_message?: string;
  comment_content?: string;
  comment_id?: string;
  post_uin?: number;
  post_tid?: string;
  _tid?: string;
  _uin?: string;
  _abstime?: number;
  _cmtnum?: number;
  _pics?: string[];
  _from_friend?: boolean;
  _appid?: string;
  _typeid?: string;
  _app_name?: string;
  _app_share_title?: string;
  _like_unikey?: string;
  _like_curkey?: string;
  _forward_content?: string;
  _forward_uin?: string;
  _forward_nickname?: string;
}

export type QzoneDispatchFn = (
  type: "comment" | "like" | "post",
  userId: string,
  content: string,
  nickname: string,
  detail: string,
  tid?: string,
) => void;

export class QzoneEventListener {
  private ws: WebSocket | null = null;
  private running = false;
  private reconnectDelay: number;
  private readonly initialReconnectDelay = 5_000;
  private readonly maxReconnectDelay = 120_000;

  constructor(
    private qzoneCfg: QzoneConfig,
    private dispatch: QzoneDispatchFn,
    private log: PluginLogger,
  ) {
    this.reconnectDelay = this.initialReconnectDelay;
  }

  async start(signal: AbortSignal): Promise<void> {
    this.running = true;
    const onAbort = () => { this.running = false; this.ws?.close(); };
    signal.addEventListener("abort", onAbort, { once: true });

    while (this.running) {
      try {
        await this.connectOnce();
      } catch (e) {
        if (!this.running) break;
        this.log.warn?.(`[QZone-Event] Connection error: ${e instanceof Error ? e.message : e}`);
      }
      if (!this.running) break;
      const jitter = this.reconnectDelay * 0.2 * (Math.random() * 2 - 1);
      const wait = Math.max(2000, this.reconnectDelay + jitter);
      this.log.info(`[QZone-Event] Reconnecting in ${(wait / 1000).toFixed(1)}s...`);
      await new Promise((r) => setTimeout(r, wait));
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    signal.removeEventListener("abort", onAbort);
  }

  stop() {
    this.running = false;
    this.ws?.close();
  }

  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = this.qzoneCfg.eventWsUrl;
      const headers: Record<string, string> = {};
      if (this.qzoneCfg.accessToken) {
        headers["Authorization"] = `Bearer ${this.qzoneCfg.accessToken}`;
      }

      this.log.info(`[QZone-Event] Connecting to ${url}...`);
      const ws = new WebSocket(url, { headers });

      const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 30_000);

      ws.on("open", () => {
        this.ws = ws;
        this.reconnectDelay = this.initialReconnectDelay;
        this.log.info("[QZone-Event] Connected");
      });

      ws.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString()) as QzoneEvent;
          this.handleEvent(event);
        } catch {
          // ignore malformed JSON
        }
      });

      ws.on("close", (code, reason) => {
        clearInterval(pingTimer);
        this.ws = null;
        this.log.info(`[QZone-Event] Closed code=${code} reason=${reason.toString()}`);
        resolve();
      });

      ws.on("error", (err) => {
        clearInterval(pingTimer);
        this.ws = null;
        reject(err);
      });
    });
  }

  private handleEvent(event: QzoneEvent): void {
    if (event.post_type === "meta_event") return;

    const uid = Number(event.user_id ?? event._uin ?? 0);
    if (!uid || uid <= 0) {
      this.log.info?.(`[QZone-Event] Skipped event with invalid user_id=${event.user_id}`);
      return;
    }

    const allowed = this.qzoneCfg.notifyEvents;

    if (event.post_type === "notice" && event.notice_type === "qzone_comment" && allowed.includes("comment")) {
      this.dispatchComment(event);
    } else if (event.post_type === "notice" && event.notice_type === "qzone_like" && allowed.includes("like")) {
      this.dispatchLike(event);
    } else if (event.post_type === "message" && allowed.includes("post") && event._from_friend) {
      this.dispatchFriendPost(event);
    }
  }

  private dispatchComment(ev: QzoneEvent): void {
    const userId = String(ev.user_id ?? "0");
    const nickname = ev.sender_name || "";
    const content = ev.comment_content ?? "";
    const tid = ev.post_tid ?? ev._tid ?? "";
    const commentId = ev.comment_id ?? "";

    const who = nickname || userId;
    let text = `[QQ空间·评论] ${who} 评论了你的说说`;
    if (content) text += `：「${content.length > 200 ? content.slice(0, 200) + "…" : content}」`;
    if (tid) text += `\ntid=${tid}`;
    if (commentId && userId) text += `\n回复可传 reply_comment_id=${commentId} reply_uin=${userId}`;

    const detail = content ? `评论「${content.slice(0, 80)}」` : "评论了说说";
    this.dispatch("comment", userId, text, nickname, detail, tid);
  }

  private dispatchLike(ev: QzoneEvent): void {
    const userId = String(ev.user_id ?? "0");
    const nickname = ev.sender_name || "";
    const tid = ev.post_tid ?? ev._tid ?? "";

    const who = nickname || userId;
    let text = `[QQ空间·点赞] ${who} 赞了你的说说`;
    if (tid) text += `\ntid=${tid}`;

    this.dispatch("like", userId, text, nickname, "赞了说说", tid);
  }

  private dispatchFriendPost(ev: QzoneEvent): void {
    const userId = String(ev.user_id ?? ev._uin ?? "0");
    const nickname = ev.sender?.nickname || "";
    const content = ev.raw_message ?? "";
    const pics = ev._pics ?? [];
    const tid = ev._tid ?? "";
    const appName = ev._app_name ?? "";
    const appShareTitle = ev._app_share_title ?? "";
    const fwdContent = ev._forward_content ?? "";
    const fwdNickname = ev._forward_nickname ?? "";
    const appid = ev._appid ?? "311";
    const isAppShare = appid !== "311" && appid !== "";

    const who = nickname || userId;
    const typeLabel = isAppShare && appName ? `[${appName}]` : fwdContent ? "[转发]" : "[说说]";

    let text = `[QQ空间·好友动态] ${who} 发布了新动态 ${typeLabel}`;
    if (content) text += `：「${content.length > 200 ? content.slice(0, 200) + "…" : content}」`;
    if (appShareTitle && appShareTitle !== content) text += `\n分享标题: ${appShareTitle}`;
    if (fwdContent) text += `\n转发自 ${fwdNickname}: ${fwdContent.slice(0, 100)}`;
    if (pics.length > 0) text += `\n(包含 ${pics.length} 张图片)`;
    if (tid) text += `\ntid=${tid}`;

    const detail = content ? `发布「${content.slice(0, 80)}」` : "发布了新动态";
    this.dispatch("post", userId, text, nickname, detail, tid);
  }
}
