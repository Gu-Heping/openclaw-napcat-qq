import * as path from "node:path";
import type { NapCatPluginConfig } from "./napcat/types.js";

export interface BehaviorConfig {
  botNames: string[];
  helpKeywords: string[];
  questionPatterns: string[];
  groupReplyProbInConvo: number;
  groupReplyProbRandom: number;
  groupReplyWindowMs: number;
  minIntervalMs: number;
  dedupTtlMs: number;
}

export interface ProactiveConfig {
  enabled: boolean;
  checkIntervalMs: number;
  minGlobalIntervalMs: number;
  perUserIntervalMs: number;
  minSinceUserMsgMs: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  pendingKeywords: string[];
}

export interface LimitsConfig {
  maxRetries: number;
  retryBaseDelayMs: number;
  apiTimeoutMs: number;
  apiRetryBackoffMs: number;
  imageMaxSize: number;
  fileMaxSize: number;
  uploadFileMaxSize: number;
  maxMessageHistory: number;
  maxPendingRequests: number;
}

export interface NetworkConfig {
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  pingIntervalMs: number;
  fetchTimeoutMs: number;
  imageFetchTimeoutMs: number;
}

export interface PathsConfig {
  workspace: string;
  home: string;
  imageTemp: string;
  sessionsDir: string;
  containerPrefixes: string[];
  textExts: string[];
}

export interface QzoneConfig {
  enabled: boolean;
  bridgeUrl: string;
  accessToken: string;
  eventWsUrl: string;
  notifyUserId: string;
  notifyEvents: ("comment" | "like" | "post")[];
}

/** 与 Telegram/WeCom 对齐的渠道策略，来自 openclaw.json 的 channels.qq */
export interface ChannelPolicyConfig {
  enabled?: boolean;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  allowFrom?: (string | number)[];
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: (string | number)[];
}

export interface BotConfig {
  connection: NapCatPluginConfig;
  behavior: BehaviorConfig;
  proactive: ProactiveConfig;
  models: Record<string, [provider: string, model: string]>;
  limits: LimitsConfig;
  network: NetworkConfig;
  paths: PathsConfig;
  qzone: QzoneConfig;
  /** 来自 channels.qq 的策略，与 Telegram/WeCom 一致 */
  channelPolicy?: ChannelPolicyConfig;
}

const DEFAULT_BEHAVIOR: BehaviorConfig = {
  botNames: ["peacebot", "peace bot", "bot", "\u673A\u5668\u4EBA", "\u5C0F\u52A9\u624B"],
  helpKeywords: ["\u5E2E\u52A9", "\u6307\u4EE4", "\u67E5\u8BE2", "\u641C\u7D22", "\u5929\u6C14"],
  questionPatterns: ["?", "\uFF1F", "\u600E\u4E48", "\u5982\u4F55", "\u4E3A\u4EC0\u4E48", "\u8BF7\u95EE", "\u8C01\u80FD"],
  groupReplyProbInConvo: 0.4,
  groupReplyProbRandom: 0.05,
  groupReplyWindowMs: 300_000,
  minIntervalMs: 1000,
  dedupTtlMs: 60_000,
};

const DEFAULT_PROACTIVE: ProactiveConfig = {
  enabled: true,
  checkIntervalMs: 60_000,
  minGlobalIntervalMs: 300_000,
  perUserIntervalMs: 4 * 3600_000,
  minSinceUserMsgMs: 30 * 60_000,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  pendingKeywords: ["\u5F85\u529E", "\u7EA6\u5B9A", "\u8BB0\u5F97", "\u522B\u5FD8\u4E86", "\u67E5\u5B8C\u53D1"],
};

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  kimi: "Kimi K2.5",
  "kimi-coding": "Kimi K2.5",
  claude: "Claude 3.5 Sonnet",
  deepseek: "DeepSeek v3.2",
  "kimi-or": "Kimi K2.5 (OpenRouter)",
  minimax: "MiniMax M2.1",
  qwen: "Qwen3 Coder",
  openrouter: "OpenRouter Auto",
  glm: "GLM-5-Turbo（智谱）",
};

const DEFAULT_MODELS: Record<string, [string, string]> = {
  kimi: ["kimi-coding", "k2p5"],
  "kimi-coding": ["kimi-coding", "k2p5"],
  claude: ["openrouter", "anthropic/claude-3.5-sonnet"],
  deepseek: ["openrouter", "deepseek/deepseek-chat-v3.2"],
  "kimi-or": ["openrouter", "moonshotai/kimi-k2.5"],
  minimax: ["openrouter", "minimax/minimax-m2.1"],
  qwen: ["openrouter", "qwen/qwen3-coder-next"],
  openrouter: ["openrouter", "auto"],
  glm: ["glm", "glm-5-turbo"],
};

const DEFAULT_LIMITS: LimitsConfig = {
  maxRetries: 3,
  retryBaseDelayMs: 2000,
  apiTimeoutMs: 10_000,
  apiRetryBackoffMs: 500,
  imageMaxSize: 15 * 1024 * 1024,
  fileMaxSize: 20 * 1024 * 1024,
  uploadFileMaxSize: 100 * 1024 * 1024,
  maxMessageHistory: 200,
  maxPendingRequests: 50,
};

const DEFAULT_NETWORK: NetworkConfig = {
  reconnectDelayMs: 3_000,
  maxReconnectDelayMs: 60_000,
  pingIntervalMs: 20_000,
  fetchTimeoutMs: 60_000,
  imageFetchTimeoutMs: 15_000,
};

function mergeSection<T>(defaults: T, overrides: Record<string, unknown>): T {
  const result = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null && key in (defaults as Record<string, unknown>)) {
      result[key] = value;
    }
  }
  return result as T;
}

function resolvePaths(overrides?: Record<string, unknown>): PathsConfig {
  const home =
    process.env["OPENCLAW_HOME"] ||
    path.join(process.env["HOME"] || "/root", ".openclaw");
  const workspace =
    process.env["OPENCLAW_WORKSPACE"] || path.join(home, "workspace");
  // OpenClaw 状态目录：OPENCLAW_HOME 为用户主目录时状态在 home/.openclaw，否则 home 即状态目录
  const stateDir =
    process.env["OPENCLAW_STATE_DIR"] ||
    (home.endsWith(".openclaw") ? home : path.join(home, ".openclaw"));
  const defaults: PathsConfig = {
    workspace,
    home,
    imageTemp: path.join(workspace, "qq_files", "images"),
    sessionsDir: path.join(stateDir, "agents", "main", "sessions"),
    containerPrefixes: ["/app/.config/QQ/", "/root/.config/QQ/"],
    textExts: [
      ".txt", ".md", ".json", ".csv", ".log", ".py", ".js", ".ts",
      ".html", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".sh",
    ],
  };
  if (overrides) return mergeSection<PathsConfig>(defaults, overrides);
  return defaults;
}

function resolveChannelPolicy(channelsQq?: Record<string, unknown> | null): ChannelPolicyConfig | undefined {
  if (!channelsQq || typeof channelsQq !== "object") return undefined;
  const p: ChannelPolicyConfig = {};
  if (typeof channelsQq.enabled === "boolean") p.enabled = channelsQq.enabled;
  if (channelsQq.dmPolicy === "open" || channelsQq.dmPolicy === "allowlist" || channelsQq.dmPolicy === "pairing" || channelsQq.dmPolicy === "disabled") {
    p.dmPolicy = channelsQq.dmPolicy;
  }
  if (Array.isArray(channelsQq.allowFrom)) p.allowFrom = channelsQq.allowFrom;
  if (channelsQq.groupPolicy === "open" || channelsQq.groupPolicy === "allowlist" || channelsQq.groupPolicy === "disabled") {
    p.groupPolicy = channelsQq.groupPolicy;
  }
  if (Array.isArray(channelsQq.groupAllowFrom)) p.groupAllowFrom = channelsQq.groupAllowFrom;
  if (Object.keys(p).length === 0) return undefined;
  return p;
}

export function resolveConfig(
  raw?: Record<string, unknown>,
  channelsQq?: Record<string, unknown> | null,
): BotConfig {
  const c = raw ?? {};
  const channelPolicy = resolveChannelPolicy(channelsQq);

  const connection: NapCatPluginConfig = {
    httpUrl: String(c.httpUrl ?? "http://127.0.0.1:3000"),
    wsUrl: String(c.wsUrl ?? "ws://127.0.0.1:3001"),
    token: String(c.token ?? ""),
    selfId: String(c.selfId ?? ""),
  };

  const qzoneRaw = (c.qzone ?? {}) as Record<string, unknown>;
  const qzone: QzoneConfig = {
    enabled: Boolean(qzoneRaw.enabled ?? false),
    bridgeUrl: String(qzoneRaw.bridgeUrl ?? "http://127.0.0.1:5700"),
    accessToken: String(qzoneRaw.accessToken ?? ""),
    eventWsUrl: String(qzoneRaw.eventWsUrl ?? "ws://127.0.0.1:5700/"),
    notifyUserId: String(qzoneRaw.notifyUserId ?? ""),
    // comment=评论通知 like=点赞通知 post=好友动态通知；需收好友动态时显式加 "post"
    notifyEvents: Array.isArray(qzoneRaw.notifyEvents)
      ? (qzoneRaw.notifyEvents as string[]).filter((e) => ["comment", "like", "post"].includes(e)) as ("comment" | "like" | "post")[]
      : ["comment", "like"],
  };

  return {
    connection,
    behavior: mergeSection(DEFAULT_BEHAVIOR, (c.behavior ?? {}) as Record<string, unknown>),
    proactive: mergeSection(DEFAULT_PROACTIVE, (c.proactive ?? {}) as Record<string, unknown>),
    models: { ...DEFAULT_MODELS, ...((c.models ?? {}) as Record<string, [string, string]>) },
    limits: mergeSection(DEFAULT_LIMITS, (c.limits ?? {}) as Record<string, unknown>),
    network: mergeSection(DEFAULT_NETWORK, (c.network ?? {}) as Record<string, unknown>),
    paths: resolvePaths((c.paths ?? undefined) as Record<string, unknown> | undefined),
    qzone,
    channelPolicy,
  };
}
