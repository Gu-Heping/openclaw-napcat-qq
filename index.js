/**
 * NapCat QQ Channel Plugin for OpenClaw
 */

import { NapCatClient } from "./client.js";
import { NapCatWebSocket } from "./websocket.js";

let runtime = null;
let client = null;
let wsConnection = null;

export function setNapCatRuntime(rt) {
  runtime = rt;
}

export function getNapCatRuntime() {
  if (!runtime) {
    throw new Error("NapCat QQ runtime not initialized");
  }
  return runtime;
}

// QQ Channel Plugin
export const napcatQQPlugin = {
  id: "qq",
  
  meta: {
    id: "qq",
    name: "QQ",
    description: "NapCat OneBot11 QQ Channel",
    features: {
      text: true,
      images: true,
      files: false,
      reactions: false,
      threads: false,
      voice: false,
      video: false
    }
  },

  capabilities: {
    directMessages: true,
    groupMessages: true,
    richText: false,
    markdown: false,
    html: false,
    mentions: false,
    hashtags: false
  },

  config: {
    getSchema: () => ({
      type: "object",
      properties: {
        httpUrl: { type: "string", default: "http://127.0.0.1:3000" },
        wsUrl: { type: "string", default: "ws://127.0.0.1:3001" },
        token: { type: "string" },
        selfId: { type: "string" }
      }
    }),
    validate: (config) => ({ valid: true }),
    defaults: {
      httpUrl: "http://127.0.0.1:3000",
      wsUrl: "ws://127.0.0.1:3001"
    },
    listAccountIds: (config) => {
      const qqConfig = config?.channels?.qq;
      const accounts = qqConfig?.accounts;
      if (accounts && typeof accounts === "object") {
        return Object.keys(accounts).filter(id => accounts[id]?.enabled !== false);
      }
      return ["default"];
    },
    resolveAccount: (config, accountId) => {
      const qqConfig = config?.channels?.qq;
      const accounts = qqConfig?.accounts;
      const account = accounts?.[accountId] || {};
      return {
        accountId: accountId || "default",
        enabled: account?.enabled !== false,
        httpUrl: account?.httpUrl || "http://127.0.0.1:3000",
        wsUrl: account?.wsUrl || "ws://127.0.0.1:3001",
        token: account?.token,
        selfId: accountId || "default"
      };
    },
    isEnabled: () => true,
    isConfigured: () => true
  },

  outbound: {
    sendMessage: async (message, options) => {
      console.log("[NapCat QQ] Sending message:", message);
      
      if (!client) {
        return { ok: false, error: "Client not initialized" };
      }

      try {
        const channelId = message.channelId || options?.channelId;
        const content = message.content || message.text || "";
        
        let result;
        if (channelId?.startsWith("qq:g:")) {
          // 群消息
          const groupId = channelId.replace("qq:g:", "");
          result = await client.sendGroupMsg(groupId, content);
        } else {
          // 私聊消息
          const userId = channelId?.replace("qq:p:", "") || options?.userId;
          result = await client.sendPrivateMsg(userId, content);
        }

        if (result.status === "ok") {
          return { ok: true, messageId: String(result.data?.message_id) };
        } else {
          return { ok: false, error: result.message || "Unknown error" };
        }
      } catch (error) {
        console.error("[NapCat QQ] Send failed:", error);
        return { ok: false, error: error.message };
      }
    },
    
    editMessage: async (messageId, newContent) => {
      console.log("[NapCat QQ] Editing message:", messageId);
      // QQ 不支持编辑消息
    },
    
    deleteMessage: async (messageId) => {
      console.log("[NapCat QQ] Deleting message:", messageId);
      // TODO: 实现撤回消息
    },
    
    sendTyping: async (channelId) => {
      console.log("[NapCat QQ] Sending typing:", channelId);
      // TODO: 实现输入状态
    }
  },

  initialize: async (config, api) => {
    console.log("[NapCat QQ] Initializing with config:", config);
    
    // 创建 HTTP 客户端
    client = new NapCatClient(config.httpUrl, config.token);
    
    // 测试连接
    const loginInfo = await client.getLoginInfo();
    console.log("[NapCat QQ] Login info:", loginInfo);
    
    // 创建 WebSocket 连接
    wsConnection = new NapCatWebSocket(config.wsUrl, config.token);
    
    // 注册消息处理器
    wsConnection.onMessage(async (message) => {
      console.log("[NapCat QQ] Received message:", message);
      
      // 转发到 OpenClaw Gateway
      try {
        await forwardToOpenClaw(message, api);
      } catch (e) {
        console.error("[NapCat QQ] Failed to forward to OpenClaw:", e);
      }
    });
    
    // 连接 WebSocket
    try {
      await wsConnection.connect();
    } catch (e) {
      console.error("[NapCat QQ] WebSocket connect failed:", e);
    }
  },

  shutdown: async () => {
    console.log("[NapCat QQ] Shutting down");
    if (wsConnection) {
      wsConnection.disconnect();
    }
  }
};

// Plugin config
export const pluginConfig = {
  getSchema: () => ({
    type: "object",
    additionalProperties: false,
    properties: {
      httpUrl: { type: "string", default: "http://127.0.0.1:3000" },
      wsUrl: { type: "string", default: "ws://127.0.0.1:3001" },
      token: { type: "string" },
      selfId: { type: "string" }
    }
  }),
  validate: (config) => ({ valid: true }),
  defaults: {
    httpUrl: "http://127.0.0.1:3000",
    wsUrl: "ws://127.0.0.1:3001"
  },
  listAccountIds: (config) => config.selfId ? [config.selfId] : ["default"]
};

// Plugin entry
const plugin = {
  id: "napcat-qq",
  name: "NapCat QQ",
  description: "NapCat OneBot11 QQ Channel Plugin",
  config: pluginConfig,
  register(api) {
    setNapCatRuntime(api.runtime);
    api.registerChannel({ plugin: napcatQQPlugin });
    console.log("[NapCat QQ] Plugin registered");
    
    // 硬编码配置（从 openclaw.json 读取的值）
    const config = {
      httpUrl: "http://127.0.0.1:3000",
      wsUrl: "ws://127.0.0.1:3001",
      token: "napcat-token-123456",
      selfId: "2492835361"
    };
    console.log("[NapCat QQ] Starting initialization...");
    napcatQQPlugin.initialize(config, api).catch(err => {
      console.error("[NapCat QQ] Initialize failed:", err);
    });
  },
};

// 转发消息到 OpenClaw Gateway
async function forwardToOpenClaw(message, api) {
  // 构建 OpenClaw 消息格式
  const openclawMessage = {
    channel: "qq",
    provider: "qq",
    from: message.senderId,
    to: message.channelId,
    content: message.content,
    timestamp: message.timestamp,
    messageId: message.id,
    type: message.type,
    raw: message.raw
  };
  
  console.log("[NapCat QQ] Forwarding to OpenClaw:", openclawMessage);
  
  // 方法1: 尝试使用 api 的 hook 系统
  if (api?.registerHook) {
    console.log("[NapCat QQ] Using registerHook to forward message");
  }
  
  // 方法2: enqueueSystemEvent(text, { sessionKey }) — 仅私聊时有 sessionKey，用于在 OpenClaw 中记录系统事件
  const sessionKey = message.channelId?.startsWith("qq:p:")
    ? `agent:main:qq:direct:${message.channelId.replace("qq:p:", "")}`
    : null;
  if (sessionKey && api?.runtime?.system?.enqueueSystemEvent && message.content) {
    try {
      const eventText = `QQ 私聊 ${message.senderId}: ${(message.content || "").slice(0, 200)}`;
      api.runtime.system.enqueueSystemEvent(eventText, { sessionKey });
    } catch (e) {
      console.warn("[NapCat QQ] enqueueSystemEvent failed:", e?.message || e);
    }
  }

  // 方法3: 使用命令行调用 agent（当前使用）
  console.log("[NapCat QQ] Checking conditions:", { 
    hasContent: !!message.content, 
    channelId: message.channelId,
    isPrivate: message.channelId?.startsWith("qq:p:")
  });
  
  if (message.content && message.channelId?.startsWith("qq:p:")) {
    const userId = message.channelId.replace("qq:p:", "");
    console.log("[NapCat QQ] Conditions met, userId:", userId);
    try {
      console.log("[NapCat QQ] Calling agent via CLI...");
      
      // 构建 session key（基于用户 ID）
      const sessionKey = `agent:main:qq:direct:${userId}`;
      
      // 调用 openclaw agent 命令（超时 3 分钟，避免 Gateway 握手或长回复导致 ETIMEDOUT）
      const agentTimeoutMs = Number(process.env.OPENCLAW_AGENT_CLI_TIMEOUT_MS) || 180000;
      const { execSync } = await import("child_process");
      const result = execSync(
        `openclaw agent --session-id "${sessionKey}" --message "${message.content.replace(/"/g, '\\"')}" --json`,
        {
          encoding: "utf-8",
          timeout: agentTimeoutMs,
          env: { ...process.env, OPENCLAW_GATEWAY_TOKEN: "16182aa4061a0d50d987dec2c5a5d222a676a18e79ee4372" }
        }
      );
      
      console.log("[NapCat QQ] Agent result:", result);
      
      // 解析结果并发送回复
      try {
        const response = JSON.parse(result);
        if (response?.message?.content) {
          const replyText = response.message.content;
          await client.sendPrivateMsg(userId, replyText);
          console.log("[NapCat QQ] Agent reply sent");
        }
      } catch (e) {
        console.error("[NapCat QQ] Failed to parse agent result:", e);
        // 发送原始结果
        await client.sendPrivateMsg(userId, `Agent 回复:\n${result.slice(0, 500)}`);
      }
    } catch (e) {
      console.error("[NapCat QQ] Failed to call agent:", e);
      const userId = message.channelId.replace("qq:p:", "");
      const isTimeout = /ETIMEDOUT|timed out|timeout/i.test(String(e.message));
      const errMsg = isTimeout
        ? "抱歉，处理超时（AI 或网关响应过慢），请稍后再试。"
        : `抱歉，处理消息时出错: ${e.message}`;
      await client.sendPrivateMsg(userId, errMsg);
    }
  }
}

export default plugin;
