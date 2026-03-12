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

### channels.qq 配置（与 Telegram/WeCom 对齐）

与 Telegram、WeCom 等渠道一致，可在 `openclaw.json` 的 **channels.qq** 中配置策略，由核心与插件共同使用（路由、允许列表等）。

在 `openclaw.json` 的 **channels** 下增加 **qq** 段即可，例如：

```json
{
  "channels": {
    "qq": {
      "enabled": true,
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["123456789", "987654321"]
    }
  }
}
```

| 字段 | 类型 | 说明 | 默认 |
|------|------|------|------|
| **enabled** | boolean | 是否启用 QQ 渠道；为 `false` 时插件不启动该渠道 | 不设则视为启用 |
| **dmPolicy** | string | 私聊策略：`open`（按 allowFrom）、`allowlist`（仅允许列表）、`pairing`（仅允许列表，同 allowlist）、`disabled`（拒绝所有私聊） | `open` |
| **allowFrom** | string[] | 允许的私聊来源（QQ 号或 `"*"` 表示所有人）；dmPolicy 为 `open` 时 `["*"]` 表示接受所有人 | `[]` |
| **groupPolicy** | string | 群聊策略：`open`（所有群）、`allowlist`（仅 groupAllowFrom 中的群）、`disabled`（拒绝所有群） | `open` |
| **groupAllowFrom** | string[] | 允许的群号列表；仅当 groupPolicy 为 `allowlist` 时生效 | `[]` |

- 未配置 `channels.qq` 时，行为与之前一致（渠道启用，私聊/群聊均按插件原有逻辑）。
- 配置后，核心的 `resolveAgentRoute` 会读取 `channels.qq`，插件入站也会按上述策略过滤，与 Telegram/WeCom 的配置方式一致。

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
- **QQ 空间**（需 NapCat 接 [onebot-qzone](https://github.com/Gu-Heping/onebot-qzone) 桥接）：`qzone_get_friend_feeds`（好友最近说说，游标分页）、`qzone_get_posts`（指定用户说说）、`qzone_get_comments`（评论列表，PC/mobile 失败时使用 feeds3 兜底）、`qzone_comment`（发评论/回复评论）、`qzone_like`（点赞，仅需 tid）等。

工具参数与说明见 **src/tools/** 下各文件的 `name`、`description` 与 `parameters`。

## 故障排查（根因与应对）

### 回复出现「Unexpected non-whitespace character after JSON at position …」

- **原因**：OpenClaw 核心或模型在解析某段内容（如模型输出、工具结果）时执行了 `JSON.parse`，输入不是合法 JSON（例如带前缀/后缀、被截断），异常文案被当作回复内容下发。
- **本插件已做**：发送前若检测到该类文案会替换为「回复解析异常，请再发一句试试。」；若使用 legacy 入口（`index.js`），会先尝试从 stdout 中按字符串边界提取第一个完整 JSON 再解析，减少因前后缀导致的解析失败。
- **治本**：需在 OpenClaw 核心侧保证：出错时不要将原始 `JSON.parse` 异常直接作为回复内容；或对「可能含前后缀」的字符串先提取再解析。

### 回复出现「53 validation errors」「Field required 'function'」等 API 校验错误

- **原因**：调用模型 API 时，请求体里的 `tools` 格式与当前提供商要求不一致。例如核心按 OpenAI 风格发送（`name` / `description` / `input_schema`），而部分接口（如某些 Kimi/Anthropic 系）要求每项为 `{ type: "function", function: { name, description, input_schema } }`，缺少 `function` 字段会报错。
- **本插件**：只负责向核心注册工具（name、description、parameters），不参与构建发往模型 API 的请求体，无法在此修正格式。
- **治本**：升级 OpenClaw 到已适配该提供商 tools 格式的版本，或暂时换用与当前核心格式兼容的模型/提供商；也可在 [OpenClaw 仓库](https://github.com/openclaw/openclaw) 提 issue/PR 说明所用模型与期望的 tools 结构。

## 已知限制

- **工具代发到他人时的会话历史**：通过 `qq_send_message`、`qq_send_group_message` 向某用户或某群发送的消息，在发送成功后会**写入对方/该群会话的 jsonl 历史**（若该会话已存在，即对方或该群曾与 Bot 有过对话）。因此当对方之后与 Bot 对话时，AI 能读到「自己曾给该用户/群发过某条消息」。若对方从未与 Bot 聊过，会话尚未创建，则不会写入，待其首次发消息后新会话中的历史不包含本次代发。

## 近期更新

- **时间与日期**：AI 收到的「当前时间」统一为本地日期与时间（不再用 UTC 日期），主动对话与普通消息均带时区；记忆与笔记中的「今天」也改为本地日期，避免今天/昨天/明天混淆。
- **特殊消息历史**：主动对话、戳一戳、离线文件等合成事件使用唯一 `message_id`，避免在去重窗口内被误判为重复而丢失，保证这些轮次都会进入会话历史。
- **工具代发写入对方会话**：`qq_send_message`、`qq_send_group_message` 发送成功后，若目标用户/群已有会话，会将本次发送内容追加到该会话的 jsonl 历史中，对方后续对话时 AI 可见「曾发过该条」。

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
