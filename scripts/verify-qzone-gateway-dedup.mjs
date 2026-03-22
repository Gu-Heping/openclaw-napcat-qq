#!/usr/bin/env node
/**
 * Sample OneBot JSON (same shape as onebot-qzone poller) -> synthetic text -> gateway coalesce key.
 * Mirrors src/gateway.ts buildQzoneCoalesceKey + shouldDispatchQzoneEvent TTLs.
 * Run: node scripts/verify-qzone-gateway-dedup.mjs
 */
import assert from "node:assert/strict";

function bridgeJsonToSyntheticComment(ev) {
  const userId = String(ev.user_id ?? "0");
  const nickname = ev.sender_name || "";
  const content = ev.comment_content ?? "";
  const tid = ev.post_tid ?? ev._tid ?? "";
  const commentId = ev.comment_id ?? "";
  const isReply = ev._is_reply ?? false;
  const replyToNickname = ev._reply_to_nickname ?? "";
  const replyToUin = ev._reply_to_uin != null ? String(ev._reply_to_uin) : "";
  const parentCommentId = ev._parent_comment_id ?? "";
  const who = nickname || userId;
  const replyTarget = replyToNickname || replyToUin;
  let text = `[QQ空间·评论] ${who} ${isReply && replyTarget ? `回复了 @${replyTarget} 的评论` : "评论了你的说说"}`;
  if (content) text += `：「${content.length > 200 ? content.slice(0, 200) + "…" : content}」`;
  if (tid) text += `\ntid=${tid}`;
  if (commentId && userId)
    text += `\n回复可传 reply_comment_id=${commentId} reply_uin=${userId}（content 只写正文，@ 由服务端自动加）`;
  if (parentCommentId && isReply) text += `（父评论 id=${parentCommentId}）`;
  const detail = content ? `评论「${content.slice(0, 80)}」` : isReply && replyTarget ? `回复 @${replyTarget}` : "评论了说说";
  return { type: "comment", userId, content: text, nickname, detail, tid };
}

function bridgeJsonToSyntheticLike(ev) {
  const userId = String(ev.user_id ?? "0");
  const nickname = ev.sender_name || "";
  const tid = ev.post_tid ?? ev._tid ?? "";
  const who = nickname || userId;
  let text = `[QQ空间·点赞] ${who} 赞了你的说说`;
  if (tid) text += `\ntid=${tid}`;
  return { type: "like", userId, content: text, nickname, detail: "赞了说说", tid };
}

function buildQzoneCoalesceKey(event, recipient) {
  const contentKey = event.content.replace(/\s+/g, " ").slice(0, 80);
  return `${recipient}:${event.type}:${event.userId}:${event.tid ?? "-"}:${contentKey}`;
}

function createShouldDispatch() {
  const qzoneDispatchDedup = new Map();
  return (event, recipient) => {
    const ttlMs = event.type === "like" ? 30_000 : 12_000;
    const nowMs = Date.now();
    const key = buildQzoneCoalesceKey(event, recipient);
    const lastSeen = qzoneDispatchDedup.get(key) ?? 0;
    if (nowMs - lastSeen < ttlMs) return false;
    qzoneDispatchDedup.set(key, nowMs);
    for (const [dedupKey, seenAt] of qzoneDispatchDedup) {
      if (nowMs - seenAt > 5 * 60_000) qzoneDispatchDedup.delete(dedupKey);
    }
    return true;
  };
}

const sampleCommentBridge = {
  user_id: 876543210,
  sender_name: "好友A",
  comment_id: "feeds_comment_realistic_id_9f3a2b1c",
  comment_content: "周末一起吃饭",
  post_tid: "20250320143000abcdef",
};

const synComment = bridgeJsonToSyntheticComment(sampleCommentBridge);
const synLike = bridgeJsonToSyntheticLike({
  user_id: 876543210,
  sender_name: "好友A",
  post_tid: "20250320143000abcdef",
});

{
  const should = createShouldDispatch();
  assert.equal(should(synComment, "actor"), true);
  assert.equal(should(synComment, "actor"), false);
  assert.equal(should(synComment, "owner_copy"), true);
  assert.equal(should(synComment, "owner_copy"), false);
}
{
  const should = createShouldDispatch();
  assert.equal(should(synLike, "actor"), true);
  assert.equal(should(synLike, "actor"), false);
}

console.log("verify-qzone-gateway-dedup: OK");
