import type { PluginContext } from "./context.js";
import type { NapCatPluginConfig } from "./napcat/types.js";
import type { PluginLogger, OpenClawConfig, PluginRuntime } from "./types-compat.js";
export declare function createQQChannelPlugin(ctx: PluginContext, runtime: PluginRuntime): {
    id: "qq";
    meta: {
        name: string;
        emoji: string;
    };
    capabilities: {
        chatTypes: string[];
        media: boolean;
        groupManagement: boolean;
    };
    config: {
        listAccountIds: () => string[];
        resolveAccount: () => NapCatPluginConfig;
        defaultAccountId: () => string;
        isEnabled: () => boolean;
        isConfigured: () => boolean;
        unconfiguredReason: () => "缺少 selfId（Bot QQ 号）";
        describeAccount: () => {
            state: "connected";
            label: string;
        };
    };
    gateway: {
        startAccount(gwCtx: {
            cfg: OpenClawConfig;
            accountId: string;
            account: NapCatPluginConfig;
            runtime: PluginRuntime;
            abortSignal: AbortSignal;
            log?: PluginLogger;
            setStatus: (next: Record<string, unknown>) => void;
        }): Promise<void>;
    };
    outbound: {
        deliveryMode: "direct";
        sendText(outCtx: {
            cfg: OpenClawConfig;
            to: string;
            text: string;
            accountId?: string | null;
        }): Promise<{
            ok: boolean;
            error: Error;
            messageId?: undefined;
        } | {
            ok: boolean;
            messageId: string;
            error?: undefined;
        }>;
        sendMedia(outCtx: {
            cfg: OpenClawConfig;
            to: string;
            text: string;
            mediaUrl?: string;
            accountId?: string | null;
        }): Promise<{
            ok: boolean;
            error: Error;
            messageId?: undefined;
        } | {
            ok: boolean;
            messageId: string;
            error?: undefined;
        }>;
    };
    status: {
        probeAccount(params: {
            account: NapCatPluginConfig;
            timeoutMs: number;
        }): Promise<{
            ok: boolean;
            data: unknown;
            error?: undefined;
        } | {
            ok: boolean;
            error: string;
            data?: undefined;
        }>;
    };
};
