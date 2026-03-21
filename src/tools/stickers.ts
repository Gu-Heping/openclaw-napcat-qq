import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";
import type { QQMessage } from "../napcat/types.js";
import {
  formatStickerSendParamHint,
  peekStickerReplyTarget,
} from "../util/sticker-reply-context.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

function parseTextArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

/** 去掉模型从正文复制的 Markdown 尾符、误加的前导冒号等（仅处理明显为 URL 的串）。 */
function sanitizeStickerCollectInput(raw: string): string {
  let s = raw.trim();
  if (s.startsWith(":") && /^:https?:\/\//i.test(s)) s = s.slice(1).trim();
  if (/^https?:\/\//i.test(s)) {
    while (s.length > 12 && /[\]\)}'"']$/.test(s)) s = s.slice(0, -1).trim();
  }
  return s;
}

/** QQ 入站图片常见 CDN；禁止任意公网 URL 以防 SSRF。 */
function isAllowedQqCdnImageUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "multimedia.nt.qq.com.cn" || h === "multimedia.qq.com") return true;
    if (h === "qpic.cn" || h.endsWith(".qpic.cn")) return true;
    if (h === "photo.store.qq.com") return true;
    if (h === "gtimg.cn" || h.endsWith(".gtimg.cn")) return true;
    return false;
  } catch {
    return false;
  }
}

function qqInboundImageUrlsMatch(candidateRaw: string, inboundRaw: string): boolean {
  const norm = (x: string) => {
    const t = x.trim();
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };
  try {
    const ua = new URL(norm(candidateRaw));
    const ub = new URL(norm(inboundRaw));
    if (ua.hostname.toLowerCase() !== ub.hostname.toLowerCase()) return false;
    const fa = ua.searchParams.get("fileid");
    const fb = ub.searchParams.get("fileid");
    if (fa && fb && fa === fb) return true;
    return `${ua.origin}${ua.pathname}${ua.search}` === `${ub.origin}${ub.pathname}${ub.search}`;
  } catch {
    return false;
  }
}

/** 与 ImageResolver 中 NapCat 收图目录映射一致，否则入站真实路径会被误判为「不在允许目录」。 */
function stickerCollectMediaPathPrefixes(workspace: string, imageTemp: string): string[] {
  const envHost = (process.env["NAPCAT_RECEIVED_FILE_HOST_PATH"] ?? "").trim();
  const napcatReceivedRoot = path.resolve(
    envHost || path.join(workspace, "qq_files", "napcat_config"),
  );
  return [
    path.resolve(imageTemp),
    path.resolve(workspace, "qq_files", "incoming"),
    path.resolve(workspace, "qq_files", "images"),
    napcatReceivedRoot,
  ];
}

type QqStickerFetchResult = { path: string | null; detail?: string };

async function fetchQqStickerImageToTemp(
  imageUrl: string,
  imageTemp: string,
  maxSize: number,
  timeoutMs: number,
): Promise<QqStickerFetchResult> {
  const url = imageUrl.trim();
  const headerSets: Record<string, string>[] = [
    {
      Referer: "https://qzone.qq.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    {
      Referer: "https://im.qq.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/*,*/*;q=0.8",
    },
  ];
  let lastDetail: string | undefined;
  for (const headers of headerSets) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers,
      });
      if (!resp.ok) {
        lastDetail = `HTTP ${resp.status}`;
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length === 0 || buf.length > maxSize) {
        lastDetail = buf.length === 0 ? "empty body" : `body too large (${buf.length})`;
        continue;
      }
      fs.mkdirSync(imageTemp, { recursive: true });
      const ct = (resp.headers.get("content-type") || "").toLowerCase();
      const ext = ct.includes("png") ? ".png" : ".jpg";
      const outPath = path.join(imageTemp, `${crypto.randomUUID()}${ext}`);
      fs.writeFileSync(outPath, buf);
      return { path: outPath };
    } catch (e) {
      lastDetail = String(e).replace(/\s+/g, " ").slice(0, 120);
    }
  }
  return { path: null, detail: lastDetail ?? "fetch failed" };
}

export function createStickerTools(ctx: PluginContext): AnyAgentTool[] {
  return [
    {
      name: "sticker_search",
      description:
        "检索已收藏表情包（梗图库）。QQ 上表达梗/情绪时**优先**走本工具→sticker_send，不要轻易降级成纯 [表情:名称] 或 emoji。" +
        "返回带 score 的列表（分数越高越相关，优先选 rank=1）；下一步 sticker_send。与 image（分析任意图）不同。",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "检索关键词，例如：无语/赞同/笑哭" },
          top_k: { type: "number", description: "返回数量，默认 5" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const query = String(params.query ?? "").trim();
        const topK = Number(params.top_k ?? 5);
        if (!query) return textResult("[错误] 缺少 query");
        const hits = store.searchWithScores(query, topK);
        if (!hits.length) return textResult("未找到匹配表情包");
        const lines = hits.map((h, i) => {
          const r = h.record;
          const sc = Number.isFinite(h.score) ? h.score.toFixed(2) : String(h.score);
          return `rank=${i + 1} score=${sc} | ${r.id} | ${r.semantics.title} | ${r.semantics.meaning} | aliases=${r.semantics.aliases.join(",") || "-"}`;
        });
        const best = hits[0]!;
        const bestSc = Number.isFinite(best.score) ? best.score.toFixed(2) : String(best.score);
        const head = `[最佳候选] rank=1 id=${best.record.id} score=${bestSc}（${best.record.semantics.title}）`;
        const hint = formatStickerSendParamHint(peekStickerReplyTarget(ctx));
        const chunks = [head, "", ...lines];
        if (hint) chunks.push("", hint);
        return textResult(chunks.join("\n"));
      },
    },
    {
      name: "sticker_send",
      description:
        "发送 sticker_search 选中的收藏表情图到 QQ（与 [表情:名称]、emoji 相比，**库图优先**）。须传 sticker_id；" +
        "私聊须传 user_id（对方 QQ），群聊须传 group_id（当前群号）。同轮对话中若省略 user_id/group_id，会按当前入站会话自动补全。" +
        "可选参数 text 一般留空即可（只发表情图）。若仍想避免同轮再发一条纯文字回复，**最终 assistant 输出请整段仅为** NO_REPLY 或 [不发]/[无需回复]/no reply（勿与正文混在同一行；群聊见静默规则）。" +
        "仅当没有合适库图时，再用正文 [表情:名称] 代替本工具。",
      parameters: {
        type: "object",
        required: ["sticker_id"],
        properties: {
          sticker_id: { type: "string", description: "sticker_search 返回的 ID" },
          user_id: { type: "string", description: "私聊目标 QQ（通常即当前会话对方）" },
          group_id: { type: "string", description: "群号（通常即当前群）" },
          text: { type: "string", description: "可选附带文本" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store || !ctx.messageSender) return textResult("[错误] 未初始化");
        const stickerId = String(params.sticker_id ?? "").trim();
        if (!stickerId) return textResult("[错误] 缺少 sticker_id");
        const record = store.getById(stickerId);
        if (!record) return textResult("[错误] sticker_id 不存在");
        let userId = String(params.user_id ?? "").trim();
        let groupId = String(params.group_id ?? "").trim();
        if (!userId && !groupId) {
          const d = peekStickerReplyTarget(ctx);
          if (d?.groupId) groupId = d.groupId;
          else if (d?.userId) userId = d.userId;
        }
        if (!userId && !groupId) {
          return textResult(
            "[错误] 需要 user_id 或 group_id；请根据当前私聊/群聊传入，或先在本会话内发一条消息再试。",
          );
        }
        const target = groupId || userId;
        const isGroup = Boolean(groupId);
        const outPath = store.resolveFilePath(record);
        const text = String(params.text ?? "");
        const res = await ctx.messageSender.send(target, isGroup, text, outPath);
        if (res.status === "ok") {
          store.incrementUsage(stickerId);
          return textResult("发送成功");
        }
        return textResult(`发送失败: ${res.message ?? res.retcode ?? "unknown"}`);
      },
    },
    {
      name: "sticker_get_semantics",
      description: "读取指定收藏表情的语义（含义、标签、适用场景）与近期修订历史；用户问「这表情啥意思」时用。",
      parameters: {
        type: "object",
        required: ["sticker_id"],
        properties: {
          sticker_id: { type: "string", description: "表情包 ID" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const stickerId = String(params.sticker_id ?? "");
        const rec = store.getById(stickerId);
        if (!rec) return textResult("[错误] 未找到该表情包");
        return textResult(JSON.stringify({
          id: rec.id,
          semantics: rec.semantics,
          semanticHistory: rec.semanticHistory.slice(-10),
        }, null, 2));
      },
    },
    {
      name: "sticker_update_semantics",
      description: "按用户说明修订收藏表情的语义（含义、标签等）；source 用 user-guided 表示用户口述约定。",
      parameters: {
        type: "object",
        required: ["sticker_id", "reason"],
        properties: {
          sticker_id: { type: "string", description: "表情包 ID" },
          reason: { type: "string", description: "变更原因" },
          source: { type: "string", description: "auto 或 user-guided" },
          title: { type: "string" },
          meaning: { type: "string" },
          emotion_tags: { type: "array", items: { type: "string" } },
          intent_tags: { type: "array", items: { type: "string" } },
          use_when: { type: "array", items: { type: "string" } },
          avoid_when: { type: "array", items: { type: "string" } },
          aliases: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const stickerId = String(params.sticker_id ?? "");
        const reason = String(params.reason ?? "");
        const source = String(params.source ?? "auto") === "user-guided" ? "user-guided" : "auto";
        const rec = store.updateSemantics(stickerId, {
          title: params.title ? String(params.title) : undefined,
          meaning: params.meaning ? String(params.meaning) : undefined,
          emotionTags: parseTextArray(params.emotion_tags),
          intentTags: parseTextArray(params.intent_tags),
          useWhen: parseTextArray(params.use_when),
          avoidWhen: parseTextArray(params.avoid_when),
          aliases: parseTextArray(params.aliases),
          confidence: params.confidence != null ? Number(params.confidence) : undefined,
        }, reason, source);
        if (!rec) return textResult("[错误] 更新失败或表情不存在");
        return textResult(`已更新 ${rec.id}: ${rec.semantics.title}`);
      },
    },
    {
      name: "sticker_collect",
      description:
        "在看过图片（含用 image 工具分析）后，若判断为值得收录的梗图/表情则调用；勿收截图、证件、隐私、纯风景等。入站不会自动入库，需本工具显式收藏。" +
        "二选一：① BodyForAgent 的 [本地图片路径]；② **上下文中出现的 QQ 官方 CDN 完整 https**（如 [图片:https://multimedia.nt.qq.com.cn/...]），**直接原样传入**即可，插件会拉取到临时目录再入库，**不必**依赖「本条 QQ 消息是否还带图」。" +
        "若当前入站栈里已有同 URL 的本地文件，会优先用本地副本。安全边界：仅白名单 QQ CDN 域名，禁止任意公网 URL（防 SSRF）。" +
        "**去重**：若库内已有同一张图则**不新建**第二条记录；重复收藏时返回会说明「库内已有相同图片」并给出原 `sticker_id`，同时增加使用计数。",
      parameters: {
        type: "object",
        required: ["local_image_path", "collect_reason"],
        properties: {
          local_image_path: {
            type: "string",
            description:
              "本地绝对路径；或 BodyForAgent/上文里的 QQ CDN https 完整链接（**会自动下载再入库**）。",
          },
          collect_reason: { type: "string", description: "为何值得收录（审计用）" },
          title: { type: "string", description: "可选标题，便于 sticker_search 检索" },
          meaning: { type: "string", description: "可选含义说明" },
          aliases: { type: "array", items: { type: "string" }, description: "可选检索别名" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const rawPath = sanitizeStickerCollectInput(String(params.local_image_path ?? ""));
        const reason = String(params.collect_reason ?? "").trim();
        if (!rawPath) return textResult("[错误] 缺少 local_image_path");
        if (!reason) return textResult("[错误] 缺少 collect_reason");
        const topStack = ctx.inboundMediaPathsStack.length > 0
          ? ctx.inboundMediaPathsStack[ctx.inboundMediaPathsStack.length - 1]
          : [];
        const topUrls = ctx.inboundImageUrlsStack.length > 0
          ? ctx.inboundImageUrlsStack[ctx.inboundImageUrlsStack.length - 1]
          : [];
        const isHttpLike = /^https?:\/\//i.test(rawPath);

        let absPath: string;

        if (isHttpLike) {
          if (!isAllowedQqCdnImageUrl(rawPath)) {
            return textResult(
              "[错误] 仅支持 QQ 官方图片 CDN 的链接（如 multimedia.nt.qq.com.cn、*.qpic.cn）；其它地址请先下载到本地再传绝对路径。",
            );
          }
          const normalizedUrl = /^https?:\/\//i.test(rawPath.trim()) ? rawPath.trim() : `https://${rawPath.trim()}`;
          const maxSize = ctx.config.limits?.imageMaxSize ?? 10 * 1024 * 1024;
          const timeoutMs = ctx.config.network?.imageFetchTimeoutMs ?? 30_000;

          let fromStack: string | undefined;
          const urlIdx = topUrls.findIndex((u) => qqInboundImageUrlsMatch(rawPath, u));
          if (urlIdx >= 0) {
            const stacked = topStack[urlIdx];
            if (stacked) {
              try {
                fromStack = fs.realpathSync(stacked);
              } catch {
                fromStack = undefined;
              }
            }
          }
          if (fromStack) {
            absPath = fromStack;
          } else {
            const fetchRes = await fetchQqStickerImageToTemp(
              normalizedUrl,
              ctx.config.paths.imageTemp,
              maxSize,
              timeoutMs,
            );
            // #region agent log
            fetch("http://localhost:7243/ingest/73a4a46f-7107-4b2b-b2e9-e178389b2a24", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                location: "stickers.ts:sticker_collect:qqFetch",
                message: fetchRes.path ? "qq_cdn_fetch_ok" : "qq_cdn_fetch_fail",
                data: {
                  hypothesisId: "H-fetch",
                  runId: "post-fix",
                  hadInboundUrlMatch: urlIdx >= 0,
                  topUrlsLen: topUrls.length,
                  detail: fetchRes.detail,
                  urlLen: normalizedUrl.length,
                },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            if (!fetchRes.path) {
              return textResult(
                `[错误] QQ 图片链接下载失败（${fetchRes.detail ?? "未知原因"}）。可稍后重试、确认链接完整无多余符号，或使用 BodyForAgent 的 [本地图片路径]。`,
              );
            }
            try {
              absPath = fs.realpathSync(fetchRes.path);
            } catch {
              return textResult("[错误] 无法解析下载后的图片路径");
            }
          }
        } else {
          const allowedResolved = new Set<string>();
          for (const p of topStack) {
            try {
              allowedResolved.add(fs.realpathSync(p));
            } catch { /* skip */ }
          }
          if (allowedResolved.size === 0) {
            return textResult(
              "[错误] 本条入站无可用本地图片路径；请把上下文中 [图片:https://…] 的完整 QQ CDN 链接作为 local_image_path 传入（会自动下载），或使用 BodyForAgent 的 [本地图片路径]。",
            );
          }
          let modeledAbs: string | null = null;
          try {
            modeledAbs = fs.realpathSync(rawPath);
          } catch {
            modeledAbs = null;
          }
          if (modeledAbs && allowedResolved.has(modeledAbs)) {
            absPath = modeledAbs;
          } else if (allowedResolved.size === 1) {
            absPath = [...allowedResolved][0];
          } else if (!modeledAbs) {
            return textResult("[错误] 路径不存在或无法解析");
          } else {
            return textResult("[错误] 路径不是本条入站消息关联的图片，请使用 [本地图片路径] 中的路径");
          }
        }
        const allowedPrefixes = stickerCollectMediaPathPrefixes(
          ctx.config.paths.workspace,
          ctx.config.paths.imageTemp,
        );
        if (!allowedPrefixes.some((p) => absPath === p || absPath.startsWith(p + path.sep))) {
          return textResult("[错误] 路径不在允许的媒体目录内，仅限本条入站消息的图片路径");
        }
        const ref = ctx.inboundMessageRefStack.length > 0
          ? ctx.inboundMessageRefStack[ctx.inboundMessageRefStack.length - 1]
          : null;
        const msgLike = {
          userId: ref?.userId ?? "unknown",
          id: ref?.messageId ?? "agent",
          stickerCandidates: [],
        } as unknown as QQMessage;
        const semantics = params.title || params.meaning || params.aliases
          ? {
              title: params.title ? String(params.title) : undefined,
              meaning: params.meaning ? String(params.meaning) : undefined,
              aliases: parseTextArray(params.aliases),
            }
          : undefined;
        const outcome = store.importFromFile(msgLike, absPath, {
          reason: `agent-collect:${reason}`,
          source: "user-guided",
          semantics,
        });
        if (outcome.kind === "failed") return textResult(`[错误] ${outcome.message}`);
        if (outcome.kind === "duplicate") {
          return textResult(
            `已收藏（库内已有相同图片，未新建记录）。sticker_id=${outcome.record.id} title=${outcome.record.semantics.title}；已为该表情增加使用计数。`,
          );
        }
        return textResult(`已收藏（新记录），sticker_id=${outcome.record.id} title=${outcome.record.semantics.title}`);
      },
    },
    {
      name: "sticker_alias_add",
      description: "给收藏表情增加检索别名，便于 sticker_search 命中口语叫法。",
      parameters: {
        type: "object",
        required: ["sticker_id", "alias"],
        properties: {
          sticker_id: { type: "string", description: "表情包 ID" },
          alias: { type: "string", description: "别名" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const store = ctx.stickerStore;
        if (!store) return textResult("[错误] sticker store 未初始化");
        const rec = store.addAlias(String(params.sticker_id ?? ""), String(params.alias ?? ""));
        if (!rec) return textResult("[错误] 添加别名失败");
        return textResult(`已添加别名，当前 aliases=${rec.semantics.aliases.join(", ")}`);
      },
    },
  ];
}
