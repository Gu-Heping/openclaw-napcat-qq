# openclaw-napcat-qq

OpenClaw 渠道插件：用 NapCat（OneBot v11）接 QQ，支持私聊/群聊、Agent 对话、群管与文件收发。

**相关项目**

- [OpenClaw](https://github.com/openclaw/openclaw) — 本插件的运行环境（Gateway + Agent）
- [NapCat](https://github.com/NapNeko/NapCat) — QQ 协议实现（OneBot v11）
- [OneBot](https://github.com/botuniverse/onebot) — 机器人标准与 v11 协议
- [onebot-qzone](https://github.com/Gu-Heping/onebot-qzone)（qzone-bridge）— QQ 空间桥接，QQ 空间相关 Agent 工具（好友说说、指定用户说说等）需 NapCat 接本桥接后使用

## 能力概览

- **渠道**：QQ 私聊（dm）、群聊（group），需 NapCat 提供 HTTP API + WebSocket 事件。
- **媒体**：支持图片、文件收发（含 NapCat 容器路径映射）。
- **群管理**：踢人、禁言、群名片、群名（需 Bot 为管理员/群主）。
- **Agent 集成**：会话、回复、路由、长期记忆（QMD）、`before_model_resolve` 会话级模型切换。
- **QQ 命令**：以 `/` 开头，见下方命令列表。
- **Agent 工具**：供 OpenClaw Agent 调用的 QQ 能力，见下方工具列表。
- **主动消息**：可配置免打扰时段、按用户/全局间隔的主动推送。

## 安装

### 前置条件

- 已安装 [OpenClaw](https://github.com/openclaw/openclaw) 并能正常启动 Gateway（`openclaw gateway`）。
- 已部署 [NapCat](https://github.com/NapNeko/NapCat)（Docker 或本地），并拿到 **HTTP 地址**、**WebSocket 地址**、**访问 token** 和 **Bot 的 QQ 号（selfId）**。
- Node.js 18+（用于构建插件）。

### 步骤

**1. 克隆插件**

将本仓库克隆到 OpenClaw 的扩展目录。若目录不存在可先创建：

```bash
mkdir -p ~/.openclaw/extensions
git clone https://github.com/Gu-Heping/openclaw-napcat-qq.git ~/.openclaw/extensions/openclaw-napcat-qq
```

（Windows 用户将 `~/.openclaw` 换为 `%USERPROFILE%\.openclaw` 或你的 OpenClaw 状态目录。）

**2. 安装依赖并构建**

```bash
cd ~/.openclaw/extensions/openclaw-napcat-qq
npm install
npm run build
```

构建成功后会在当前目录生成 `dist/`。若报错，请确认 Node 版本 ≥ 18。

**3. 修改 OpenClaw 配置**

编辑 OpenClaw 的配置文件（通常为 `~/.openclaw/openclaw.json`），按下方「配置」一节补全或修改 `plugins`、必要时 `tools.allow`。务必把：

- `plugins.load.paths` 中的路径改成你本机的**绝对路径**（与上一步 `cd` 的目录一致）；
- `plugins.entries.napcat-qq.config` 中的 `httpUrl`、`wsUrl`、`token`、`selfId` 改成你的 NapCat 实际值。

**4. 重启 Gateway**

保存配置后重启 OpenClaw Gateway，使插件与配置生效：

```bash
# 若 Gateway 在前台运行，Ctrl+C 后重新执行：
openclaw gateway

# 若由 systemd 等管理，例如：
sudo systemctl restart openclaw-gateway
```

启动后查看日志中是否有 `[napcat-qq] ... registered`，确认插件已加载。

## 配置

在 `openclaw.json` 中需同时满足：

- 在 **plugins.allow** 中加入 `"napcat-qq"`。
- 在 **plugins.load.paths** 中加入本插件目录的绝对路径。
- 在 **plugins.entries.napcat-qq** 中设置 `enabled: true` 并在 **config** 中填写连接与行为。
- 若使用 Agent 工具，需在 **tools.allow** 中加入 `"napcat-qq"`（与当前项目一致）。

最小示例（仅保留与本插件相关字段）：

```json
{
  "plugins": {
    "allow": ["napcat-qq"],
    "load": {
      "paths": ["/path/to/openclaw/extensions/openclaw-napcat-qq"]
    },
    "entries": {
      "napcat-qq": {
        "enabled": true,
        "config": {
          "httpUrl": "http://127.0.0.1:3000",
          "wsUrl": "ws://127.0.0.1:3001",
          "token": "YOUR_NAPCAT_ACCESS_TOKEN",
          "selfId": "YOUR_BOT_QQ_NUMBER"
        }
      }
    }
  }
}
```

### 配置项说明（与代码一致）

| 字段 | 类型 | 说明 | 默认 |
|------|------|------|------|
| **httpUrl** | string | NapCat HTTP API 地址 | `http://127.0.0.1:3000` |
| **wsUrl** | string | NapCat WebSocket 地址 | `ws://127.0.0.1:3001` |
| **token** | string | NapCat 访问 token | — |
| **selfId** | string | Bot 的 QQ 号 | — |
| **behavior** | object | 群聊回复与触发行为 | 见下 |
| **proactive** | object | 主动消息策略 | 见下 |
| **models** | object | `/model` 别名 → `[provider, model]` 映射 | 内置 kimi / claude / deepseek 等 |
| **limits** | object | 重试、超时、消息/文件大小、历史条数等 | 见 openclaw.plugin.json |
| **network** | object | 重连、ping、fetch 超时等 | 见 openclaw.plugin.json |
| **paths** | object | workspace、imageTemp、sessionsDir、containerPrefixes 覆盖 | 默认基于 OPENCLAW_HOME / HOME |

- **behavior**：`botNames`（@ 触发名）、`helpKeywords`、`questionPatterns`、`groupReplyProbInConvo` / `groupReplyProbRandom`、`groupReplyWindowMs`、`minIntervalMs`、`dedupTtlMs`。
- **proactive**：`enabled`、`checkIntervalMs`、`minGlobalIntervalMs`、`perUserIntervalMs`、`minSinceUserMsgMs`、`quietHoursStart` / `quietHoursEnd`、`pendingKeywords`。

完整 schema 见 **openclaw.plugin.json** 的 `configSchema`。

## QQ 命令（/ 开头）

| 命令 / 别名 | 说明 |
|-------------|------|
| **/help**、/h、/帮助 | 显示帮助与指令说明 |
| **/ping** | 测试连通性，回复 pong |
| **/status**、/状态 | 查看运行状态、会话 key、发送记录条数 |
| **/clear**、/new、/清除、/新会话、/reset | 清空当前 AI 对话上下文 |
| **/summary_clear**、/总结并清空 | 先总结对话写入长期记忆，再清空会话 |
| **/model**、/模型 \<别名\> | 切换当前会话的模型（如 kimi、claude、deepseek、minimax、qwen、kimi-or、openrouter） |
| **/note**、/笔记 \<内容\> | 给当前用户记一条笔记（写入记忆） |
| **/history**、/记录 | 查看最近发送的消息（默认 5 条） |
| **/clear_history**、/清除历史 | 清除消息发送记录 |

群聊中需 **@Bot** 或触发配置的 **botNames / helpKeywords / questionPatterns** 才会进入回复流程。

## Agent 工具（供 OpenClaw Agent 调用）

- **消息**：`qq_send_message`（私聊）、`qq_send_group_message`（群聊，支持 @、表情）、`qq_send_poke`（戳一戳）、`qq_recall_message`（撤回）、`qq_get_recent_messages`（最近发送记录）。
- **图片与文件**：`qq_send_image`、`qq_send_file`（支持 URL 或本地路径）。
- **信息查询**：`qq_get_stranger_info`、`qq_get_group_info`、`qq_get_user_avatar`、`qq_get_group_avatar`、`qq_get_friend_list`、`qq_get_group_list`、`qq_get_group_member_list`。
- **群管理**：`qq_kick_group_member`、`qq_ban_group_member`、`qq_set_group_card`、`qq_set_group_name`。
- **请求处理**：`qq_get_pending_requests`、`qq_handle_friend_request`、`qq_handle_group_request`。
- **QQ 空间**（需 NapCat 接 [onebot-qzone](https://github.com/Gu-Heping/onebot-qzone) 桥接）：`qzone_get_friend_feeds`（好友最近说说，游标分页：首页不传 `cursor`，续页传上次返回的 `next_cursor`）、`qzone_get_posts`（指定用户说说）等。

工具参数与说明见 **src/tools/** 下各文件的 `name`、`description` 与 `parameters`。

## 依赖

- [NapCat](https://github.com/NapNeko/NapCat)（OneBot v11，Docker 或本地部署，需提供 HTTP + WS）。
- OpenClaw（Gateway 加载本插件；会话、回复、路由、记忆由 OpenClaw 提供）。
- Node.js 18+，依赖仅 **ws**（见 package.json）。

## 开发

```bash
npm install
npm run build   # 或 npm run watch
```

构建产物在 **dist/**，入口为 **dist/index.js**；插件通过 `openclaw.plugin.json` 的 `openclaw.extensions` 暴露。

## License

MIT
