/**
 * NapCat HTTP API Client
 */

export class NapCatClient {
  constructor(baseUrl = "http://127.0.0.1:3000", token = null) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  async _request(method, endpoint, data = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : null
      });
      return await response.json();
    } catch (error) {
      console.error("[NapCatClient] Request failed:", error);
      return { status: "failed", error: error.message };
    }
  }

  // 获取登录信息
  async getLoginInfo() {
    return this._request("GET", "/get_login_info");
  }

  // 获取好友列表
  async getFriendList() {
    return this._request("GET", "/get_friend_list");
  }

  // 获取群组列表
  async getGroupList() {
    return this._request("GET", "/get_group_list");
  }

  // 发送私聊消息
  async sendPrivateMsg(userId, message) {
    return this._request("POST", "/send_private_msg", {
      user_id: parseInt(userId),
      message: [{ type: "text", data: { text: message } }]
    });
  }

  // 发送群消息
  async sendGroupMsg(groupId, message) {
    return this._request("POST", "/send_group_msg", {
      group_id: parseInt(groupId),
      message: [{ type: "text", data: { text: message } }]
    });
  }
}
