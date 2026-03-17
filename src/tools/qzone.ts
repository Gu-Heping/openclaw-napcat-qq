import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";
import type { QzoneBridgeResponse } from "../napcat/qzone-api.js";
import { normalizeFaceFormatForQzone } from "../util/cq-code.js";

/** 将 base64 图片写入临时文件并返回路径，供 image 工具使用（与 napcat-qq 聊天图片处理一致） */
function writeBase64ImageToTemp(b64: string, contentType: string, imageTempDir: string): string | null {
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0) return null;
    const ext = (contentType || "").toLowerCase().includes("png") ? ".png" : ".jpg";
    fs.mkdirSync(imageTempDir, { recursive: true });
    const outPath = path.join(imageTempDir, `qzone_${crypto.randomUUID()}${ext}`);
    fs.writeFileSync(outPath, buf);
    return outPath;
  } catch {
    return null;
  }
}

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

function formatResponse(res: QzoneBridgeResponse, successMsg?: string): string {
  if (res.status === "ok" || res.retcode === 0) {
    if (successMsg) return successMsg;
    return res.data ? JSON.stringify(res.data, null, 2) : "ok";
  }
  return `[QZone 错误] ${res.message ?? `retcode=${res.retcode}`}`;
}

/** 将说说/评论时间戳或已有字符串格式化为便于 AI 阅读的日期时间（如 2026-03-13 09:00） */
function formatQzoneTimeForDisplay(msg: Record<string, unknown>): string {
  const createTime2 = msg.createTime2 ?? msg.create_time2;
  if (typeof createTime2 === "string" && createTime2.trim()) return createTime2.trim();
  const createTime = msg.createTime ?? msg.create_time ?? msg.createtime ?? msg.time ?? msg.visitTime;
  if (typeof createTime === "string" && createTime.trim()) return createTime.trim();
  const ts = msg.created_time ?? msg.createdTime ?? msg.createtime ?? msg.time ?? msg.visitTime;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    return d.toISOString().replace("T", " ").slice(0, 16);
  }
  return "未知时间";
}

/** 与 onebot-qzone 桥接 EMOJI_NAME_MAP 对齐（refactor 后 e190-e204 修正、doge=e249、新增 e10264 捂脸等） */
const QZONE_EMOJI_NAMES = [
  "微笑", "撇嘴", "色", "发呆", "得意", "流泪", "害羞", "闭嘴", "睡", "大哭", "尴尬", "发怒", "调皮", "呲牙", "惊讶", "难过", "酷", "冷汗", "抓狂", "吐", "偷笑", "可爱", "白眼", "傲慢", "饥饿", "困", "惊恐", "流汗", "憨笑", "大兵",
  "奋斗", "咒骂", "疑问", "嘘", "晕", "折磨", "衰", "骷髅", "敲打", "再见", "擦汗", "抠鼻", "鼓掌", "糗大了", "坏笑", "左哼哼", "右哼哼", "哈欠", "鄙视", "委屈", "快哭了", "阴险", "亲亲", "吓", "可怜", "菜刀", "西瓜", "啤酒", "篮球", "乒乓",
  "咖啡", "饭", "猪头", "玫瑰", "凋谢", "示爱", "爱心", "心碎", "蛋糕", "闪电", "炸弹", "刀", "足球", "瓢虫", "便便", "月亮", "太阳", "礼物", "拥抱", "强", "弱", "握手", "胜利", "抱拳", "勾引", "拳头", "差劲", "爱你", "NO", "OK",
  "爱情", "飞吻", "跳跳", "发抖", "怄火", "转圈", "磕头", "回头", "跳绳", "挥手", "激动", "街舞", "献吻", "左太极", "右太极",
  "泪奔", "喷血", "doge", "托腮", "捂脸", "emm", "吃瓜", "呵呵哒", "我酸了", "太南了", "睁眼", "崇拜", "比心",
  "变形", "摸头", "飞吻2", "亲亲2", "大笑", "开心", "喜欢", "爱你2",
];

/** 表情名称 -> QZone 代码（与 onebot-qzone emoji.ts EMOJI_NAME_MAP 一致，桥接已基于 QzEmoji 修正 e190-e204、doge=e249 等） */
const QZONE_EMOJI_NAME_TO_CODE: Record<string, string> = {
  微笑: "e100", 撇嘴: "e101", 色: "e102", 发呆: "e103", 得意: "e104", 流泪: "e105", 害羞: "e106", 闭嘴: "e107", 睡: "e108", 大哭: "e109", 尴尬: "e110", 发怒: "e111", 调皮: "e112", 呲牙: "e113", 惊讶: "e114", 难过: "e115", 酷: "e116", 冷汗: "e117", 抓狂: "e118", 吐: "e119", 偷笑: "e120", 可爱: "e121", 白眼: "e122", 傲慢: "e123", 饥饿: "e124", 困: "e125", 惊恐: "e126", 流汗: "e127", 憨笑: "e128", 大兵: "e129",
  奋斗: "e130", 咒骂: "e131", 疑问: "e132", 嘘: "e133", 晕: "e134", 折磨: "e135", 衰: "e136", 骷髅: "e137", 敲打: "e138", 再见: "e139", 擦汗: "e140", 抠鼻: "e141", 鼓掌: "e142", 糗大了: "e143", 坏笑: "e144", 左哼哼: "e145", 右哼哼: "e146", 哈欠: "e147", 鄙视: "e148", 委屈: "e149", 快哭了: "e150", 阴险: "e151", 亲亲: "e152", 吓: "e153", 可怜: "e154", 菜刀: "e155", 西瓜: "e156", 啤酒: "e157", 篮球: "e158", 乒乓: "e159",
  咖啡: "e160", 饭: "e161", 猪头: "e162", 玫瑰: "e163", 凋谢: "e164", 示爱: "e165", 爱心: "e166", 心碎: "e167", 蛋糕: "e168", 闪电: "e169", 炸弹: "e170", 刀: "e171", 足球: "e172", 瓢虫: "e173", 便便: "e174", 月亮: "e175", 太阳: "e176", 礼物: "e177", 拥抱: "e178", 强: "e179", 弱: "e180", 握手: "e181", 胜利: "e182", 抱拳: "e183", 勾引: "e184", 拳头: "e185", 差劲: "e186", 爱你: "e187", NO: "e188", OK: "e189",
  爱情: "e190", 飞吻: "e191", 跳跳: "e192", 发抖: "e193", 怄火: "e194", 转圈: "e195", 磕头: "e196", 回头: "e197", 跳绳: "e198", 挥手: "e199", 激动: "e200", 街舞: "e201", 献吻: "e202", 左太极: "e203", 右太极: "e204",
  泪奔: "e243", 喷血: "e247", 托腮: "e282",
  捂脸: "e10264", emm: "e10270", 吃瓜: "e10271", 呵呵哒: "e10272", 我酸了: "e10273", 太南了: "e10274", 睁眼: "e10289", 崇拜: "e10318", 比心: "e10319",
  变形: "e400343", 摸头: "e400843", 飞吻2: "e400844", 亲亲2: "e400845", 大笑: "e400852", 开心: "e400853", 喜欢: "e400860", 爱你2: "e400861",
};

/** 多对一别名：与桥接 EMOJI_ALIASES + 私聊 face 对齐；狗头/旺柴 用桥接的 e249(doge) */
const QZONE_EMOJI_ALIASES: Record<string, string> = {
  狗头: "e249", doge: "e249", 旺柴: "e249", 社会社会: "e249",
  OK: "e189", ok: "e189", 好的: "e189",
  耶: "e182", 胜利: "e182", V: "e182",
  捂脸: "e10264", 笑哭: "e10264", 泪目: "e10264",
  我太难了: "e10274", 太南了: "e10274",
  叹气: "e10274", 无奈: "e10274",
  翻白眼: "e122", 白眼: "e122",
  呲牙: "e113", 龇牙: "e113",
  抱拳: "e183", 握手: "e181",
  谢谢: "e312", 感谢: "e312", 苦涩: "e150",
  托腮: "e282", 祈祷: "e302",
};

/** 根据名称解析 QZone 表情代码：先别名、再精确、再模糊包含，与私聊 findFaceId 一致 */
function findQzoneEmojiCode(name: string): string | undefined {
  const n = name.trim();
  if (!n) return undefined;
  const alias = QZONE_EMOJI_ALIASES[n];
  if (alias) return alias;
  const exact = QZONE_EMOJI_NAME_TO_CODE[n];
  if (exact) return exact;
  for (const [canonicalName, code] of Object.entries(QZONE_EMOJI_NAME_TO_CODE)) {
    if (canonicalName.includes(n) || n.includes(canonicalName)) return code;
  }
  return undefined;
}

/** 将 content 中的 [名称] 转为 QZone 的 [em]eXXX[/em]，保证发到空间后显示为表情而非原文（多对一解析） */
function convertBracketNamesToQzoneEm(content: string): string {
  if (!content || !content.includes("[")) return content;
  return content.replace(/\[([^\]]+)\]/g, (match, name: string) => {
    const code = findQzoneEmojiCode(name);
    return code ? `[em]${code}[/em]` : match;
  });
}

export function createQzoneTools(ctx: PluginContext): AnyAgentTool[] {
  const selfId = ctx.config.connection.selfId || "unknown";
  const log = ctx.log;
  const guard = (): string | null => {
    if (!ctx.qzoneApi) return "[错误] QZone API 未启用，请在配置中设置 qzone.enabled = true";
    return null;
  };

  return [
    // ── 1. qzone_publish ──
    {
      name: "qzone_publish",
      description: `发布 QQ 空间说说（你的QQ号: ${selfId}）。content=文字内容，images=图片URL数组（可选）。表情与 QQ 聊天一致：在 content 中写 [表情:名称]，如 [表情:微笑][表情:狗头][表情:爱心]，与 qq_send_message 格式相同；可用 qzone_emoji_list 查看可用表情。`,
      parameters: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", description: "说说文字内容" },
          images: {
            type: "array",
            items: { type: "string" },
            description: "图片 URL 列表（可选，支持 http/https/base64://）",
          },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        let content = String(params.content ?? "");
        if (!content) return textResult("[错误] 缺少 content");
        content = normalizeFaceFormatForQzone(content);
        content = convertBracketNamesToQzoneEm(content);
        const images = Array.isArray(params.images)
          ? (params.images as unknown[]).map((i) => String(i))
          : undefined;
        const res = await ctx.qzoneApi!.publish(content, images);
        const data = res.data as Record<string, unknown> | null;
        if (res.status === "ok" && data) {
          return textResult(`发布成功。tid=${data.tid ?? data.message_id ?? ""}`);
        }
        return textResult(formatResponse(res));
      },
    },

    // ── 1.5 qzone_emoji_list ──
    {
      name: "qzone_emoji_list",
      description: "获取可用表情列表。格式与 QQ 聊天一致：在 content 中写 [表情:名称]，如 [表情:微笑][表情:狗头]，用于 qzone_publish、qzone_comment 与 qq_send_message、qq_send_group_message 同一套写法。",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["all", "common"],
            description: "all=全部列出，common=仅常用（默认 common）",
          },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const category = String(params.category ?? "common");
        const names = QZONE_EMOJI_NAMES;
        const unifiedFormat = names.map((n) => `[表情:${n}]`);
        if (category === "all") {
          return textResult(`可用表情（与聊天统一，在 content 中写 [表情:名称]）：\n${unifiedFormat.join(" ")}\n\n共 ${names.length} 个。`);
        }
        return textResult(
          `常用表情（与 qq_send_message 等聊天格式一致，在 content 中写 [表情:名称]）：\n${unifiedFormat.join(" ")}\n\n共 ${names.length} 个。`,
        );
      },
    },

    // ── 2. qzone_delete ──
    {
      name: "qzone_delete",
      description: "删除 QQ 空间说说",
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          tid: { type: "string", description: "说说 ID（tid）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[错误] 缺少 tid");
        const res = await ctx.qzoneApi!.deleteEmotion(tid);
        return textResult(formatResponse(res, `已删除说说 ${tid}`));
      },
    },

    // ── 3. qzone_get_posts ──
    {
      name: "qzone_get_posts",
      description: `获取**指定用户**个人主页的说说列表（某人发的全部说说）。不传 user_id 时获取自己(${selfId})的说说。注意：用户若要看「好友动态」「朋友圈」「谁最近发了啥」应使用 qzone_get_friend_feeds 而非本工具。指定某好友时务必传 count（建议50）和 max_pages（建议15）以多翻页。带图的说说会返回图片本地路径；分析图片时请用 image 工具传入该路径，勿复制 base64。返回的图片路径可直接作为 image 工具的 image 参数传入进行识图。`,
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "目标 QQ 号（不填则获取自己的）" },
          count: { type: "number", description: "获取条数，默认 50，最大 200" },
          offset: { type: "number", description: "偏移量，默认 0" },
          max_pages: { type: "number", description: "最多翻几页（每页约50条），默认 15，最大 30" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const userId = params.user_id ? String(params.user_id) : undefined;
        const num = Math.min(200, Math.max(1, Number(params.count ?? 50)));
        const pos = Number(params.offset ?? 0);
        const maxPages = params.max_pages != null ? Math.min(30, Math.max(1, Number(params.max_pages))) : undefined;
        log.info?.(`[QZone-Tool] qzone_get_posts called: user_id=${userId ?? "self"} count=${num} offset=${pos} max_pages=${maxPages ?? "default"}`);
        const res = await ctx.qzoneApi!.getEmotionList(userId, pos, num, maxPages, true);
        if (res.status !== "ok") return textResult(formatResponse(res));

        const data = res.data as Record<string, unknown> | null;
        const msglist = (data?.msglist ?? data?.data) as Record<string, unknown>[] | undefined;
        if (!msglist?.length) return textResult("暂无说说");

        // #region agent log
        const firstWithPic = msglist.find((m) => Array.isArray(m.pic) && (m.pic as unknown[]).length > 0);
        const firstPic = firstWithPic && Array.isArray(firstWithPic.pic) ? (firstWithPic.pic as Record<string, unknown>[])[0] : null;
        const sampleMsgShapes = msglist.slice(0, 3).map((m, i) => ({
          i,
          keys: Object.keys(m),
          picIsArray: Array.isArray(m.pic),
          picLen: Array.isArray(m.pic) ? (m.pic as unknown[]).length : -1,
          firstPicUrl: Array.isArray(m.pic) && (m.pic as unknown[]).length > 0 ? ((m.pic as Record<string, unknown>[])[0] as Record<string, unknown>)?.url : undefined,
        }));
        fetch('http://localhost:7243/ingest/73a4a46f-7107-4b2b-b2e9-e178389b2a24',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'qzone.ts:qzone_get_posts',message:'bridge response msglist shape',data:{msglistLen:msglist.length,hasFirstPic:!!firstPic,hasBase64:!!(firstPic && firstPic.base64),sampleMsgShapes},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
        // #endregion

        const MAX_BASE64_IMAGES_PER_POST = 2;
        const MAX_POSTS_WITH_BASE64 = 2;
        let postsWithBase64Count = 0;
        const imageTempDir = ctx.config.paths.imageTemp;
        const lines = msglist.slice(0, num).map((msg) => {
          const tid = String(msg.tid ?? "");
          const uin = String(msg.uin ?? msg.owner ?? "").trim() || "?";
          const rawContent = String(msg.content ?? msg.con ?? "");
          const text = rawContent.slice(0, 80) + (rawContent.length > 80 ? "…" : "");
          const time = formatQzoneTimeForDisplay(msg);
          const cmtNum = msg.cmtnum ?? msg.commentnum ?? 0;
          const likeNum = msg.likenum ?? 0;
          const picArr = msg.pic as Array<{ url?: string; base64?: string; content_type?: string }> | undefined;
          const picUrls = Array.isArray(picArr) ? picArr.map((p) => p?.url).filter(Boolean) as string[] : [];
          let picLine = picUrls.length ? `\n  图片: ${picUrls.join(" | ")}` : "";
          const mayAttachBase64 = Array.isArray(picArr) && postsWithBase64Count < MAX_POSTS_WITH_BASE64;
          if (mayAttachBase64) {
            const pathParts: string[] = [];
            let added = 0;
            for (let i = 0; i < picArr!.length && added < MAX_BASE64_IMAGES_PER_POST; i++) {
              const p = picArr![i] as Record<string, unknown>;
              const b64 = p?.base64;
              if (b64 && typeof b64 === "string") {
                const ct = (p?.content_type ?? "image/jpeg") as string;
                const localPath = writeBase64ImageToTemp(b64, ct, imageTempDir);
                if (localPath) {
                  pathParts.push(`\n  图片${i + 1}（可用 image 工具分析）: ${localPath}`);
                  added++;
                }
              }
            }
            if (pathParts.length) {
              picLine += pathParts.join("");
              postsWithBase64Count++;
            }
          }
          return `[${time}] tid=${tid} ${uin} 💬${cmtNum} 👍${likeNum}\n  ${text}${picLine}`;
        });
        const hasImagePaths = lines.some((l) => l.includes("（可用 image 工具分析）"));
        const headerHint = hasImagePaths
          ? "【识图】下方带「图片N（可用 image 工具分析）」的路径可直接作为 image 工具的 image 参数传入进行识图。\n\n"
          : "";
        const out = `说说列表 (${msglist.length} 条):\n\n${headerHint}${lines.join("\n\n")}`;
        // #region agent log
        fetch('http://localhost:7243/ingest/73a4a46f-7107-4b2b-b2e9-e178389b2a24',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'qzone.ts:qzone_get_posts',message:'tool output summary',data:{postsWithBase64Count,outputContainsImagePaths:out.includes('（可用 image 工具分析）'),outLen:out.length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        return textResult(out);
      },
    },

    // ── 3.5 qzone_get_post_images ──
    {
      name: "qzone_get_post_images",
      description: `获取某条说说的图片链接。user_id=说说作者QQ号（自己的填${selfId}），tid=说说ID。返回可直接访问的图片 URL 列表。`,
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "说说作者的 QQ 号" },
          tid: { type: "string", description: "说说 ID（从 qzone_get_posts 或事件中获取）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[错误] 缺少 user_id 或 tid");
        const res = await ctx.qzoneApi!.getFeedImages(userId, tid);
        if (res.status !== "ok") return textResult(formatResponse(res));
        const urls = (res.data as Record<string, unknown>)?.urls as string[] | undefined;
        if (!urls?.length) return textResult("该说说无图片");
        return textResult(`图片 (${urls.length} 张):\n${urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`);
      },
    },

    // ── 4. qzone_comment ──
    {
      name: "qzone_comment",
      description: `评论说说；回复某条评论时传 reply_comment_id 与 reply_uin。必填 tid、content（只写正文，@ 由服务端自动加）。回复空间评论时必须调用本工具，不要用 qq_send_message 把本工具名或参数当私聊内容发出。表情在 content 中写 [表情:名称]；可用 qzone_emoji_list 查看。`,
      parameters: {
        type: "object",
        required: ["tid", "content"],
        properties: {
          tid: { type: "string", description: "说说 ID" },
          content: { type: "string", description: "评论内容（回复时无需写 @某人，服务端自动加）" },
          user_id: { type: "string", description: "说说作者 QQ 号（可选，服务端可自动识别）" },
          reply_comment_id: { type: "string", description: "要回复的那条评论的 ID（与 qzone_get_comments 返回的 comment_id 或评论通知中的 reply_comment_id 一致）；与 reply_uin 成对传入即发为回复" },
          reply_uin: { type: "string", description: "被回复评论的作者 QQ 号，须与 reply_comment_id 成对传入" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        let content = String(params.content ?? "");
        if (!tid || !content) return textResult("[错误] 缺少 tid / content");
        content = normalizeFaceFormatForQzone(content);
        content = convertBracketNamesToQzoneEm(content);
        const userId = params.user_id ? String(params.user_id) : undefined;
        log.info?.(`[QZone-Tool] qzone_comment called: tid=${tid} content=${content.slice(0, 40)}`);
        const replyId = params.reply_comment_id ? String(params.reply_comment_id) : undefined;
        const replyUin = params.reply_uin ? String(params.reply_uin) : undefined;
        const res = await ctx.qzoneApi!.sendComment(tid, content, userId, replyId, replyUin);
        const result = formatResponse(res, "评论成功");
        log.info?.(`[QZone-Tool] qzone_comment result: ${result.slice(0, 80)}`);
        return textResult(result);
      },
    },

    // ── 5. qzone_like ──
    {
      name: "qzone_like",
      description: `给说说点赞。只需传 tid，服务端自动从缓存补全所有参数（appid/typeid/unikey/curkey 等）。`,
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          tid: { type: "string", description: "说说 ID" },
          user_id: { type: "string", description: "说说作者 QQ 号（可选，服务端可自动识别）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[错误] 缺少 tid");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.sendLike(tid, userId);
        return textResult(formatResponse(res, "点赞成功"));
      },
    },

    // ── 5.5 qzone_unlike ──
    {
      name: "qzone_unlike",
      description: "取消对说说的点赞。只需传 tid，服务端可自动补全参数。",
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          tid: { type: "string", description: "说说 ID" },
          user_id: { type: "string", description: "说说作者 QQ 号（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[错误] 缺少 tid");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.unlike(tid, userId);
        return textResult(formatResponse(res, "已取消点赞"));
      },
    },

    // ── 5.6 qzone_forward ──
    {
      name: "qzone_forward",
      description: "转发一条说说。user_id=原作者QQ号，tid=说说ID，content=转发时的附言（可选）。",
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "原说说的作者 QQ 号" },
          tid: { type: "string", description: "说说 ID" },
          content: { type: "string", description: "转发附言（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[错误] 缺少 user_id 或 tid");
        const content = params.content ? String(params.content) : undefined;
        const res = await ctx.qzoneApi!.forwardMsg(userId, tid, content);
        return textResult(formatResponse(res, "转发成功"));
      },
    },

    // ── 6. qzone_get_comments ──
    {
      name: "qzone_get_comments",
      description: `获取说说的评论列表。必填：user_id=该条说说的作者QQ号（不是 bot；「我的说说」填当前对话人的 QQ），tid=说说 ID（来自 qzone_get_posts 或动态事件的 tid，若只有 abstime 数字桥接会自动解析）。服务端先试 PC/mobile，失败时用 feeds3 兜底。`,
      parameters: {
        type: "object",
        required: ["user_id", "tid"],
        properties: {
          user_id: { type: "string", description: "该条说说的作者 QQ 号（「我的说说」填对方/user 的 QQ）" },
          tid: { type: "string", description: "说说 ID（key 或 abstime，桥接会自动把 abstime 转成 key）" },
          count: { type: "number", description: "获取条数，默认 20" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        const tid = String(params.tid ?? "");
        if (!userId || !tid) return textResult("[错误] 缺少 user_id 或 tid");
        const num = Number(params.count ?? 20);
        const res = await ctx.qzoneApi!.getCommentList(userId, tid, num);
        if (res.status !== "ok") return textResult(formatResponse(res));

        const data = res.data as Record<string, unknown> | null;
        const code = data && typeof data.code === "number" ? data.code : 0;
        const msg = data && typeof data.message === "string" ? data.message : "";
        // 兼容桥接返回：PC 用 comment_list，mobile/feeds3 用 commentlist，部分用 comments/data
        const comments = (data?.comments ?? data?.commentlist ?? data?.comment_list ?? data?.data) as Record<string, unknown>[] | undefined;
        if (!comments?.length) {
          if (code !== 0 && code !== -1 && msg) return textResult(`获取评论失败：${msg}`);
          return textResult("暂无评论");
        }

        const lines = comments.map((c) => {
          const id = c.commentid ?? c.comment_id ?? c.id ?? "";
          const name = c.name ?? c.nickname ?? c.user?.toString() ?? "?";
          const text = String(c.content ?? "").slice(0, 100);
          const time = formatQzoneTimeForDisplay(c as Record<string, unknown>);
          const uin = c.uin ?? c.commentuin ?? c.user_id ?? "";
          // 二级评论：feeds3 返回 is_reply / reply_to_nickname / reply_to_uin / parent_comment_id
          const isReply = c.is_reply ?? c.isReply ?? false;
          const replyToNick = (c.reply_to_nickname ?? c.replyToNickname ?? "") as string;
          const replyToUin = (c.reply_to_uin ?? c.replyToUin ?? "") as string;
          const parentId = (c.parent_comment_id ?? c.parentCommentId ?? "") as string;
          const replyToCommentId = (c.reply_to_comment_id ?? c.replyToCommentId ?? "") as string;
          const replyPrefix = isReply && (replyToNick || replyToUin)
            ? ` 回复 @${replyToNick || replyToUin}:`
            : "";
          const idPart = id ? ` (comment_id=${id}${uin ? ` uin=${uin}` : ""}${parentId ? ` parent_id=${parentId}` : ""})` : "";
          const replyHint = id && uin ? ` | 回复此条: reply_comment_id=${id} reply_uin=${uin}` : "";
          return `[${time}] ${name}:${replyPrefix} ${text}${idPart}${replyHint}`;
        });
        const sourceNote = data?._source === "feeds3" ? `（来源：feeds3 兜底${typeof data?._feeds3_total === "number" ? `，共 ${data._feeds3_total} 条` : ""}）` : "";
        return textResult(`评论 (${comments.length} 条)${sourceNote}:\n${lines.join("\n")}`);
      },
    },

    // ── 6.5 qzone_delete_comment ──
    {
      name: "qzone_delete_comment",
      description: "删除某条说说的评论。必填 tid（说说ID）、comment_id（评论ID）。user_id=说说作者QQ号（可选，桥接可自动补全）；comment_uin=被删评论的作者QQ号（可选，部分接口需要）。评论ID从 qzone_get_comments 返回或评论通知中获取。",
      parameters: {
        type: "object",
        required: ["tid", "comment_id"],
        properties: {
          tid: { type: "string", description: "说说 ID" },
          comment_id: { type: "string", description: "要删除的评论 ID" },
          user_id: { type: "string", description: "说说作者 QQ 号（可选）" },
          comment_uin: { type: "string", description: "被删评论的作者 QQ 号（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        const commentId = String(params.comment_id ?? "");
        if (!tid || !commentId) return textResult("[错误] 缺少 tid 或 comment_id");
        const uin = params.user_id ? String(params.user_id) : "";
        const commentUin = params.comment_uin ? String(params.comment_uin) : undefined;
        const res = await ctx.qzoneApi!.deleteComment(uin, tid, commentId, commentUin);
        return textResult(formatResponse(res, "已删除评论"));
      },
    },

    // ── 6.6 qzone_get_likes ──
    {
      name: "qzone_get_likes",
      description: "获取某条说说的点赞列表。tid=说说ID，user_id=说说作者QQ号（可选，桥接可补全）。",
      parameters: {
        type: "object",
        required: ["tid"],
        properties: {
          tid: { type: "string", description: "说说 ID" },
          user_id: { type: "string", description: "说说作者 QQ 号（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        if (!tid) return textResult("[错误] 缺少 tid");
        const userId = params.user_id ? String(params.user_id) : selfId;
        const res = await ctx.qzoneApi!.getLikeList(userId, tid);
        if (res.status !== "ok") return textResult(formatResponse(res));
        const data = res.data as Record<string, unknown> | unknown[] | null;
        const list = Array.isArray(data) ? data : (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).list)
          ? (data as Record<string, unknown>).list as Record<string, unknown>[]
          : (data as Record<string, unknown>)?.like_list ?? (data as Record<string, unknown>)?.likelist);
        if (!Array.isArray(list) || !list.length) return textResult("暂无点赞");
        const lines = list.slice(0, 30).map((u) => u.nickname ?? u.name ?? u.uin ?? "?");
        return textResult(`点赞 (${list.length} 人): ${lines.join("、")}`);
      },
    },

    // ── 7. qzone_get_visitors ──
    {
      name: "qzone_get_visitors",
      description: "获取 QQ 空间访客列表",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "目标 QQ 号（不填则获取自己的）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.getVisitorList(userId);
        if (res.status !== "ok") return textResult(formatResponse(res));

        const data = res.data as Record<string, unknown> | null;
        const items = (data?.items ?? data?.list ?? data?.data) as Record<string, unknown>[] | undefined;
        if (!items?.length) return textResult("暂无访客记录");

        const lines = items.slice(0, 20).map((v) => {
          const name = v.name ?? v.nickname ?? v.uin ?? "?";
          const time = formatQzoneTimeForDisplay(v as Record<string, unknown>);
          const src = v._source_name ?? "";
          return `${name} (${time})${src ? ` 来自${src}` : ""}`;
        });
        return textResult(`访客 (${items.length} 人):\n${lines.join("\n")}`);
      },
    },

    // ── 8. qzone_get_friend_feeds ──
    {
      name: "qzone_get_friend_feeds",
      description: "获取**好友动态**（好友最近发的说说，类似朋友圈时间线）。用户说「获取说说列表」「看看空间」「好友动态」「朋友圈」时应用本工具；qzone_get_posts 是看某人的个人说说列表。每条返回 tid/uin 等，可直接传给 qzone_like / qzone_comment。翻页传上次结果末尾的 next_cursor。带图的说说会返回图片本地路径；分析图片时请用 image 工具传入该路径，勿复制 base64。返回的图片路径可直接作为 image 工具的 image 参数传入进行识图。",
      parameters: {
        type: "object",
        properties: {
          cursor: { type: "string", description: "翻页游标。首页不传；下一页传上次结果末尾的 next_cursor 值。" },
          count: { type: "number", description: "最多返回条数，默认 20，最大 50" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const cursor = params.cursor ? String(params.cursor) : undefined;
        const num = params.count != null ? Math.min(50, Math.max(1, Number(params.count))) : undefined;
        const res = await ctx.qzoneApi!.getFriendFeeds(cursor, num, true);
        if (res.status !== "ok") return textResult(formatResponse(res));

        const data = res.data as Record<string, unknown> | null;
        const feeds = (data?.data ?? data?.msglist ?? data) as Record<string, unknown>[] | undefined;
        const nextCursor = typeof data?.next_cursor === "string" ? data.next_cursor : "";

        if (!Array.isArray(feeds) || !feeds.length) {
          if (cursor) return textResult("好友说说已全部加载完毕。");
          return textResult("暂无好友说说（近期好友没有发说说）");
        }

        const MAX_BASE64_IMAGES_PER_FEED = 2;
        const MAX_FEEDS_WITH_BASE64 = 2;
        let feedsWithBase64Count = 0;
        const imageTempDir = ctx.config.paths.imageTemp;
        const lines = feeds.map((f) => {
          const name = f.name ?? f.nickname ?? f.uin ?? "?";
          const tid = String(f.tid ?? "");
          const uin = String(f.uin ?? "");
          const rawContent = String(f.content ?? f.con ?? "");
          const text = rawContent.slice(0, 80) + (rawContent.length > 80 ? "…" : "");
          const time = formatQzoneTimeForDisplay(f as Record<string, unknown>);
          const picArr = f.pic as Array<{ url?: string; base64?: string; content_type?: string }> | undefined;
          const picUrls = Array.isArray(picArr) ? picArr.map((p) => p?.url).filter(Boolean) as string[] : [];
          let picLine = picUrls.length ? `\n  图片: ${picUrls.join(" | ")}` : "";
          const mayAttachBase64 = Array.isArray(picArr) && feedsWithBase64Count < MAX_FEEDS_WITH_BASE64;
          if (mayAttachBase64) {
            const pathParts: string[] = [];
            let added = 0;
            for (let i = 0; i < picArr!.length && added < MAX_BASE64_IMAGES_PER_FEED; i++) {
              const p = picArr![i] as Record<string, unknown>;
              const b64 = p?.base64;
              if (b64 && typeof b64 === "string") {
                const ct = (p?.content_type ?? "image/jpeg") as string;
                const localPath = writeBase64ImageToTemp(b64, ct, imageTempDir);
                if (localPath) {
                  pathParts.push(`\n  图片${i + 1}（可用 image 工具分析）: ${localPath}`);
                  added++;
                }
              }
            }
            if (pathParts.length) {
              picLine += pathParts.join("");
              feedsWithBase64Count++;
            }
          }

          const appShareTitle = String(f.appShareTitle ?? "");
          const appName = String(f.appName ?? "");
          const fwdContent = f.rt_con ? String(typeof f.rt_con === 'object' ? (f.rt_con as Record<string, unknown>).content ?? '' : f.rt_con) : '';
          const fwdName = String(f.rt_uinname ?? "");
          const fwdLine = fwdContent ? `\n  转发自 ${fwdName}: ${fwdContent.slice(0, 60)}` : "";
          const appLine = appName && appName !== '说说' ? `\n  [${appName}]${appShareTitle ? ' ' + appShareTitle : ''}` : '';

          return `${name}(${uin}) [${time}] tid=${tid}: ${text}${appLine}${fwdLine}${picLine}`;
        });
        const pageLabel = cursor ? "（续页）" : "第1页";
        const nextLine = nextCursor
          ? `\n\n要看下一页，传 cursor="${nextCursor}"`
          : "\n\n（没有更多了）";
        const hasImagePaths = lines.some((l) => l.includes("（可用 image 工具分析）"));
        const headerHint = hasImagePaths
          ? "【识图】下方带「图片N（可用 image 工具分析）」的路径可直接作为 image 工具的 image 参数传入进行识图。\n\n"
          : "";
        return textResult(`好友动态 ${pageLabel} (${feeds.length} 条):\n\n${headerHint}${lines.join("\n\n")}${nextLine}`);
      },
    },

    // ── 9. qzone_check_cookie ──
    {
      name: "qzone_check_cookie",
      description: "检查 QZone 桥接当前 Cookie 是否有效，返回 p_skey/skey 状态与年龄。Cookie 失效时可用 qzone_update_cookie 更新。",
      parameters: { type: "object", properties: {} },
      async execute(_id: string): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const res = await ctx.qzoneApi!.checkCookie();
        if (res.status !== "ok" && res.retcode !== 0) return textResult(formatResponse(res));
        const data = res.data as Record<string, unknown> | null;
        const age = data?.cookie_age_seconds;
        const hasPskey = !!data?.has_p_skey;
        const hasSkey = !!data?.has_skey;
        return textResult(
          `Cookie 状态: p_skey=${hasPskey ? "✓" : "✗"} skey=${hasSkey ? "✓" : "✗"}${age != null ? `，已使用 ${age} 秒` : ""}`,
        );
      },
    },

    // ── 10. qzone_update_cookie ──
    {
      name: "qzone_update_cookie",
      description: "用新的 Cookie 字符串更新 QZone 桥接登录状态（桥接会写回缓存与 .env）。cookie_string 需包含 uin、p_uin、skey、p_skey 等，格式与浏览器复制的 Cookie 一致（分号分隔）。",
      parameters: {
        type: "object",
        required: ["cookie_string"],
        properties: {
          cookie_string: { type: "string", description: "完整 Cookie 字符串（如从浏览器复制，分号分隔 key=value）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const cookieString = String(params.cookie_string ?? "").trim();
        if (!cookieString) return textResult("[错误] 缺少 cookie_string");
        log.info?.(`[QZone-Tool] qzone_update_cookie called (length=${cookieString.length})`);
        const res = await ctx.qzoneApi!.updateCookie(cookieString);
        if (res.status !== "ok" || res.retcode !== 0) return textResult(formatResponse(res));
        const data = res.data as Record<string, unknown> | null;
        const msg = (data?.message as string) ?? "Cookie 已更新";
        const nickname = data?.nickname as string | undefined;
        const userId = data?.user_id as string | number | undefined;
        return textResult(`${msg}${userId != null ? `，QQ: ${userId}` : ""}${nickname ? `，昵称: ${nickname}` : ""}`);
      },
    },

    // ── 10.5 qzone_get_portrait ──
    {
      name: "qzone_get_portrait",
      description: "获取 QQ 用户资料（昵称、头像等）。user_id=目标 QQ 号。",
      parameters: {
        type: "object",
        required: ["user_id"],
        properties: {
          user_id: { type: "string", description: "目标 QQ 号" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const userId = String(params.user_id ?? "");
        if (!userId) return textResult("[错误] 缺少 user_id");
        const res = await ctx.qzoneApi!.getPortrait(userId);
        if (res.status !== "ok") return textResult(formatResponse(res));
        const data = res.data as Record<string, unknown> | null;
        const nickname = data?.nickname ?? data?.name ?? "?";
        const avatar = data?.avatar ?? data?.figureurl ?? "";
        return textResult(`昵称: ${nickname}${avatar ? `\n头像: ${avatar}` : ""}`);
      },
    },

    // ── 10.6 qzone_set_privacy ──
    {
      name: "qzone_set_privacy",
      description: "设置某条说说的可见范围。privacy: public=所有人可见，private=仅自己。",
      parameters: {
        type: "object",
        required: ["tid", "privacy"],
        properties: {
          tid: { type: "string", description: "说说 ID" },
          privacy: { type: "string", enum: ["public", "private"], description: "可见范围" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        const privacy = String(params.privacy ?? "").toLowerCase() as "public" | "private";
        if (!tid || !privacy) return textResult("[错误] 缺少 tid 或 privacy");
        if (privacy !== "public" && privacy !== "private") return textResult("[错误] privacy 须为 public 或 private");
        const res = await ctx.qzoneApi!.setEmotionPrivacy(tid, privacy);
        return textResult(formatResponse(res, `已设为${privacy === "public" ? "所有人可见" : "仅自己可见"}`));
      },
    },

    // ── 10.7 qzone_create_album ──
    {
      name: "qzone_create_album",
      description: "创建 QQ 空间相册。name=相册名，desc=描述（可选），priv=权限（可选，默认 1）。",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "相册名称" },
          desc: { type: "string", description: "相册描述（可选）" },
          priv: { type: "number", description: "权限（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const name = String(params.name ?? "");
        if (!name) return textResult("[错误] 缺少 name");
        const desc = params.desc ? String(params.desc) : undefined;
        const priv = params.priv != null ? Number(params.priv) : undefined;
        const res = await ctx.qzoneApi!.createAlbum(name, desc, priv);
        return textResult(formatResponse(res, "相册创建成功"));
      },
    },

    // ── 10.8 qzone_delete_album ──
    {
      name: "qzone_delete_album",
      description: "删除 QQ 空间相册。album_id=相册 ID（从 qzone_get_albums 获取）。",
      parameters: {
        type: "object",
        required: ["album_id"],
        properties: {
          album_id: { type: "string", description: "相册 ID" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const albumId = String(params.album_id ?? "");
        if (!albumId) return textResult("[错误] 缺少 album_id");
        const res = await ctx.qzoneApi!.deleteAlbum(albumId);
        return textResult(formatResponse(res, "相册已删除"));
      },
    },

    // ── 10.9 qzone_delete_photo ──
    {
      name: "qzone_delete_photo",
      description: "删除相册中的某张照片。album_id=相册ID，photo_id=照片ID（lloc）。user_id 可选。",
      parameters: {
        type: "object",
        required: ["album_id", "photo_id"],
        properties: {
          album_id: { type: "string", description: "相册 ID" },
          photo_id: { type: "string", description: "照片 ID（lloc）" },
          user_id: { type: "string", description: "相册所属 QQ（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const albumId = String(params.album_id ?? "");
        const photoId = String(params.photo_id ?? "");
        if (!albumId || !photoId) return textResult("[错误] 缺少 album_id 或 photo_id");
        const userId = params.user_id ? String(params.user_id) : undefined;
        const res = await ctx.qzoneApi!.deletePhoto(albumId, photoId, userId);
        return textResult(formatResponse(res, "照片已删除"));
      },
    },

    // ── 11. qzone_upload_image ──
    {
      name: "qzone_upload_image",
      description: "上传图片到 QQ 空间相册",
      parameters: {
        type: "object",
        required: ["image"],
        properties: {
          image: { type: "string", description: "图片 URL (http/https) 或 base64:// 数据" },
          album_id: { type: "string", description: "目标相册 ID（可选）" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const image = String(params.image ?? "");
        if (!image) return textResult("[错误] 缺少 image");
        const albumId = params.album_id ? String(params.album_id) : undefined;
        const res = await ctx.qzoneApi!.uploadImage(image, albumId);
        return textResult(formatResponse(res, "图片上传成功"));
      },
    },
  ];
}
