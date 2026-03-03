export interface PluginLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface OpenClawConfig {
  [key: string]: unknown;
}

export interface PluginRuntime {
  version: string;
  config: { loadConfig: () => OpenClawConfig };
  channel: {
    text: {
      chunkMarkdownText: (text: string, limit: number) => string[];
      resolveTextChunkLimit: (cfg: OpenClawConfig, channel: string) => number;
      [key: string]: unknown;
    };
    reply: {
      dispatchReplyFromConfig: (params: {
        ctx: Record<string, unknown>;
        cfg: OpenClawConfig;
        dispatcher: unknown;
        replyOptions?: Record<string, unknown>;
      }) => Promise<{ queuedFinal: boolean; counts: Record<string, number> }>;
      createReplyDispatcherWithTyping: (opts: Record<string, unknown>) => unknown;
      finalizeInboundContext: (ctx: Record<string, unknown>) => Record<string, unknown>;
      [key: string]: unknown;
    };
    routing: {
      resolveAgentRoute: (input: {
        cfg: OpenClawConfig;
        channel: string;
        accountId?: string | null;
        peer?: { id: string } | null;
        guildId?: string | null;
      }) => {
        agentId: string;
        channel: string;
        accountId: string;
        sessionKey: string;
        mainSessionKey: string;
        matchedBy: string;
      };
    };
    session: {
      recordSessionMetaFromInbound: (params: Record<string, unknown>) => void;
      recordInboundSession: (params: Record<string, unknown>) => void;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerTool: (tool: AnyAgentTool, opts?: { name?: string; optional?: boolean }) => void;
  registerHook: (events: string | string[], handler: (...args: unknown[]) => unknown, opts?: Record<string, unknown>) => void;
  registerChannel: (registration: { plugin: ChannelPluginDef } | ChannelPluginDef) => void;
  registerService: (service: { id: string; start: (ctx: unknown) => unknown; stop: () => unknown }) => void;
  resolvePath: (input: string) => string;
  on: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: Record<string, unknown>) => void;
  [key: string]: unknown;
}

export interface AnyAgentTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<AgentToolResult>;
}

export interface AgentToolResult {
  content: Array<{ type: string; text?: string; uri?: string; name?: string; mimeType?: string }>;
  details?: unknown;
  isError?: boolean;
}

export interface ChannelPluginDef {
  id: string;
  meta: { name: string; emoji?: string };
  capabilities: {
    chatTypes: string[];
    media?: boolean;
    groupManagement?: boolean;
    [key: string]: unknown;
  };
  config: Record<string, unknown>;
  gateway?: Record<string, unknown>;
  outbound?: Record<string, unknown>;
  status?: Record<string, unknown>;
  agentTools?: unknown;
  [key: string]: unknown;
}
