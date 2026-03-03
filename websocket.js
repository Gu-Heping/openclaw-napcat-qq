/**
 * NapCat WebSocket Handler
 */

import { WebSocket } from "ws";

export class NapCatWebSocket {
  constructor(wsUrl, token = null) {
    this.wsUrl = wsUrl;
    this.token = token;
    this.ws = null;
    this.reconnectDelay = 3000;
    this.messageHandlers = [];
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        const headers = {};
        if (this.token) {
          headers["Authorization"] = `Bearer ${this.token}`;
        }

        this.ws = new WebSocket(this.wsUrl, { headers });

        this.ws.on("open", () => {
          console.log("[NapCat WS] Connected");
          this.reconnectDelay = 3000;
          resolve();
        });

        this.ws.on("message", (data) => {
          try {
            const event = JSON.parse(data.toString());
            this.handleEvent(event);
          } catch (e) {
            console.error("[NapCat WS] Parse error:", e);
          }
        });

        this.ws.on("error", (err) => {
          console.error("[NapCat WS] Error:", err);
          reject(err);
        });

        this.ws.on("close", () => {
          console.log("[NapCat WS] Closed, reconnecting...");
          setTimeout(() => this.connect(), this.reconnectDelay);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  handleEvent(event) {
    // OneBot11 事件处理
    if (event.post_type === "message") {
      const message = this.convertToChannelMessage(event);
      this.messageHandlers.forEach(handler => handler(message));
    }
  }

  convertToChannelMessage(event) {
    const message = event.message;
    let content = "";
    
    if (Array.isArray(message)) {
      content = message
        .filter(seg => seg.type === "text")
        .map(seg => seg.data?.text || "")
        .join("");
    } else {
      content = String(message);
    }

    return {
      id: String(event.message_id),
      channelId: event.message_type === "group" 
        ? `qq:g:${event.group_id}` 
        : `qq:p:${event.user_id}`,
      senderId: `qq:${event.user_id}`,
      content,
      timestamp: event.time * 1000,
      type: event.message_type === "group" ? "group" : "direct",
      raw: event
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
