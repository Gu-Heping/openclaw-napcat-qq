import { NapCatAPI } from "./napcat/api.js";
import { convertPlainAtToCq, expandInlineFaces } from "./util/cq-code.js";
import { toImageFileParam } from "./util/image-file-param.js";
import { startGateway } from "./gateway.js";
import { zh as t } from "./locale/zh.js";
export function createQQChannelPlugin(ctx, runtime) {
    const config = ctx.config;
    const log = ctx.log;
    const accountId = config.connection.selfId || "default";
    return {
        id: "qq",
        meta: { name: "QQ", emoji: "🐧" },
        capabilities: {
            chatTypes: ["dm", "group"],
            media: true,
            groupManagement: true,
        },
        config: {
            listAccountIds: () => [accountId],
            resolveAccount: () => config.connection,
            defaultAccountId: () => accountId,
            isEnabled: () => config.channelPolicy?.enabled !== false,
            isConfigured: () => !!config.connection.selfId,
            unconfiguredReason: () => t.unconfigured,
            describeAccount: () => ({
                state: "connected",
                label: `QQ ${config.connection.selfId}`,
            }),
        },
        gateway: {
            async startAccount(gwCtx) {
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
            deliveryMode: "direct",
            async sendText(outCtx) {
                const api = ctx.api;
                if (!api)
                    return { ok: false, error: new Error("NapCat API not initialized") };
                const { to, text } = outCtx;
                let content = expandInlineFaces(text);
                if (to.startsWith("g:")) {
                    const groupId = to.slice(2);
                    content = typeof content === "string" ? convertPlainAtToCq(content) : content;
                    const result = await api.sendGroupMsg(groupId, content);
                    return result.status === "ok"
                        ? { ok: true, messageId: String(result.data?.message_id ?? "") }
                        : { ok: false, error: new Error(result.message ?? "send failed") };
                }
                const userId = to.startsWith("p:") ? to.slice(2) : to;
                const result = await api.sendPrivateMsg(userId, content);
                return result.status === "ok"
                    ? { ok: true, messageId: String(result.data?.message_id ?? "") }
                    : { ok: false, error: new Error(result.message ?? "send failed") };
            },
            async sendMedia(outCtx) {
                const api = ctx.api;
                if (!api)
                    return { ok: false, error: new Error("NapCat API not initialized") };
                const { to, mediaUrl, text } = outCtx;
                const segments = [];
                if (mediaUrl) {
                    const fileParam = toImageFileParam(mediaUrl, config.limits.imageMaxSize);
                    segments.push({ type: "image", data: { file: fileParam } });
                }
                if (text)
                    segments.push({ type: "text", data: { text } });
                if (to.startsWith("g:")) {
                    const result = await api.sendGroupMsg(to.slice(2), segments);
                    return result.status === "ok"
                        ? { ok: true, messageId: String(result.data?.message_id ?? "") }
                        : { ok: false, error: new Error(result.message ?? "send failed") };
                }
                const userId = to.startsWith("p:") ? to.slice(2) : to;
                const result = await api.sendPrivateMsg(userId, segments);
                return result.status === "ok"
                    ? { ok: true, messageId: String(result.data?.message_id ?? "") }
                    : { ok: false, error: new Error(result.message ?? "send failed") };
            },
        },
        status: {
            async probeAccount(params) {
                const probeApi = new NapCatAPI(params.account.httpUrl, params.account.token);
                try {
                    const result = await probeApi.getLoginInfo();
                    return { ok: result.status === "ok", data: result.data };
                }
                catch (e) {
                    return { ok: false, error: String(e) };
                }
            },
        },
    };
}
