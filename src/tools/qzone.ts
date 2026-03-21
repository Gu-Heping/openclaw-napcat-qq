import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";
import type { QzoneBridgeResponse } from "../napcat/qzone-api.js";
import { normalizeFaceFormatForQzone } from "../util/cq-code.js";

type JsonObject = Record<string, unknown>;

const MAX_POSTS_WITH_BASE64 = 5;
const MAX_BASE64_IMAGES_PER_POST = 2;
const SIMPLE_QZONE_EMOJIS: Record<string, string> = {
  doge: "e249",
  OK: "e189",
  ok: "e189",
  NO: "e188",
  no: "e188",
};

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

function formatResponse(res: QzoneBridgeResponse, successMsg?: string): string {
  if (res.status === "ok" || res.retcode === 0) {
    if (successMsg) return successMsg;
    return res.data ? JSON.stringify(res.data, null, 2) : "ok";
  }
  return `[QZone错误] ${res.message ?? `retcode=${res.retcode}`}`;
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(obj: JsonObject | null, ...keys: string[]): string {
  if (!obj) return "";
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function readNumber(obj: JsonObject | null, ...keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeQzoneContent(content: string): string {
  if (!content) return content;
  const normalized = normalizeFaceFormatForQzone(content);
  return normalized.replace(/\[([^[\]]+)\]/g, (match, name) => {
    const code = SIMPLE_QZONE_EMOJIS[name.trim()];
    return code ? `[em]${code}[/em]` : match;
  });
}

function formatQzoneTimeForDisplay(msg: JsonObject | null): string {
  const createTime2 = readString(msg, "createTime2", "create_time2");
  if (createTime2) return createTime2;
  const createTime = readString(msg, "createTime", "create_time", "createtime", "time", "visitTime");
  if (createTime) return createTime;
  const ts = readNumber(msg, "created_time", "createdTime", "createtime", "time", "visitTime");
  if (ts != null) {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
  }
  return "未知时间";
}

function writeBase64ImageToTemp(b64: string, contentType: string, imageTempDir: string): string | null {
  try {
    const buffer = Buffer.from(b64, "base64");
    if (buffer.length === 0) return null;
    const ext = (contentType || "").toLowerCase().includes("png") ? ".png" : ".jpg";
    fs.mkdirSync(imageTempDir, { recursive: true });
    const outPath = path.join(imageTempDir, `qzone_${crypto.randomUUID()}${ext}`);
    fs.writeFileSync(outPath, buffer);
    return outPath;
  } catch {
    return null;
  }
}

function summarizePost(post: JsonObject | null, fallbackUserId: string | undefined, imageTempDir: string, state: { postsWithBase64: number }): string {
  const tid = readString(post, "tid", "message_id", "id") || "-";
  const uin = readString(post, "uin", "user_id", "owner_uin") || fallbackUserId || "-";
  const time = formatQzoneTimeForDisplay(post);
  const text = readString(post, "content", "message", "text", "summary") || "(无正文)";
  const commentCount = readNumber(post, "cmtnum", "commentnum", "comment_count") ?? 0;
  const likeCount = readNumber(post, "likenum", "like_count", "likeCount") ?? 0;
  const pics = asArray(post?.pic);
  const picUrls = pics
    .map((item) => readString(asObject(item), "url", "pic_url", "origin_url"))
    .filter(Boolean);

  const lines = [`[${time}] tid=${tid} user=${uin} 评论=${commentCount} 点赞=${likeCount}`, `  ${text}`];
  if (picUrls.length > 0) {
    lines.push(`  图片URL: ${picUrls.join(" | ")}`);
  }

  const canAttachBase64 = pics.length > 0 && state.postsWithBase64 < MAX_POSTS_WITH_BASE64;
  if (canAttachBase64) {
    let attached = 0;
    for (const item of pics) {
      if (attached >= MAX_BASE64_IMAGES_PER_POST) break;
      const pic = asObject(item);
      const base64 = readString(pic, "base64");
      if (!base64) continue;
      const contentType = readString(pic, "content_type") || "image/jpeg";
      const localPath = writeBase64ImageToTemp(base64, contentType, imageTempDir);
      if (!localPath) continue;
      attached += 1;
      lines.push(`  本地图片${attached}: ${localPath}`);
    }
    if (attached > 0) {
      state.postsWithBase64 += 1;
      lines.push("  可用 image 工具分析以上本地图片");
    }
  }

  return lines.join("\n");
}

function summarizeComment(comment: JsonObject | null): string {
  const id = readString(comment, "id", "comment_id") || "-";
  const uin = readString(comment, "uin", "user_id") || "-";
  const nickname = readString(comment, "nickname", "name") || "-";
  const time = formatQzoneTimeForDisplay(comment);
  const content = readString(comment, "content", "text", "message") || "(空评论)";
  return `[${time}] id=${id} user=${uin} name=${nickname}\n  ${content}`;
}

function summarizeFeed(feed: JsonObject | null, imageTempDir: string, state: { postsWithBase64: number }): string {
  const userId = readString(feed, "uin", "user_id", "owner_uin");
  return summarizePost(feed, userId, imageTempDir, state);
}

function extractPosts(data: unknown): JsonObject[] {
  const obj = asObject(data);
  const buckets = [obj?.msglist, obj?.list, obj?.posts, obj?.items, obj?.data];
  for (const bucket of buckets) {
    const arr = asArray(bucket).map((item) => asObject(item)).filter(Boolean) as JsonObject[];
    if (arr.length > 0) return arr;
  }
  return [];
}

function extractComments(data: unknown): JsonObject[] {
  const obj = asObject(data);
  const buckets = [obj?.comments, obj?.comment_list, obj?.list, obj?.data];
  for (const bucket of buckets) {
    const arr = asArray(bucket).map((item) => asObject(item)).filter(Boolean) as JsonObject[];
    if (arr.length > 0) return arr;
  }
  return [];
}

function extractFeeds(data: unknown): JsonObject[] {
  const obj = asObject(data);
  // onebot-qzone get_friend_feeds 返回 msglist；兼容 feeds / feed_list 等
  const buckets = [obj?.msglist, obj?.feeds, obj?.feed_list, obj?.list, obj?.items, obj?.data];
  for (const bucket of buckets) {
    const arr = asArray(bucket).map((item) => asObject(item)).filter(Boolean) as JsonObject[];
    if (arr.length > 0) return arr;
  }
  return [];
}

function extractLikeNames(data: unknown): string[] {
  const obj = asObject(data);
  const buckets = [obj?.likes, obj?.list, obj?.users, obj?.data];
  for (const bucket of buckets) {
    const arr = asArray(bucket);
    if (arr.length === 0) continue;
    return arr.map((item) => {
      const like = asObject(item);
      return readString(like, "nickname", "name", "uin", "user_id") || String(item);
    });
  }
  return [];
}

function readBooleanParam(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function readBoolLoose(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "string") return ["1", "true", "yes"].includes(v.toLowerCase());
  return Boolean(v);
}

/**
 * OpenClaw 友好：固定分隔的 `_meta`，键名与 onebot-qzone 桥接返回对齐；含可照抄的 next_call。
 */
function buildQzoneMetaBlock(
  data: JsonObject | null,
  ctx: {
    kind: "posts" | "friend_feeds" | "post_detail";
    self_id: string;
    user_id?: string;
    tid?: string;
    offset?: number;
    count?: number;
    max_pages?: number;
    cursor_used?: string;
    bridge_ok?: boolean;
  },
): string {
  const lines: string[] = ["---", "_meta"];
  const effUser = (ctx.user_id?.trim() || ctx.self_id).trim();

  if (ctx.kind === "posts") {
    const off = ctx.offset ?? 0;
    const cnt = ctx.count ?? 20;
    const mp = ctx.max_pages ?? 5;
    lines.push("kind: posts_list");
    lines.push("tool: qzone_get_posts");
    lines.push(`user_id: ${effUser}`);
    lines.push(`offset: ${off}`);
    lines.push("note: offset 与桥接 get_emotion_list 的参数 pos 同义，从 0 起");
    lines.push(`count: ${cnt}`);
    lines.push(`max_pages: ${mp}`);
    if (data) {
      lines.push(`has_more: ${readBoolLoose(data["has_more"])}`);
      const np = data["next_pos"];
      if (np != null && String(np).length > 0) lines.push(`next_pos: ${np}`);
      const nc = readString(data, "next_cursor");
      if (nc) lines.push(`next_cursor: ${nc}`);
      const src = readString(data, "_source");
      if (src) lines.push(`_source: ${src}`);
      const pi = data["_page_info"];
      if (pi && typeof pi === "object") lines.push(`_page_info: ${JSON.stringify(pi)}`);
    }
    if (data && readBoolLoose(data["has_more"])) {
      const nextPos = readNumber(data, "next_pos") ?? off + extractPosts(data).length;
      lines.push(`next_call: qzone_get_posts user_id=${effUser} offset=${nextPos} count=${cnt} max_pages=${mp}`);
    }
  } else if (ctx.kind === "friend_feeds") {
    lines.push("kind: friend_feeds");
    lines.push("tool: qzone_get_friend_feeds");
    const cnt = ctx.count;
    if (cnt != null && Number.isFinite(cnt)) lines.push(`count: ${cnt}`);
    lines.push("note: cursor 须从本响应 _meta.next_cursor 原样复制，勿编造");
    if (ctx.cursor_used != null && ctx.cursor_used !== "") lines.push(`cursor_used_len: ${ctx.cursor_used.length}`);
    if (data) {
      lines.push(`has_more: ${readBoolLoose(data["has_more"])}`);
      const nc = readString(data, "next_cursor", "cursor");
      if (nc) lines.push(`next_cursor: ${nc}`);
      const pi = data["_page_info"];
      if (pi && typeof pi === "object") lines.push(`_page_info: ${JSON.stringify(pi)}`);
      if (readBoolLoose(data["has_more"]) && nc) {
        const countPart = cnt != null && Number.isFinite(cnt) ? ` count=${Math.trunc(cnt)}` : "";
        lines.push(`next_call: qzone_get_friend_feeds cursor=${JSON.stringify(nc)}${countPart}`);
      }
    }
  } else {
    lines.push("kind: post_detail");
    lines.push("tool: qzone_get_post_detail");
    lines.push(`user_id: ${ctx.user_id ?? ""}`);
    lines.push(`tid: ${ctx.tid ?? ""}`);
    lines.push(`bridge_ok: ${ctx.bridge_ok ?? false}`);
  }
  return lines.join("\n");
}

export function createQzoneTools(ctx: PluginContext): AnyAgentTool[] {
  const selfId = ctx.config.connection.selfId || "unknown";
  const imageTempDir = ctx.config.paths.imageTemp;

  const guard = (): string | null => {
    if (!ctx.qzoneApi) return "[QZone错误] QZone API 未启用，请先配置 qzone.enabled = true";
    return null;
  };

  return [
    {
      name: "qzone_publish",
      description: `发布一条 QQ 空间说说。content 为正文，可选 images 为图片 URL 或 base64://。当前账号: ${selfId}`,
      parameters: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", description: "说说正文" },
          images: { type: "array", items: { type: "string" }, description: "图片 URL 或 base64:// 列表" },
          who_can_see: { type: "number", description: "可见范围，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const content = normalizeQzoneContent(String(params.content ?? ""));
        if (!content) return textResult("[QZone错误] 缺少 content");
        const images = Array.isArray(params.images) ? params.images.map((item) => String(item)) : undefined;
        const whoCanSee = params.who_can_see == null ? undefined : Number(params.who_can_see);
        const res = await ctx.qzoneApi!.publish(content, images, Number.isFinite(whoCanSee) ? whoCanSee : undefined);
        const data = asObject(res.data);
        if (res.status === "ok") {
          return textResult(`发布成功 tid=${readString(data, "tid", "message_id") || "-"}`);
        }
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_emoji_list",
      description: "查看当前内置支持的 QZone 简单表情别名。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const lines = Object.entries(SIMPLE_QZONE_EMOJIS).map(([name, code]) => `[表情:${name}] -> ${code}`);
        return textResult(`当前内置支持的 QZone 表情别名:\n${lines.join("\n")}`);
      },
    },
    {
      name: "qzone_delete",
      description: "删除一条 QQ 空间说说。",
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          tid: { type: "string", description: "说说 tid" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[QZone错误] 缺少 tid");
        const res = await ctx.qzoneApi!.deleteEmotion(tid);
        return textResult(formatResponse(res, `删除成功 tid=${tid}`));
      },
    },
    {
      name: "qzone_get_posts",
      description:
        "拉取「指定 QQ 号的空间主页说说时间线」（自己或他人）。分页用 offset+count（offset=桥接 pos，从 0 起），与好友混排流不同。" +
        "若要看「全好友混排最近动态」请用 qzone_get_friend_feeds（cursor 游标）。" +
        "需要单条完整结构/转发链时用 qzone_get_post_detail。" +
        ` 当前账号: ${selfId}。默认摘要+末尾 _meta；raw_json=true 返回整段 JSON（常含图片 base64，体积大，仅明确需要原始字段时用）。`,
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "空间主人 QQ；省略则为当前登录账号" },
          count: { type: "number", description: "本页条数，默认 20；与桥接 num 一致" },
          offset: {
            type: "number",
            description: "起始偏移，默认 0；与桥接 pos 同义。续翻用上一段 _meta.next_call 或 next_pos",
          },
          max_pages: {
            type: "number",
            description: "桥接单次请求内最多翻 feeds3 页数，默认 5；越大越完整但更慢",
          },
          raw_json: {
            type: "boolean",
            description: "为 true 时仅输出合法 JSON（ok/retcode/data），默认 false 为可读摘要+_meta",
          },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = params.user_id ? String(params.user_id) : undefined;
        const count = Number(params.count ?? 20);
        const offset = Number(params.offset ?? 0);
        const maxPages = Number(params.max_pages ?? 5);
        const rawJson = readBooleanParam(params.raw_json);
        const res = await ctx.qzoneApi!.getEmotionList(
          userId,
          Number.isFinite(offset) ? offset : 0,
          Number.isFinite(count) ? count : 20,
          Number.isFinite(maxPages) ? maxPages : 5,
          true,
        );
        if (res.status !== "ok") return textResult(formatResponse(res));
        if (rawJson) {
          return textResult(JSON.stringify({ ok: true, retcode: res.retcode, data: res.data }, null, 2));
        }
        const dataObj = asObject(res.data);
        const meta = buildQzoneMetaBlock(dataObj, {
          kind: "posts",
          self_id: selfId,
          user_id: userId,
          offset: Number.isFinite(offset) ? offset : 0,
          count: Number.isFinite(count) ? count : 20,
          max_pages: Number.isFinite(maxPages) ? maxPages : 5,
        });
        const posts = extractPosts(res.data);
        if (posts.length === 0) return textResult(`没有找到说说。\n\n${meta}`);
        const state = { postsWithBase64: 0 };
        const lines = posts.map((post) => summarizePost(post, userId, imageTempDir, state));
        return textResult(`说说列表 (${posts.length} 条):\n\n${lines.join("\n\n")}\n\n${meta}`);
      },
    },
    {
      name: "qzone_get_post_detail",
      description:
        "获取单条说说的完整详情（桥接 get_msg），用于列表摘要不足时查看原文、转发、扩展字段。" +
        "参数 user_id 为说说所属空间主人 QQ，tid 为说说 id。" +
        ` 当前账号: ${selfId}。默认摘要+_meta；raw_json=true 返回整段 JSON（可能含大图字段）。`,
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "说说所属用户 QQ（空间主人）" },
          tid: { type: "string", description: "说说 tid" },
          raw_json: {
            type: "boolean",
            description: "为 true 时仅输出合法 JSON（ok/retcode/data）",
          },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[QZone错误] 缺少 user_id 或 tid");
        const rawJson = readBooleanParam(params.raw_json);
        const res = await ctx.qzoneApi!.getDetail(userId, tid);
        const ok = res.status === "ok" || res.retcode === 0;
        const meta = buildQzoneMetaBlock(asObject(res.data), {
          kind: "post_detail",
          self_id: selfId,
          user_id: userId,
          tid,
          bridge_ok: ok,
        });
        if (!ok) {
          return textResult(`${formatResponse(res)}\n\n${meta}`);
        }
        if (rawJson) {
          return textResult(JSON.stringify({ ok: true, retcode: res.retcode, data: res.data }, null, 2));
        }
        const detail = asObject(res.data) ?? asObject((res.data as { data?: unknown })?.data);
        const state = { postsWithBase64: 0 };
        const summary = detail
          ? summarizePost(detail, userId, imageTempDir, state)
          : "(无解析字段，请 raw_json=true)";
        return textResult(`说说详情:\n${summary}\n\n${meta}`);
      },
    },
    {
      name: "qzone_get_post_images",
      description: "查看指定说说的图片 URL 列表。",
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
          tid: { type: "string", description: "说说 tid" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[QZone错误] 缺少 user_id 或 tid");
        const res = await ctx.qzoneApi!.getFeedImages(userId, tid);
        if (res.status !== "ok") return textResult(formatResponse(res));
        const urls = asArray(asObject(res.data)?.urls).map((item) => String(item)).filter(Boolean);
        if (urls.length === 0) return textResult("该说说没有图片。");
        return textResult(`图片列表 (${urls.length} 张):\n${urls.map((url, index) => `${index + 1}. ${url}`).join("\n")}`);
      },
    },
    {
      name: "qzone_comment",
      description: "对说说发表评论，支持回复已有评论。",
      parameters: {
        type: "object",
        required: ["tid", "content"],
        properties: {
          tid: { type: "string", description: "说说 tid" },
          content: { type: "string", description: "评论内容" },
          user_id: { type: "string", description: "目标用户 QQ 号，可选" },
          reply_comment_id: { type: "string", description: "要回复的评论 ID，可选" },
          reply_uin: { type: "string", description: "被回复者 QQ 号，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        const content = normalizeQzoneContent(String(params.content ?? ""));
        if (!tid || !content) return textResult("[QZone错误] 缺少 tid 或 content");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const replyCommentId = params.reply_comment_id ? String(params.reply_comment_id) : undefined;
        const replyUin = params.reply_uin ? String(params.reply_uin) : undefined;
        const res = await ctx.qzoneApi!.sendComment(tid, content, userId, replyCommentId, replyUin);
        return textResult(formatResponse(res, `评论发送成功 tid=${tid}`));
      },
    },
    {
      name: "qzone_get_comments",
      description: "查看说说评论列表。",
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
          tid: { type: "string", description: "说说 tid" },
          count: { type: "number", description: "数量，默认 20" },
          offset: { type: "number", description: "偏移，默认 0" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[QZone错误] 缺少 user_id 或 tid");
        const count = Number(params.count ?? 20);
        const offset = Number(params.offset ?? 0);
        const res = await ctx.qzoneApi!.getCommentList(userId, tid, Number.isFinite(count) ? count : 20, Number.isFinite(offset) ? offset : 0);
        if (res.status !== "ok") return textResult(formatResponse(res));
        const comments = extractComments(res.data);
        if (comments.length === 0) return textResult("没有找到评论。");
        return textResult(`评论列表 (${comments.length} 条):\n\n${comments.map((comment) => summarizeComment(comment)).join("\n\n")}`);
      },
    },
    {
      name: "qzone_delete_comment",
      description: "删除一条说说评论。",
      parameters: {
        type: "object",
        required: ["user_id", "tid", "comment_id"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
          tid: { type: "string", description: "说说 tid" },
          comment_id: { type: "string", description: "评论 ID" },
          comment_uin: { type: "string", description: "评论者 QQ 号，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        const commentId = String(params.comment_id ?? "");
        if (!userId || !tid || !commentId) return textResult("[QZone错误] 缺少 user_id、tid 或 comment_id");
        const commentUin = params.comment_uin ? String(params.comment_uin) : undefined;
        const res = await ctx.qzoneApi!.deleteComment(userId, tid, commentId, commentUin);
        return textResult(formatResponse(res, `删除评论成功 id=${commentId}`));
      },
    },
    {
      name: "qzone_like",
      description: "给一条说说点赞。",
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          tid: { type: "string", description: "说说 tid" },
          user_id: { type: "string", description: "目标用户 QQ 号，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[QZone错误] 缺少 tid");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.sendLike(tid, userId);
        return textResult(formatResponse(res, `点赞成功 tid=${tid}`));
      },
    },
    {
      name: "qzone_get_likes",
      description: "查看一条说说的点赞列表。",
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
          tid: { type: "string", description: "说说 tid" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[QZone错误] 缺少 user_id 或 tid");
        const res = await ctx.qzoneApi!.getLikeList(userId, tid);
        if (res.status !== "ok") return textResult(formatResponse(res));
        const names = extractLikeNames(res.data);
        if (names.length === 0) return textResult("没有找到点赞记录。");
        return textResult(`点赞列表 (${names.length} 条):\n${names.map((name, index) => `${index + 1}. ${name}`).join("\n")}`);
      },
    },
    {
      name: "qzone_unlike",
      description: "取消一条说说的点赞。",
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          tid: { type: "string", description: "说说 tid" },
          user_id: { type: "string", description: "目标用户 QQ 号，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[QZone错误] 缺少 tid");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.unlike(tid, userId);
        return textResult(formatResponse(res, `取消点赞成功 tid=${tid}`));
      },
    },
    {
      name: "qzone_forward",
      description: "转发一条说说，可附带转发文案。",
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
          tid: { type: "string", description: "说说 tid" },
          content: { type: "string", description: "转发附言，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[QZone错误] 缺少 user_id 或 tid");
        const content = params.content ? normalizeQzoneContent(String(params.content)) : undefined;
        const res = await ctx.qzoneApi!.forwardMsg(userId, tid, content);
        return textResult(formatResponse(res, `转发成功 tid=${tid}`));
      },
    },
    {
      name: "qzone_get_friend_feeds",
      description:
        "拉取「好友混排」最近空间动态（与指定某人主页时间线不同）。分页用 cursor：须从上一响应 _meta.next_cursor 原样复制，勿编造。" +
        "要看某个固定 QQ 的主页说说列表请用 qzone_get_posts（offset/count）。" +
        ` 当前账号: ${selfId}。默认摘要+_meta；raw_json=true 返回整段 JSON（可能含 base64，体积大）。`,
      parameters: {
        type: "object",
        properties: {
          cursor: {
            type: "string",
            description: "上一段 _meta.next_cursor；首次调用可省略。勿手写伪造",
          },
          count: { type: "number", description: "本批条数，可选；与桥接 num 一致" },
          raw_json: {
            type: "boolean",
            description: "为 true 时仅输出合法 JSON（ok/retcode/data），默认 false",
          },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const cursor = params.cursor ? String(params.cursor) : undefined;
        const countRaw = params.count == null ? undefined : Number(params.count);
        const countArg = countRaw != null && Number.isFinite(countRaw) ? countRaw : undefined;
        const rawJson = readBooleanParam(params.raw_json);
        const res = await ctx.qzoneApi!.getFriendFeeds(cursor, countArg, true);
        if (res.status !== "ok") return textResult(formatResponse(res));
        if (rawJson) {
          return textResult(JSON.stringify({ ok: true, retcode: res.retcode, data: res.data }, null, 2));
        }
        const dataObj = asObject(res.data);
        const meta = buildQzoneMetaBlock(dataObj, {
          kind: "friend_feeds",
          self_id: selfId,
          cursor_used: cursor ?? "",
          count: countArg,
        });
        const feeds = extractFeeds(res.data);
        if (feeds.length === 0) return textResult(`没有找到好友动态。\n\n${meta}`);
        const state = { postsWithBase64: 0 };
        const lines = feeds.map((feed) => summarizeFeed(feed, imageTempDir, state));
        return textResult(`好友动态 (${feeds.length} 条):\n\n${lines.join("\n\n")}\n\n${meta}`);
      },
    },
    {
      name: "qzone_get_visitors",
      description: "查看最近访客。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户 QQ 号，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.getVisitorList(userId);
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_get_traffic",
      description: "查看指定说说的流量数据。",
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
          tid: { type: "string", description: "说说 tid" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[QZone错误] 缺少 user_id 或 tid");
        const res = await ctx.qzoneApi!.getTrafficData(userId, tid);
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_set_privacy",
      description: "设置说说公开或私密。",
      parameters: {
        type: "object",
        required: ["tid", "privacy"],
        properties: {
          tid: { type: "string", description: "说说 tid" },
          privacy: { type: "string", enum: ["private", "public"], description: "可见性" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        const privacy = String(params.privacy ?? "");
        if (!tid || (privacy !== "private" && privacy !== "public")) {
          return textResult("[QZone错误] 缺少 tid 或 privacy 非法");
        }
        const res = await ctx.qzoneApi!.setEmotionPrivacy(tid, privacy);
        return textResult(formatResponse(res, `隐私设置成功 tid=${tid} privacy=${privacy}`));
      },
    },
    {
      name: "qzone_get_portrait",
      description: "查看用户空间头像或资料接口结果。",
      parameters: {
        type: "object",
        required: ["user_id"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        if (!userId) return textResult("[QZone错误] 缺少 user_id");
        const res = await ctx.qzoneApi!.getPortrait(userId);
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_upload_image",
      description: "上传一张图片到 QZone，支持 URL 或 base64://。",
      parameters: {
        type: "object",
        required: ["image"],
        properties: {
          image: { type: "string", description: "图片 URL 或 base64://" },
          album_id: { type: "string", description: "相册 ID，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const image = String(params.image ?? "");
        if (!image) return textResult("[QZone错误] 缺少 image");
        const albumId = params.album_id ? String(params.album_id) : undefined;
        const res = await ctx.qzoneApi!.uploadImage(image, albumId);
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_get_albums",
      description: "查看相册列表。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户 QQ 号，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.getAlbumList(userId);
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_get_photos",
      description: "查看相册中的图片列表。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户 QQ 号，可选" },
          album_id: { type: "string", description: "相册 ID，可选" },
          count: { type: "number", description: "数量，默认 30" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = params.user_id ? String(params.user_id) : undefined;
        const albumId = params.album_id ? String(params.album_id) : undefined;
        const count = Number(params.count ?? 30);
        const res = await ctx.qzoneApi!.getPhotoList(userId, albumId, Number.isFinite(count) ? count : 30);
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_create_album",
      description: "创建一个相册。",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "相册名称" },
          desc: { type: "string", description: "相册描述，可选" },
          priv: { type: "number", description: "隐私等级，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const name = String(params.name ?? "");
        if (!name) return textResult("[QZone错误] 缺少 name");
        const desc = params.desc ? String(params.desc) : undefined;
        const priv = params.priv == null ? undefined : Number(params.priv);
        const res = await ctx.qzoneApi!.createAlbum(name, desc, Number.isFinite(priv) ? priv : undefined);
        return textResult(formatResponse(res, `创建相册成功 name=${name}`));
      },
    },
    {
      name: "qzone_delete_album",
      description: "删除一个相册。",
      parameters: {
        type: "object",
        required: ["album_id"],
        properties: {
          album_id: { type: "string", description: "相册 ID" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const albumId = String(params.album_id ?? "");
        if (!albumId) return textResult("[QZone错误] 缺少 album_id");
        const res = await ctx.qzoneApi!.deleteAlbum(albumId);
        return textResult(formatResponse(res, `删除相册成功 album_id=${albumId}`));
      },
    },
    {
      name: "qzone_delete_photo",
      description: "删除一张相册图片。",
      parameters: {
        type: "object",
        required: ["album_id", "photo_id"],
        properties: {
          album_id: { type: "string", description: "相册 ID" },
          photo_id: { type: "string", description: "图片 ID" },
          user_id: { type: "string", description: "用户 QQ 号，可选" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const albumId = String(params.album_id ?? "");
        const photoId = String(params.photo_id ?? "");
        if (!albumId || !photoId) return textResult("[QZone错误] 缺少 album_id 或 photo_id");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.deletePhoto(albumId, photoId, userId);
        return textResult(formatResponse(res, `删除图片成功 photo_id=${photoId}`));
      },
    },
    {
      name: "qzone_status",
      description: "查看 QZone 桥接状态、Cookie 和登录信息。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const err = guard();
        if (err) return textResult(err);
        const [statusRes, cookieRes, loginRes] = await Promise.all([
          ctx.qzoneApi!.getStatus(),
          ctx.qzoneApi!.checkCookie(),
          ctx.qzoneApi!.getLoginInfo(),
        ]);
        return textResult(
          [
            `status: ${formatResponse(statusRes)}`,
            `cookie: ${formatResponse(cookieRes)}`,
            `login: ${formatResponse(loginRes)}`,
          ].join("\n\n"),
        );
      },
    },
    {
      name: "qzone_version",
      description: "查看 onebot-qzone 桥接版本信息。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const err = guard();
        if (err) return textResult(err);
        const res = await ctx.qzoneApi!.getVersionInfo();
        return textResult(formatResponse(res));
      },
    },
    {
      name: "qzone_probe_routes",
      description: "探测桥接端相关接口路由。",
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "用户 QQ 号" },
          tid: { type: "string", description: "说说 tid" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[QZone错误] 缺少 user_id 或 tid");
        const res = await ctx.qzoneApi!.probeApiRoutes(userId, tid);
        return textResult(formatResponse(res));
      },
    },
  ];
}
