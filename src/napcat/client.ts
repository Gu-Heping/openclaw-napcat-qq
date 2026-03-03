import WebSocket from "ws";
import type { OneBotEvent, OneBotMessageEvent, OneBotNoticeEvent, OneBotRequestEvent } from "./types.js";

export type EventHandler<T> = (event: T) => void | Promise<void>;

export interface NapCatClientOptions {
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  pingIntervalMs?: number;
}

export class NapCatClient {
  private wsUrl: string;
  private token?: string;
  private ws: WebSocket | null = null;
  private running = false;
  private reconnectDelay: number;
  private initialReconnectDelay: number;
  private maxReconnectDelay: number;
  private pingIntervalMs: number;
  private abortController: AbortController | null = null;

  private onMessage: EventHandler<OneBotMessageEvent>[] = [];
  private onNotice: EventHandler<OneBotNoticeEvent>[] = [];
  private onRequest: EventHandler<OneBotRequestEvent>[] = [];
  private log: { info: (msg: string) => void; warn: (msg: string) => void; debug?: (msg: string) => void };

  constructor(
    wsUrl: string,
    token: string | undefined,
    log: { info: (msg: string) => void; warn: (msg: string) => void; debug?: (msg: string) => void },
    opts?: NapCatClientOptions,
  ) {
    this.wsUrl = wsUrl;
    this.token = token;
    this.log = log;
    this.initialReconnectDelay = opts?.reconnectDelayMs ?? 3_000;
    this.reconnectDelay = this.initialReconnectDelay;
    this.maxReconnectDelay = opts?.maxReconnectDelayMs ?? 60_000;
    this.pingIntervalMs = opts?.pingIntervalMs ?? 20_000;
  }

  addMessageHandler(handler: EventHandler<OneBotMessageEvent>) { this.onMessage.push(handler); }
  addNoticeHandler(handler: EventHandler<OneBotNoticeEvent>) { this.onNotice.push(handler); }
  addRequestHandler(handler: EventHandler<OneBotRequestEvent>) { this.onRequest.push(handler); }

  async start(signal: AbortSignal): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();

    const onAbort = () => { this.running = false; this.ws?.close(); };
    signal.addEventListener("abort", onAbort, { once: true });

    while (this.running) {
      try {
        await this.connectOnce();
      } catch (e) {
        if (!this.running) break;
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`[NapCat] Connection error: ${msg}`);
      }
      if (!this.running) break;
      const jitter = this.reconnectDelay * 0.2 * (Math.random() * 2 - 1);
      const wait = Math.max(1000, this.reconnectDelay + jitter);
      this.log.info(`[NapCat] Reconnecting in ${(wait / 1000).toFixed(1)}s...`);
      await new Promise((r) => setTimeout(r, wait));
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    signal.removeEventListener("abort", onAbort);
  }

  stop() {
    this.running = false;
    this.ws?.close();
    this.abortController?.abort();
  }

  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

      this.log.info(`[NapCat] Connecting to ${this.wsUrl}...`);
      const ws = new WebSocket(this.wsUrl, { headers });

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, this.pingIntervalMs);

      ws.on("open", () => {
        this.ws = ws;
        this.reconnectDelay = this.initialReconnectDelay;
        this.log.info("[NapCat] Connected!");
      });

      ws.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString()) as OneBotEvent;
          this.dispatch(event);
        } catch (e) {
          this.log.warn(`[NapCat] Invalid JSON: ${e}`);
        }
      });

      ws.on("close", (code, reason) => {
        clearInterval(pingInterval);
        this.ws = null;
        this.log.info(`[NapCat] Connection closed code=${code} reason=${reason.toString()}`);
        resolve();
      });

      ws.on("error", (err) => {
        clearInterval(pingInterval);
        this.ws = null;
        reject(err);
      });
    });
  }

  private dispatch(event: OneBotEvent) {
    const runHandlers = (handlers: EventHandler<unknown>[], ev: unknown) => {
      for (const h of handlers) {
        try {
          const result = h(ev);
          if (result && typeof (result as Promise<void>).catch === "function") {
            (result as Promise<void>).catch((e) => {
              this.log.warn(`[NapCat] Async handler error: ${e}`);
            });
          }
        } catch (e) {
          this.log.warn(`[NapCat] Handler error: ${e}`);
        }
      }
    };

    if (event.post_type === "message") {
      runHandlers(this.onMessage as EventHandler<unknown>[], event);
    } else if (event.post_type === "notice") {
      runHandlers(this.onNotice as EventHandler<unknown>[], event);
    } else if (event.post_type === "request") {
      runHandlers(this.onRequest as EventHandler<unknown>[], event);
    }
  }
}
