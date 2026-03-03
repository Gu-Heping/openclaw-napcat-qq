import { NapCatAPI } from "./napcat/api.js";
import { convertPlainAtToCq, expandInlineFaces } from "./util/cq-code.js";
import { startGateway } from "./gateway.js";
import type { PluginContext } from "./context.js";
import type { NapCatPluginConfig } from "./napcat/types.js";
import type { PluginLogger, OpenClawConfig, PluginRuntime } from "./types-compat.js";
import { zh as t } from "./locale/zh.js";

export function createQQChannelPlugin(
  ctx: PluginContext,
  runtime: PluginRuntime,
) {
  const config = ctx.config;
  const log = ctx.log;
  const accountId = config.connection.selfId || "default";

  return {
    id: "qq" as const,
    meta: { name: "QQ", emoji: "🐧" },
    capabilities: {
      chatTypes: ["dm", "group"] as string[],
      media: true,
      groupManagement: true,
    },
    config: {
      listAccountIds: () => [accountId],
      resolveAccount: () => config.connection,
      defaultAccountId: () => accountId,
      isEnabled: () => true,
      isConfigured: () => !!config.connection.selfId,
      unconfiguredReason: () => t.unconfigured,
      describeAccount: () => ({
        state: "connected" as const,
        label: `QQ ${config.connection.selfId}`,
      }),
    },
    gateway: {
      async startAccount(gwCtx: {
        cfg: OpenClawConfig;
        accountId: string;
        account: NapCatPluginConfig;
        runtime: PluginRuntime;
        abortSignal: AbortSignal;
        log?: PluginLogger;
        setStatus: (next: Record<string, unknown>) => void;
      }) {
        await startGateway({
          ctx,
          ocConfig: gwCtx.cfg,
          accountId: gwCtx.accountId,
          runtime,
          abortSignal: gwCtx.abortSignal,
          setStatus: gwCtx.setStatus,
          gatewayLog: gwCtx.log,
        });
      },
    },
    outbound: {
      deliveryMode: "direct" as const,
      async sendText(outCtx: {
        cfg: OpenClawConfig;
        to: string;
        text: string;
        accountId?: string | null;
      }) {
        const api = ctx.api;
        if (!api) return { ok: false, error: new Error("NapCat API not initialized") };
        const { to, text } = outCtx;
        let content: string | unknown[] = expandInlineFaces(text);

        if (to.startsWith("g:")) {
          const groupId = to.slice(2);
          content = typeof content === "string" ? convertPlainAtToCq(content) : content;
          const result = await api.sendGroupMsg(groupId, content);
          return result.status === "ok"
            ? { ok: true, messageId: String((result.data as Record<string, unknown>)?.message_id ?? "") }
            : { ok: false, error: new Error(result.message ?? "send failed") };
        }

        const userId = to.startsWith("p:") ? to.slice(2) : to;
        const result = await api.sendPrivateMsg(userId, content);
        return result.status === "ok"
          ? { ok: true, messageId: String((result.data as Record<string, unknown>)?.message_id ?? "") }
          : { ok: false, error: new Error(result.message ?? "send failed") };
      },
      async sendMedia(outCtx: {
        cfg: OpenClawConfig;
        to: string;
        text: string;
        mediaUrl?: string;
        accountId?: string | null;
      }) {
        const api = ctx.api;
        if (!api) return { ok: false, error: new Error("NapCat API not initialized") };
        const { to, mediaUrl, text } = outCtx;

        const segments: unknown[] = [];
        if (mediaUrl) segments.push({ type: "image", data: { file: mediaUrl } });
        if (text) segments.push({ type: "text", data: { text } });

        if (to.startsWith("g:")) {
          const result = await api.sendGroupMsg(to.slice(2), segments);
          return result.status === "ok"
            ? { ok: true, messageId: String((result.data as Record<string, unknown>)?.message_id ?? "") }
            : { ok: false, error: new Error(result.message ?? "send failed") };
        }

        const userId = to.startsWith("p:") ? to.slice(2) : to;
        const result = await api.sendPrivateMsg(userId, segments);
        return result.status === "ok"
          ? { ok: true, messageId: String((result.data as Record<string, unknown>)?.message_id ?? "") }
          : { ok: false, error: new Error(result.message ?? "send failed") };
      },
    },
    status: {
      async probeAccount(params: { account: NapCatPluginConfig; timeoutMs: number }) {
        const probeApi = new NapCatAPI(params.account.httpUrl, params.account.token);
        try {
          const result = await probeApi.getLoginInfo();
          return { ok: result.status === "ok", data: result.data };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
    },
  };
}
