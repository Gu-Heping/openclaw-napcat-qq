import type { OneBotApiResult } from "./types.js";

export interface NapCatAPIOptions {
  timeoutMs?: number;
  retryBackoffMs?: number;
}

export class NapCatAPI {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeoutMs: number;
  private retryBackoffMs: number;

  constructor(baseUrl = "http://127.0.0.1:3000", token?: string, opts?: NapCatAPIOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.headers = { "Content-Type": "application/json" };
    if (token) this.headers["Authorization"] = `Bearer ${token}`;
    this.timeoutMs = opts?.timeoutMs ?? 10_000;
    this.retryBackoffMs = opts?.retryBackoffMs ?? 500;
  }

  private async request(
    method: "GET" | "POST",
    endpoint: string,
    data?: Record<string, unknown>,
  ): Promise<OneBotApiResult> {
    const url = `${this.baseUrl}${endpoint}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const opts: RequestInit = {
          method,
          headers: this.headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        };
        if (method === "POST" && data) opts.body = JSON.stringify(data);
        const resp = await fetch(url, opts);
        return (await resp.json()) as OneBotApiResult;
      } catch (e) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, this.retryBackoffMs * (attempt + 1)));
          continue;
        }
        return { status: "failed", retcode: -1, message: String(e) };
      }
    }
    return { status: "failed", retcode: -1, message: "Max retries exceeded" };
  }

  getLoginInfo() { return this.request("GET", "/get_login_info"); }
  getVersionInfo() { return this.request("GET", "/get_version_info"); }
  getFriendList() { return this.request("GET", "/get_friend_list"); }
  getGroupList() { return this.request("GET", "/get_group_list"); }
  getStrangerInfo(userId: string) { return this.request("POST", "/get_stranger_info", { user_id: Number(userId) }); }
  getGroupInfo(groupId: string) { return this.request("POST", "/get_group_info", { group_id: Number(groupId) }); }
  getGroupMemberList(groupId: string) { return this.request("POST", "/get_group_member_list", { group_id: Number(groupId) }); }

  sendPrivateMsg(userId: string, message: string | unknown[]) {
    return this.request("POST", "/send_private_msg", { user_id: Number(userId), message });
  }
  sendGroupMsg(groupId: string, message: string | unknown[]) {
    return this.request("POST", "/send_group_msg", { group_id: Number(groupId), message });
  }

  sendFace(userId: string, faceId: number) {
    return this.sendPrivateMsg(userId, [{ type: "face", data: { id: String(faceId) } }]);
  }
  sendGroupFace(groupId: string, faceId: number) {
    return this.sendGroupMsg(groupId, [{ type: "face", data: { id: String(faceId) } }]);
  }
  sendFaces(userId: string, faceIds: number[]) {
    return this.sendPrivateMsg(userId, faceIds.map((id) => ({ type: "face", data: { id: String(id) } })));
  }
  sendGroupFaces(groupId: string, faceIds: number[]) {
    return this.sendGroupMsg(groupId, faceIds.map((id) => ({ type: "face", data: { id: String(id) } })));
  }

  friendPoke(userId: string) { return this.request("POST", "/friend_poke", { user_id: Number(userId) }); }
  groupPoke(groupId: string, userId: string) {
    return this.request("POST", "/group_poke", { group_id: Number(groupId), user_id: Number(userId) });
  }

  deleteMsg(messageId: string) { return this.request("POST", "/delete_msg", { message_id: Number(messageId) }); }
  getMsg(messageId: string) { return this.request("POST", "/get_msg", { message_id: Number(messageId) }); }

  setGroupKick(groupId: string, userId: string, rejectAdd = false) {
    return this.request("POST", "/set_group_kick", { group_id: Number(groupId), user_id: Number(userId), reject_add_request: rejectAdd });
  }
  setGroupBan(groupId: string, userId: string, duration = 1800) {
    return this.request("POST", "/set_group_ban", { group_id: Number(groupId), user_id: Number(userId), duration });
  }
  setGroupCard(groupId: string, userId: string, card: string) {
    return this.request("POST", "/set_group_card", { group_id: Number(groupId), user_id: Number(userId), card });
  }
  setGroupName(groupId: string, groupName: string) {
    return this.request("POST", "/set_group_name", { group_id: Number(groupId), group_name: groupName });
  }

  uploadPrivateFile(userId: string, file: string, name: string) {
    return this.request("POST", "/upload_private_file", { user_id: Number(userId), file, name });
  }
  uploadGroupFile(groupId: string, file: string, name: string, folder = "") {
    const d: Record<string, unknown> = { group_id: Number(groupId), file, name };
    if (folder) d.folder = folder;
    return this.request("POST", "/upload_group_file", d);
  }

  getImage(file: string) { return this.request("POST", "/get_image", { file }); }
  getFile(fileId: string) { return this.request("POST", "/get_file", { file_id: fileId }); }
  getForwardMsg(messageId: string) { return this.request("POST", "/get_forward_msg", { message_id: messageId }); }

  setFriendAddRequest(flag: string, approve = true, remark = "") {
    const d: Record<string, unknown> = { flag, approve };
    if (remark) d.remark = remark;
    return this.request("POST", "/set_friend_add_request", d);
  }
  setGroupAddRequest(flag: string, subType: string, approve = true, reason = "") {
    const d: Record<string, unknown> = { flag, sub_type: subType, approve };
    if (reason) d.reason = reason;
    return this.request("POST", "/set_group_add_request", d);
  }

  setInputStatus(userId: string, eventType = 1) {
    return this.request("POST", "/set_input_status", { user_id: Number(userId), event_type: eventType });
  }
}
