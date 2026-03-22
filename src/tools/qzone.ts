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

/** 与 onebot-qzone feeds3/ic2 解析一致，供 OpenClaw 区分动态形态（非过滤条件） */
const QZONE_APPID_CATEGORY_ZH: Record<string, string> = {
  "311": "说说",
  "2": "相册",
  "4": "转发",
  "202": "分享·网易云音乐",
  "2100": "分享·外链应用",
  "217": "点赞记录",
  "2160": "分享·QQ音乐",
  "268": "分享·QQ音乐",
  "3168": "分享·哔哩哔哩",
};

function truncateForDisplay(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * 为 ic2 / feeds3 混合流生成结构化类别提示，便于模型区分说说、应用分享、转发层等。
 */
function buildOpenClawActFeedCategoryLines(post: JsonObject | null): string[] {
  if (!post) return [];
  const lines: string[] = [];
  const appidRaw = readString(post, "appid", "_appid");
  const appid = appidRaw || "311";
  const typeid = readString(post, "typeid", "_typeid");
  const appName = readString(post, "appName", "app_name", "_app_name");
  const baseKind = QZONE_APPID_CATEGORY_ZH[appid] ?? (appName ? `分享·${appName}` : `分享·未知应用`);
  const rtCon = readString(post, "rt_con", "forwardContent", "_forward_content");
  const rtTid = readString(post, "rt_tid", "forward_tid", "_forward_tid");
  const rtName = readString(post, "rt_uinname", "forwardNickname", "_forward_nickname");
  const fwdnum = readNumber(post, "fwdnum", "forward_count") ?? 0;
  const hasForwardLayer = Boolean(rtCon || rtTid || fwdnum > 0);
  let kindLabel = baseKind;
  if (appid === "311" && hasForwardLayer) kindLabel = "说说·含转发";
  else if (appid === "311") kindLabel = "说说";
  const typePart = typeid ? ` typeid=${typeid}` : "";
  lines.push(`【类别】${kindLabel} | appid=${appid}${typePart}`);
  if (hasForwardLayer && (rtCon || rtName || rtTid)) {
    const who = rtName ? `来自 ${rtName}` : rtTid ? `rt_tid=${rtTid}` : "转发内容";
    const body = rtCon ? truncateForDisplay(rtCon, 220) : "(无正文摘要)";
    lines.push(`【转发层】${who} — ${body}`);
  }
  const shareTitle = readString(post, "appShareTitle", "app_share_title", "_app_share_title");
  const mainText = readString(post, "content", "message", "text", "summary");
  if (shareTitle && shareTitle !== mainText) {
    lines.push(`【卡片标题/附题】${truncateForDisplay(shareTitle, 200)}`);
  }
  const ms = post["musicShare"];
  if (ms && typeof ms === "object" && !Array.isArray(ms)) {
    const mo = ms as JsonObject;
    const song = readString(mo, "songName");
    if (song) {
      const artist = readString(mo, "artistName");
      const play = readString(mo, "playUrl");
      lines.push(
        `【音乐卡片】${song}${artist ? ` — ${artist}` : ""}${play ? ` | link=${truncateForDisplay(play, 120)}` : ""}`,
      );
    }
  }
  const videos = asArray(post["video"]);
  if (videos.length > 0) {
    const v0 = asObject(videos[0]);
    const vu = readString(v0, "videoUrl", "video_url");
    const vid = readString(v0, "videoId", "video_id");
    lines.push(
      `【视频】${videos.length} 段${vid ? ` id=${vid}` : ""}${vu ? ` | ${truncateForDisplay(vu, 160)}` : ""}`,
    );
  }
  return lines;
}

function summarizeActFeedItem(
  post: JsonObject | null,
  fallbackUserId: string | undefined,
  imageTempDir: string,
  state: { postsWithBase64: number },
): string {
  const hints = buildOpenClawActFeedCategoryLines(post);
  const body = summarizePost(post, fallbackUserId, imageTempDir, state);
  return hints.length > 0 ? `${hints.join("\n")}\n${body}` : body;
}

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

function extFromImageContentType(contentType: string): string {
  const c = (contentType || "").toLowerCase();
  if (c.includes("png")) return ".png";
  if (c.includes("webp")) return ".webp";
  if (c.includes("gif")) return ".gif";
  if (c.includes("jpeg") || c.includes("jpg")) return ".jpg";
  return ".jpg";
}

function writeBase64ImageToTemp(b64: string, contentType: string, imageTempDir: string): string | null {
  try {
    const buffer = Buffer.from(b64, "base64");
    if (buffer.length === 0) return null;
    const ext = extFromImageContentType(contentType);
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

/** 桥接 get_comment_list 顶层的来源/分页字段，写入工具文本便于 OpenClaw 验收（原先把 JSON 摘要成纯文本时曾丢失）。 */
function buildCommentListMetaLines(data: JsonObject | null): string[] {
  if (!data) return [];
  const src = readString(
    data,
    "commentListSource",
    "comment_data_source",
    "_source",
    "source",
  );
  const total = readNumber(data, "commentListTotal", "feeds3_comment_total", "_feeds3_total");
  const code = readNumber(data, "code");
  const msg = readString(data, "message", "msg");
  const lines: string[] = ["【评论接口元数据】"];
  lines.push(`数据源(commentListSource/等价): ${src || "(未返回)"}`);
  if (total != null) lines.push(`feeds3_comment_total(桶内总条数): ${total}`);
  if (code != null) lines.push(`code: ${code}`);
  if (msg) lines.push(`message: ${truncateForDisplay(msg, 200)}`);
  if (typeof data["has_more"] === "boolean") lines.push(`has_more: ${data["has_more"]}`);
  const nc = readString(data, "next_cursor", "nextCursor");
  if (nc) lines.push(`next_cursor: ${nc}`);
  return lines;
}

function summarizeComment(comment: JsonObject | null): string {
  const id = readString(comment, "id", "comment_id", "commentid") || "-";
  const uin = readString(comment, "uin", "user_id") || "-";
  const nickname = readString(comment, "nickname", "name") || "-";
  const time = formatQzoneTimeForDisplay(comment);
  const rawContent = readString(comment, "content", "text", "message");
  const picArr = asArray(comment?.pic)
    .map((u) => (typeof u === "string" ? u : readString(asObject(u), "url", "src")))
    .filter((s): s is string => Boolean(s));
  const picN = picArr.length;
  const picLine =
    picN > 0
      ? `pic_len=${picN} pic[0]=${truncateForDisplay(picArr[0]!, 140)}${picN > 1 ? ` (+${picN - 1}条)` : ""}`
      : "pic_len=0 (桥接无图或未解析到 URL)";
  const body =
    rawContent.trim().length > 0
      ? rawContent
      : picN > 0
        ? "(无文字，含图)"
        : "(空评论)";
  return `[${time}] id=${id} user=${uin} name=${nickname}\n  ${picLine}\n  ${body}`;
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
  // 桥接 getCommentsBestEffort 使用 commentlist（与 PC comment_list 不同名）
  const buckets = [obj?.commentlist, obj?.comments, obj?.comment_list, obj?.list, obj?.data];
  for (const bucket of buckets) {
    const arr = asArray(bucket).map((item) => asObject(item)).filter(Boolean) as JsonObject[];
    if (arr.length > 0) return arr;
    const nested = asObject(bucket);
    if (nested) {
      const inner = asArray(nested.list ?? nested.commentlist ?? nested.comments ?? nested.comment_list)
        .map((item) => asObject(item))
        .filter(Boolean) as JsonObject[];
      if (inner.length > 0) return inner;
    }
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
    kind: "posts" | "friend_feeds" | "post_detail" | "html_act_all";
    self_id: string;
    user_id?: string;
    tid?: string;
    offset?: number;
    count?: number;
    max_pages?: number;
    cursor_used?: string;
    bridge_ok?: boolean;
    start?: number;
    scope?: number;
    /** html_act_all：next_call 用简名工具时的工具名与主参数名 */
    act_tool?: "qzone_get_user_act_feed" | "qzone_get_space_html_act_feed";
    act_qq?: string;
    /** qzone_get_user_act_feed：与桥接 user_id 同义的页面语境 QQ */
    page_context_qq?: string;
    /** qzone_get_space_html_act_feed：续翻时带上与原请求一致的 host_uin */
    host_uin_for_act?: string;
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
  } else if (ctx.kind === "html_act_all") {
    const uid = (ctx.user_id?.trim() || ctx.self_id).trim();
    const st = ctx.start ?? 0;
    const cnt = ctx.count ?? 10;
    const sc = ctx.scope;
    const toolName = ctx.act_tool ?? "qzone_get_space_html_act_feed";
    const qqArg = (ctx.act_qq?.trim() || uid).trim();
    lines.push("kind: html_act_all");
    lines.push(`tool: ${toolName}`);
    if (toolName === "qzone_get_user_act_feed") {
      lines.push(`qq: ${qqArg}`);
    } else {
      lines.push(`user_id: ${uid}`);
    }
    lines.push(`start: ${st}`);
    lines.push(`count: ${cnt}`);
    if (sc != null && Number.isFinite(sc)) lines.push(`scope: ${sc}`);
    lines.push(
      "note: ic2 start/count 分页；勿与 qzone_get_posts 的 offset 混续翻；要「混合全量动态」用 all_pages=true。每条开头的【类别】/【转发层】等为展示标签，appid 与 QZone 内部一致，便于区分说说/分享/音乐/视频等。",
    );
    if (data) {
      lines.push(`has_more: ${readBoolLoose(data["has_more"])}`);
      const ns = readNumber(data, "next_start");
      if (ns != null) lines.push(`next_start: ${ns}`);
      const pi = data["_page_info"];
      if (pi && typeof pi === "object") lines.push(`_page_info: ${JSON.stringify(pi)}`);
    }
    if (data && readBoolLoose(data["has_more"])) {
      const nextSt = readNumber(data, "next_start") ?? st + cnt;
      const scopePart = sc != null && Number.isFinite(sc) ? ` scope=${Math.trunc(sc)}` : "";
      const piRaw = data["_page_info"];
      const piObj = piRaw && typeof piRaw === "object" && !Array.isArray(piRaw) ? (piRaw as JsonObject) : null;
      const mergedAll = readBoolLoose(piObj?.["all_pages"]);
      const truncatedMerge = readBoolLoose(piObj?.["truncated_by_max_rounds"]);
      const prevMax = readNumber(piObj, "max_rounds");
      const suggestMax =
        prevMax != null && Number.isFinite(prevMax) ? Math.min(80, Math.trunc(prevMax) + 20) : 50;
      const pageCtxPart =
        toolName === "qzone_get_user_act_feed" && ctx.page_context_qq?.trim()
          ? ` page_context_qq=${ctx.page_context_qq.trim()}`
          : "";
      if (toolName === "qzone_get_user_act_feed") {
        if (mergedAll && truncatedMerge) {
          lines.push(
            `next_call: qzone_get_user_act_feed qq=${qqArg} start=${Math.trunc(nextSt)} count=${cnt} all_pages=true max_rounds=${suggestMax}${scopePart}${pageCtxPart}`,
          );
        } else {
          lines.push(`next_call: qzone_get_user_act_feed qq=${qqArg} start=${nextSt} count=${cnt}${scopePart}${pageCtxPart}`);
        }
      } else if (mergedAll && truncatedMerge) {
        const hu = ctx.host_uin_for_act?.trim();
        const hostPart = hu ? ` host_uin=${hu}` : "";
        lines.push(
          `next_call: qzone_get_space_html_act_feed user_id=${uid} start=${Math.trunc(nextSt)} count=${cnt} all_pages=true max_rounds=${suggestMax}${scopePart}${hostPart}`,
        );
      } else {
        const hu = ctx.host_uin_for_act?.trim();
        const hostPart = hu ? ` host_uin=${hu}` : "";
        lines.push(`next_call: qzone_get_space_html_act_feed user_id=${uid} start=${nextSt} count=${cnt}${scopePart}${hostPart}`);
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
        "用户问「我的/自己的说说或动态」时**必须**用本工具（省略 user_id 即当前号），**禁止**用 qzone_get_friend_feeds 再筛本人——好友混排里自己的条目极少，会表现为只有一两条。" +
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
      name: "qzone_get_user_act_feed",
      description:
        "按 **QQ 号** 拉取 ic2 **feeds_html_act_all** 动态流（**说说、分享、音乐等混合**，不按类型拆分）。**all_pages=true** 时由桥接自动多页合并（tid 去重），用于「尽量拉全」；仍受 **max_rounds** 与腾讯接口限制。" +
        "看本人混合动态时 **qq** 填当前号（与 `qzone_get_posts` 纯说说列表互补）；勿用好友混排代替。" +
        "单页模式为一次 HTTP 请求；与 **qzone_get_posts**（feeds3 纯说说 offset）**不等价**，**start/count 勿与 offset 混续翻**。" +
        ` 当前登录: ${selfId}。默认不拉图；raw_json=true 返回整段 JSON。人类可读摘要中每条含【类别】等标签便于区分形态；要原始字段用 raw_json。`,
      parameters: {
        type: "object",
        required: ["qq"],
        properties: {
          qq: { type: "string", description: "动态流主人 QQ（桥接 feed_owner / hostuin）" },
          start: { type: "number", description: "分页起点，默认 0；多页截断后续拉见 _meta.next_call" },
          count: { type: "number", description: "每页条数，默认 10，最大 50（单页与 all_pages 每轮相同）" },
          page_context_qq: {
            type: "string",
            description: "可选，对应 URL 的 uin（页面语境）；省略则与 qq 相同",
          },
          scope: { type: "number", description: "可选，默认 0" },
          all_pages: {
            type: "boolean",
            description: "为 true 时合并多页混合动态（非仅说说）；默认 false 仅首屏",
          },
          max_rounds: {
            type: "number",
            description: "all_pages 时最多请求轮数，默认 30，最大 80",
          },
          include_image_data: {
            type: "boolean",
            description: "为 true 时为 pic 拉 base64，默认 false",
          },
          raw_json: { type: "boolean", description: "为 true 时仅输出 JSON" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const qq = String(params.qq ?? "").trim();
        if (!qq) return textResult("[QZone错误] 缺少 qq");
        const start = Number(params.start ?? 0);
        const count = Number(params.count ?? 10);
        const pageCtx =
          params.page_context_qq != null && String(params.page_context_qq).trim() !== ""
            ? String(params.page_context_qq).trim()
            : undefined;
        const scopeRaw = params.scope;
        const scope = scopeRaw == null ? undefined : Number(scopeRaw);
        const rawJson = readBooleanParam(params.raw_json);
        const includeImg = readBooleanParam(params.include_image_data);
        const allPages = readBooleanParam(params.all_pages);
        const maxRoundsRaw = params.max_rounds;
        const maxRounds = maxRoundsRaw == null ? undefined : Number(maxRoundsRaw);
        const res = await ctx.qzoneApi!.getUserActFeed(qq, Number.isFinite(start) ? start : 0, Number.isFinite(count) ? count : 10, {
          pageContextQq: pageCtx,
          scope: scope != null && Number.isFinite(scope) ? scope : undefined,
          includeImageData: includeImg,
          allPages,
          maxRounds: maxRounds != null && Number.isFinite(maxRounds) ? Math.trunc(maxRounds) : undefined,
        });
        if (res.status !== "ok") return textResult(formatResponse(res));
        if (rawJson) {
          return textResult(JSON.stringify({ ok: true, retcode: res.retcode, data: res.data }, null, 2));
        }
        const dataObj = asObject(res.data);
        const meta = buildQzoneMetaBlock(dataObj, {
          kind: "html_act_all",
          self_id: selfId,
          user_id: pageCtx ?? qq,
          act_tool: "qzone_get_user_act_feed",
          act_qq: qq,
          start: Number.isFinite(start) ? start : 0,
          count: Number.isFinite(count) ? count : 10,
          scope: scope != null && Number.isFinite(scope) ? scope : undefined,
          page_context_qq: pageCtx,
        });
        const posts = extractPosts(res.data);
        if (posts.length === 0) return textResult(`没有解析到动态（可能无权限或 HTML 不兼容）。\n\n${meta}`);
        const state = { postsWithBase64: 0 };
        const lines = posts.map((post) => summarizeActFeedItem(post, qq, imageTempDir, state));
        const pi = dataObj != null ? dataObj["_page_info"] : undefined;
        const merged =
          pi && typeof pi === "object" && !Array.isArray(pi) && readBoolLoose((pi as JsonObject)["all_pages"]);
        const head = merged ? `用户 ${qq} 的 ic2 混合动态（多页合并，${posts.length} 条）` : `用户 ${qq} 的 ic2 动态 (${posts.length} 条)`;
        return textResult(`${head}:\n\n${lines.join("\n\n")}\n\n${meta}`);
      },
    },
    {
      name: "qzone_get_space_html_act_feed",
      description:
        "ic2 **feeds_html_act_all**：**混合动态流**（说说、分享等），**不按类型过滤**。**all_pages=true** 时桥接多页合并；主人由 **host_uin**（hostuin）决定，**user_id** 仅为 URL 语境 uin。" +
        "用户要看「本人空间混合动态」时可用本工具（默认 hostuin 已是当前号）；**不要**用好友混排流代替。" +
        "与 **qzone_get_posts**（feeds3 说说 offset）**不等价**；**start/count 勿与 offset 混续翻**。" +
        ` 当前登录: ${selfId}；省略 host_uin 时 hostuin=${selfId}。默认不拉图；raw_json=true 返回整段 JSON。摘要含【类别】等标签区分说说/分享/转发层等。`,
      parameters: {
        type: "object",
        properties: {
          user_id: {
            type: "string",
            description: "可选。请求里的 uin（页面语境）；省略则用当前登录号。浏览器在他人空间时 uin 常为对方 QQ，但返回仍是 hostuin 的动态",
          },
          start: { type: "number", description: "起始偏移，默认 0" },
          count: { type: "number", description: "本页条数，默认 10，最大 50（桥接限制）" },
          scope: { type: "number", description: "可选，默认 0（与浏览器一致）" },
          host_uin: { type: "string", description: "可选，对应 hostuin（动态流主人）；省略则当前登录号。与浏览器抓包一致时可与 user_id 不同" },
          all_pages: {
            type: "boolean",
            description: "为 true 时合并多页混合动态；默认 false",
          },
          max_rounds: { type: "number", description: "all_pages 时最多请求轮数，默认 30，最大 80" },
          include_image_data: {
            type: "boolean",
            description: "为 true 时桥接为每条 pic 拉 base64，默认 false",
          },
          raw_json: {
            type: "boolean",
            description: "为 true 时仅输出合法 JSON（ok/retcode/data）",
          },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userIdRaw = params.user_id != null && String(params.user_id).trim() !== "" ? String(params.user_id).trim() : undefined;
        const start = Number(params.start ?? 0);
        const count = Number(params.count ?? 10);
        const scopeRaw = params.scope;
        const scope = scopeRaw == null ? undefined : Number(scopeRaw);
        const hostUin = params.host_uin ? String(params.host_uin).trim() : undefined;
        const rawJson = readBooleanParam(params.raw_json);
        const includeImg = readBooleanParam(params.include_image_data);
        const allPages = readBooleanParam(params.all_pages);
        const maxRoundsRaw = params.max_rounds;
        const maxRounds = maxRoundsRaw == null ? undefined : Number(maxRoundsRaw);
        const res = await ctx.qzoneApi!.getFeedsHtmlActAll(userIdRaw, Number.isFinite(start) ? start : 0, Number.isFinite(count) ? count : 10, {
          scope: scope != null && Number.isFinite(scope) ? scope : undefined,
          host_uin: hostUin,
          includeImageData: includeImg,
          allPages,
          maxRounds: maxRounds != null && Number.isFinite(maxRounds) ? Math.trunc(maxRounds) : undefined,
        });
        if (res.status !== "ok") return textResult(formatResponse(res));
        if (rawJson) {
          return textResult(JSON.stringify({ ok: true, retcode: res.retcode, data: res.data }, null, 2));
        }
        const dataObj = asObject(res.data);
        const meta = buildQzoneMetaBlock(dataObj, {
          kind: "html_act_all",
          self_id: selfId,
          user_id: userIdRaw ?? selfId,
          start: Number.isFinite(start) ? start : 0,
          count: Number.isFinite(count) ? count : 10,
          scope: scope != null && Number.isFinite(scope) ? scope : undefined,
          host_uin_for_act: hostUin,
        });
        const posts = extractPosts(res.data);
        if (posts.length === 0) return textResult(`没有解析到动态条目（接口可能返回空或 HTML 结构与解析器不兼容）。\n\n${meta}`);
        const state = { postsWithBase64: 0 };
        const lines = posts.map((post) => summarizeActFeedItem(post, selfId, imageTempDir, state));
        const pi = dataObj != null ? dataObj["_page_info"] : undefined;
        const merged =
          pi && typeof pi === "object" && !Array.isArray(pi) && readBoolLoose((pi as JsonObject)["all_pages"]);
        const head = merged ? `空间混合动态 feeds_html_act_all（多页合并，${posts.length} 条）` : `空间动态 feeds_html_act_all (${posts.length} 条)`;
        return textResult(`${head}:\n\n${lines.join("\n\n")}\n\n${meta}`);
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
      description:
        "查看说说评论列表。桥接返回字段多为 commentlist；tid 须与该说说所属空间主人一致。" +
        " 文本首段含【评论接口元数据】（commentListSource、feeds3_comment_total 等）；每条含 pic_len。" +
        " raw_json=true 时返回桥接 data 完整 JSON（仅调试，体积可能很大）。" +
        ` 当前账号: ${selfId}；省略 user_id 时按当前登录号请求（与桥接默认一致）。`,
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          user_id: { type: "string", description: "说说所属用户 QQ；省略则为当前登录号" },
          tid: { type: "string", description: "说说 tid" },
          count: { type: "number", description: "数量，默认 20" },
          offset: { type: "number", description: "偏移，默认 0" },
          fast_mode: {
            type: "boolean",
            description: "与桥接一致；false 时对应 fast_mode=false（更完整抓取/日志，略慢）。默认不传则桥接多为 fast",
          },
          raw_json: { type: "boolean", description: "true 时直接输出桥接 data 的 JSON（含 commentlist 全字段）" },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "").trim() || selfId;
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[QZone错误] 缺少 tid");
        const count = Number(params.count ?? 20);
        const offset = Number(params.offset ?? 0);
        const fastExplicit = params.fast_mode;
        const fastMode = fastExplicit === false ? false : fastExplicit === true ? true : undefined;
        const res = await ctx.qzoneApi!.getCommentList(
          userId,
          tid,
          Number.isFinite(count) ? count : 20,
          Number.isFinite(offset) ? offset : 0,
          fastMode,
        );
        if (res.status !== "ok") return textResult(formatResponse(res));
        const dataObj = asObject(res.data);
        if (readBooleanParam(params.raw_json)) {
          const raw = JSON.stringify(res.data, null, 2);
          const max = 120_000;
          const jsonBlock = raw.length > max ? `${raw.slice(0, max)}\n…(truncated ${raw.length - max} chars)` : raw;
          return textResult(`${buildCommentListMetaLines(dataObj).join("\n")}\n\n【raw_json】\n${jsonBlock}`);
        }
        const comments = extractComments(res.data);
        const meta = buildCommentListMetaLines(dataObj).join("\n");
        if (comments.length === 0) {
          return textResult(`${meta}\n\n没有找到评论（commentlist 为空）。`);
        }
        return textResult(
          `${meta}\n\n评论列表 (本页 ${comments.length} 条):\n\n${comments.map((comment) => summarizeComment(comment)).join("\n\n")}`,
        );
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
        "**不用于**回答「我自己的说说有哪些」：混排中本人动态稀疏，请用 qzone_get_posts（省略 user_id）或 qzone_get_user_act_feed qq=当前号。" +
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
      name: "qzone_fetch_image",
      description:
        "用空间桥接**已登录 Cookie** 拉取 QZone CDN 图片（qpic.cn、photo.store.qq.com 等白名单），保存到临时文件并返回路径。" +
        "「get_comments」里的 pic URL 在**普通浏览器地址栏**常 403/404（缺 Cookie、Referer 或 URL 被截断）；要预览请用本工具传入**完整** url。",
      parameters: {
        type: "object",
        required: ["url"],
        properties: {
          url: {
            type: "string",
            description: "完整图片 URL，须与接口返回一致（含 &bo= &t= 等查询串，勿省略）",
          },
        },
      },
      async execute(_id, params) {
        const err = guard();
        if (err) return textResult(err);
        const url = String(params.url ?? "").trim();
        if (!url) return textResult("[QZone错误] 缺少 url");
        if (!/^https?:\/\//i.test(url)) return textResult("[QZone错误] url 须为 http(s) 完整链接");
        const res = await ctx.qzoneApi!.fetchImage(url);
        if (res.status !== "ok" || res.data == null) return textResult(formatResponse(res));
        const d = asObject(res.data as unknown);
        const b64 = readString(d, "base64");
        const ct = readString(d, "content_type", "contentType") || "image/jpeg";
        if (!b64) {
          return textResult(`[QZone错误] fetch_image 未返回 base64，data=${truncateForDisplay(JSON.stringify(res.data), 400)}`);
        }
        const imageTempDir = ctx.config.paths.imageTemp;
        const localPath = writeBase64ImageToTemp(b64, ct, imageTempDir);
        if (!localPath) return textResult("[QZone错误] 写入临时文件失败");
        return textResult(
          [
            "已用桥接登录态拉取并落盘（聊天里复制的短链接或截断 URL 会失败，请用 raw_json 里完整 pic 串）。",
            `本地路径: ${localPath}`,
            `content_type: ${ct}`,
            "可在支持文件路径的环境用 image 工具打开上述路径。",
          ].join("\n"),
        );
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
