import type { AnyAgentTool, AgentToolResult } from "../types-compat.js";
import type { PluginContext } from "../context.js";
import type { QzoneBridgeResponse } from "../napcat/qzone-api.js";

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
      description: `发布 QQ 空间说说（你的QQ号: ${selfId}）。content=文字内容，images=图片URL数组（可选）`,
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
        const content = String(params.content ?? "");
        if (!content) return textResult("[错误] 缺少 content");
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
      description: `获取QQ空间说说列表。不传user_id则获取自己(${selfId})的说说，返回tid等信息。指定某好友时务必同时传 count（建议50）和 max_pages（建议15）以多翻页，否则可能只拿到很少几条。`,
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
        const res = await ctx.qzoneApi!.getEmotionList(userId, pos, num, maxPages);
        if (res.status !== "ok") return textResult(formatResponse(res));

        const data = res.data as Record<string, unknown> | null;
        const msglist = (data?.msglist ?? data?.data) as Record<string, unknown>[] | undefined;
        if (!msglist?.length) return textResult("暂无说说");

        const lines = msglist.slice(0, num).map((msg) => {
          const tid = String(msg.tid ?? "");
          const uin = String(msg.uin ?? msg.owner ?? "").trim() || "?";
          const rawContent = String(msg.content ?? msg.con ?? "");
          const text = rawContent.slice(0, 80) + (rawContent.length > 80 ? "…" : "");
          const time = msg.created_time ?? msg.createTime ?? "";
          const cmtNum = msg.cmtnum ?? msg.commentnum ?? 0;
          const likeNum = msg.likenum ?? 0;
          const picArr = msg.pic as Array<{ url?: string }> | undefined;
          const picUrls = Array.isArray(picArr) ? picArr.map((p) => p?.url).filter(Boolean) as string[] : [];
          const picLine = picUrls.length ? `\n  图片: ${picUrls.join(" | ")}` : "";
          return `[${time}] tid=${tid} ${uin} 💬${cmtNum} 👍${likeNum}\n  ${text}${picLine}`;
        });
        return textResult(`说说列表 (${msglist.length} 条):\n\n${lines.join("\n\n")}`);
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
      description: `评论说说；也可回复某条评论（传 reply_comment_id 与 reply_uin）。必填 tid、content，服务端自动补全其他参数。评论自己的说说可加 user_id=${selfId}。`,
      parameters: {
        type: "object",
        required: ["tid", "content"],
        properties: {
          tid: { type: "string", description: "说说 ID" },
          content: { type: "string", description: "评论内容" },
          user_id: { type: "string", description: "说说作者 QQ 号（可选，服务端可自动识别）" },
          reply_comment_id: { type: "string", description: "要回复的那条评论的 ID（从 qzone_get_comments 或评论通知中获取）；与 reply_uin 同时传则发为回复评论" },
          reply_uin: { type: "string", description: "要回复的那条评论的作者 QQ 号，须与 reply_comment_id 成对传入" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>): Promise<AgentToolResult> {
        const err = guard();
        if (err) return textResult(err);
        const tid = String(params.tid ?? "");
        const content = String(params.content ?? "");
        if (!tid || !content) return textResult("[错误] 缺少 tid / content");
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
          const time = c.create_time ?? c.createTime ?? c.createtime ?? "";
          const uin = c.uin ?? c.commentuin ?? c.user_id ?? "";
          const idPart = id ? ` (comment_id=${id}${uin ? ` uin=${uin}` : ""})` : "";
          return `[${time}] ${name}: ${text}${idPart}`;
        });
        const sourceNote = data?._source === "feeds3" ? `（来源：feeds3 兜底${typeof data?._feeds3_total === "number" ? `，共 ${data._feeds3_total} 条` : ""}）` : "";
        return textResult(`评论 (${comments.length} 条)${sourceNote}:\n${lines.join("\n")}`);
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
          const time = v.time ?? v.visitTime ?? "";
          const src = v._source_name ?? "";
          return `${name} (${time})${src ? ` 来自${src}` : ""}`;
        });
        return textResult(`访客 (${items.length} 人):\n${lines.join("\n")}`);
      },
    },

    // ── 8. qzone_get_friend_feeds ──
    {
      name: "qzone_get_friend_feeds",
      description: "获取好友最近动态。每条返回完整操作参数，可直接传给 qzone_like / qzone_comment。翻页传上次结果的 next_cursor。",
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
        const res = await ctx.qzoneApi!.getFriendFeeds(cursor, num);
        if (res.status !== "ok") return textResult(formatResponse(res));

        const data = res.data as Record<string, unknown> | null;
        const feeds = (data?.data ?? data?.msglist ?? data) as Record<string, unknown>[] | undefined;
        const nextCursor = typeof data?.next_cursor === "string" ? data.next_cursor : "";

        if (!Array.isArray(feeds) || !feeds.length) {
          if (cursor) return textResult("好友说说已全部加载完毕。");
          return textResult("暂无好友说说（近期好友没有发说说）");
        }

        const lines = feeds.map((f) => {
          const name = f.name ?? f.nickname ?? f.uin ?? "?";
          const tid = String(f.tid ?? "");
          const uin = String(f.uin ?? "");
          const rawContent = String(f.content ?? f.con ?? "");
          const text = rawContent.slice(0, 80) + (rawContent.length > 80 ? "…" : "");
          const time = f.created_time ?? f.createTime ?? "";
          const picArr = f.pic as Array<{ url?: string }> | undefined;
          const picUrls = Array.isArray(picArr) ? picArr.map((p) => p?.url).filter(Boolean) as string[] : [];
          const picLine = picUrls.length ? `\n  图片: ${picUrls.join(" | ")}` : "";

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
        return textResult(`好友动态 ${pageLabel} (${feeds.length} 条):\n\n${lines.join("\n\n")}${nextLine}`);
      },
    },

    // ── 9. qzone_upload_image ──
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
