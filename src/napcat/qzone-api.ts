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

  // ── 说说 CRUD ──
  getEmotionList(userId?: string, pos = 0, num = 20, maxPages?: number) {
    const d: Record<string, unknown> = { pos, num };
    if (userId) d.user_id = userId;
    if (maxPages != null) d.max_pages = maxPages;
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

  // ── 好友动态 / 访客 ──
  getFriendFeeds(cursor?: string, num?: number) {
    const d: Record<string, unknown> = {};
    if (cursor) d.cursor = cursor;
    if (num != null) d.num = num;
    return this.request("get_friend_feeds", Object.keys(d).length ? d : undefined);
  }

  getVisitorList(userId?: string) {
    const d: Record<string, unknown> = {};
    if (userId) d.user_id = userId;
    return this.request("get_visitor_list", d);
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
}
