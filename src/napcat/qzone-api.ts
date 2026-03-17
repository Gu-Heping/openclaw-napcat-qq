export interface QzoneAPIOptions {
  timeoutMs?: number;
  retryBackoffMs?: number;
}

export interface QzoneBridgeResponse {
  status: string;
  retcode: number;
  data: unknown;
  message?: string;
  echo?: string;
}

/**
 * HTTP client for the onebot-qzone bridge (OneBot v11 over HTTP).
 * Mirrors NapCatAPI's fetch+retry pattern.
 */
export class QzoneAPI {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeoutMs: number;
  private retryBackoffMs: number;

  constructor(baseUrl = "http://127.0.0.1:5700", token?: string, opts?: QzoneAPIOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.headers = { "Content-Type": "application/json" };
    if (token) this.headers["Authorization"] = `Bearer ${token}`;
    this.timeoutMs = opts?.timeoutMs ?? 15_000;
    this.retryBackoffMs = opts?.retryBackoffMs ?? 500;
  }

  private async request(
    action: string,
    data?: Record<string, unknown>,
  ): Promise<QzoneBridgeResponse> {
    const url = `${this.baseUrl}/${action}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: this.headers,
          body: data ? JSON.stringify(data) : "{}",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        return (await resp.json()) as QzoneBridgeResponse;
      } catch (e) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, this.retryBackoffMs * (attempt + 1)));
          continue;
        }
        return { status: "failed", retcode: -1, data: null, message: String(e) };
      }
    }
    return { status: "failed", retcode: -1, data: null, message: "Max retries exceeded" };
  }

  // ── meta ──
  getLoginInfo() {
    return this.request("get_login_info");
  }

  getStatus() {
    return this.request("get_status");
  }

  /** 校验当前 Cookie 是否有效 */
  checkCookie() {
    return this.request("check_cookie");
  }

  /** 更新 QZone Cookie（桥接会写回缓存与 .env） */
  updateCookie(cookieString: string) {
    return this.request("update_cookie", { cookie: cookieString });
  }

  // ── 说说 CRUD ──
  /** 获取说说列表；includeImageData 为 true 时桥接会在每条说说的图片中附带 base64（默认 true，与 onebot-qzone 6fee393+ 一致） */
  getEmotionList(userId?: string, pos = 0, num = 20, maxPages?: number, includeImageData = true) {
    const d: Record<string, unknown> = { pos, num, include_image_data: includeImageData };
    if (userId) d.user_id = userId;
    if (maxPages != null) d.max_pages = maxPages;
    // #region agent log
    fetch('http://localhost:7243/ingest/73a4a46f-7107-4b2b-b2e9-e178389b2a24',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'qzone-api.ts:getEmotionList',message:'get_emotion_list request payload',data:{include_image_data:d.include_image_data,pos:d.pos,num:d.num},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    return this.request("get_emotion_list", d);
  }

  publish(content: string, images?: string[], whoCanSee?: number) {
    const message: unknown[] = [];
    if (content) message.push({ type: "text", data: { text: content } });
    if (images) {
      for (const img of images) {
        message.push({ type: "image", data: { file: img } });
      }
    }
    const d: Record<string, unknown> = { message };
    if (whoCanSee !== undefined) d.who_can_see = whoCanSee;
    return this.request("send_msg", d);
  }

  deleteEmotion(tid: string) {
    return this.request("delete_msg", { message_id: tid, tid });
  }

  getDetail(userId: string, tid: string) {
    return this.request("get_msg", { user_id: userId, message_id: tid, tid });
  }

  getFeedImages(userId: string, tid: string) {
    return this.request("get_feed_images", { user_id: userId, tid });
  }

  /** 拉取 QZone CDN 图片为 base64（桥接白名单：qpic.cn、photo.store.qq.com、qzonestyle.gtimg.cn），与 onebot-qzone fetch_image 一致 */
  fetchImage(url: string) {
    return this.request("fetch_image", { url });
  }

  /** 批量拉取 QZone CDN 图片为 base64，返回 data.images: Array<{ url, base64?, content_type? }> */
  fetchImages(urls: string[]) {
    if (urls.length === 0) return Promise.resolve({ status: "ok", retcode: 0, data: { images: [] }, message: undefined, echo: undefined });
    return this.request("fetch_image", { urls });
  }

  // ── 评论 ──
  sendComment(tid: string, content: string, userId?: string, replyCommentId?: string, replyUin?: string) {
    const d: Record<string, unknown> = { tid, content };
    if (userId) d.user_id = userId;
    if (replyCommentId) d.reply_comment_id = replyCommentId;
    if (replyUin) d.reply_uin = replyUin;
    return this.request("send_comment", d);
  }

  getCommentList(userId: string, tid: string, num = 20, pos = 0) {
    return this.request("get_comment_list", { user_id: userId, tid, num, pos });
  }

  deleteComment(uin: string, tid: string, commentId: string, commentUin?: string) {
    const d: Record<string, unknown> = { uin, tid, comment_id: commentId };
    if (commentUin) d.comment_uin = commentUin;
    return this.request("delete_comment", d);
  }

  // ── 点赞 ──
  sendLike(tid: string, userId?: string) {
    const d: Record<string, unknown> = { tid };
    if (userId) d.user_id = userId;
    return this.request("send_like", d);
  }

  getLikeList(userId: string, tid: string) {
    return this.request("get_like_list", { user_id: userId, tid });
  }

  /** 取消点赞（桥接可自动补全 user_id 等） */
  unlike(tid: string, userId?: string) {
    const d: Record<string, unknown> = { tid };
    if (userId) d.user_id = userId;
    return this.request("unlike", d);
  }

  /** 转发说说：user_id=原作者，tid=说说ID，content=转发附言 */
  forwardMsg(userId: string, tid: string, content?: string) {
    const d: Record<string, unknown> = { user_id: userId, tid };
    if (content) d.content = content;
    return this.request("forward_msg", d);
  }

  // ── 好友动态 / 访客 ──
  /** 获取好友动态；includeImageData 为 true 时桥接会在每条 pic 中附带 base64（默认 true） */
  getFriendFeeds(cursor?: string, num?: number, includeImageData = true) {
    const d: Record<string, unknown> = { include_image_data: includeImageData };
    if (cursor) d.cursor = cursor;
    if (num != null) d.num = num;
    return this.request("get_friend_feeds", d);
  }

  getVisitorList(userId?: string) {
    const d: Record<string, unknown> = {};
    if (userId) d.user_id = userId;
    return this.request("get_visitor_list", d);
  }

  /** 说说浏览/流量数据（需 tid） */
  getTrafficData(userId: string, tid: string) {
    return this.request("get_traffic_data", { user_id: userId, tid });
  }

  /** 设置说说可见范围：privacy 为 'private' | 'public' */
  setEmotionPrivacy(tid: string, privacy: "private" | "public") {
    return this.request("set_emotion_privacy", { tid, privacy });
  }

  /** 获取用户头像/资料（昵称等） */
  getPortrait(userId: string) {
    return this.request("get_portrait", { user_id: userId });
  }

  // ── 图片上传 ──
  uploadImage(base64OrUrl: string, albumId?: string) {
    const d: Record<string, unknown> = {};
    if (base64OrUrl.startsWith("http://") || base64OrUrl.startsWith("https://")) {
      d.url = base64OrUrl;
    } else {
      d.base64 = base64OrUrl.replace(/^base64:\/\//, "");
    }
    if (albumId) d.album_id = albumId;
    return this.request("upload_image", d);
  }

  // ── 相册 ──
  getAlbumList(userId?: string) {
    const d: Record<string, unknown> = {};
    if (userId) d.user_id = userId;
    return this.request("get_album_list", d);
  }

  getPhotoList(userId?: string, albumId?: string, num = 30) {
    const d: Record<string, unknown> = { num };
    if (userId) d.user_id = userId;
    if (albumId) d.album_id = albumId;
    return this.request("get_photo_list", d);
  }

  createAlbum(name: string, desc?: string, priv?: number) {
    const d: Record<string, unknown> = { name };
    if (desc) d.desc = desc;
    if (priv !== undefined) d.priv = priv;
    return this.request("create_album", d);
  }

  deleteAlbum(albumId: string) {
    return this.request("delete_album", { album_id: albumId });
  }

  deletePhoto(albumId: string, photoId: string, userId?: string) {
    const d: Record<string, unknown> = { album_id: albumId, photo_id: photoId };
    if (userId) d.user_id = userId;
    return this.request("delete_photo", d);
  }

  getVersionInfo() {
    return this.request("get_version_info");
  }

  resetApiCaches() {
    return this.request("reset_api_caches");
  }

  probeApiRoutes(userId: string, tid: string) {
    return this.request("probe_api_routes", { uin: userId, tid });
  }
}
