# openclaw-napcat-qq

OpenClaw 渠道插件：用 NapCat（OneBot v11）接 QQ，支持私聊/群聊、Agent 对话、群管与文件收发。

**与 NapCat 的分工**：QQ 协议、消息与图片收发由 **NapCat** 完成；**表情包 / 梗图库**（`sticker_search`、`sticker_send`、`sticker_collect` 等 Agent 工具及本地库存）由 **本插件在 OpenClaw 侧实现**，数据默认在 workspace 的 `qq_files/stickers/`（`index.json` 或可选 SQLite），不是 NapCat 内置功能。

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
- **表情包 / 梗图库（QQ）**：Agent 可检索、发送、收藏梗图；支持入站白名单 CDN 链拉取收藏、可选 SQLite 存储与 FTS 检索模式；与正文 `[表情:名称]`、emoji 的优先级可在提示词中配置（见 `locale/zh.ts`、`identity.ts`）。

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

## 建议以非 root 运行

OpenClaw / Gateway 建议在**普通用户**下运行，不要用 root，以便与后续部署方式一致。

- 将插件与 OpenClaw 状态目录放在该用户下，例如 `~/.openclaw`、`~/.openclaw/extensions/napcat-qq`（`~` 为该用户 HOME）。
- `openclaw.json` 里 `plugins.load.paths` 指向该用户下的插件绝对路径。
- 若使用 Docker NapCat，宿主机「收文件目录」也建议落在该用户可写路径下（见下节），并设置 `NAPCAT_RECEIVED_FILE_HOST_PATH` 为该路径，这样看图时的容器路径映射才能正确生效。

## Docker NapCat 与看图要点

当 NapCat 以 **Docker** 方式部署、Gateway 跑在**宿主机**时，用户发图需满足以下设置，Agent 才能正确看图并回复。

### 1. OneBot 消息格式

NapCat 的 OneBot 配置里必须使用 **array** 格式上报消息，否则图片等多媒体无法按 segment 解析：

- 在挂载给 NapCat 的配置目录中（例如 `napcat_onebot_config/onebot11.json`），对 **httpServers** 和 **websocketServers** 的每个 server 设置：
  - `"messagePostFormat": "array"`
- 若为 `string` 或未设置，图片会以 CQ 码字符串上报，本插件无法解析出图片段，看图会失败。

### 2. 收文件目录与容器路径映射

NapCat 容器内 QQ 收文件通常落在 `/app/.config/QQ`（或 `/root/.config/QQ`）。`get_image` 返回的 `d.file` 是**容器内路径**，宿主机上的 Gateway 无法直接访问。

- **docker-compose** 需把宿主机某目录挂载为容器内 `/app/.config/QQ`，例如：
  - `volumes: ["${NAPCAT_RECEIVED_FILE_HOST_PATH}:/app/.config/QQ"]`
- **宿主机环境变量**：Gateway 进程所在环境需能读到 **`NAPCAT_RECEIVED_FILE_HOST_PATH`**，且值为上述宿主机目录的**绝对路径**（与 docker-compose 左侧一致）。本插件会用该变量把 `get_image` 返回的容器路径映射成宿主机路径再读图。
- **未设置时的回退**：若未设置 `NAPCAT_RECEIVED_FILE_HOST_PATH`，插件会使用 `paths.workspace/qq_files/napcat_config` 作为宿主机目录。因此若用非 root 用户运行，建议把收文件目录放在该用户的 workspace 下，或在启动 Gateway 前导出 `NAPCAT_RECEIVED_FILE_HOST_PATH`（例如在 systemd 的 `Environment=` 或启动脚本里 `export`）。

### 3. 看图解析顺序

插件会依次尝试：`get_image` 的 **file_id** → **file**（含 URL）→ 消息中的图片 URL 直链拉取。NapCat 支持 `file_id` 时优先用 file_id 获取 base64；若返回 `d.file` 为容器路径，则按上一条做宿主机路径映射后再读文件。

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
| **stickers** | object | 表情包库：`enabled`、`inboundAutoCollect`、`storageBackend`（`json` \| `sqlite`）、`searchMode`（`heuristic` \| `fts`，仅 SQLite）等 | 见 `config.ts` 中 `StickerConfig` |

- **Docker 看图**：宿主机需设置环境变量 `NAPCAT_RECEIVED_FILE_HOST_PATH`（与 docker 挂载的宿主机路径一致），否则见上文「Docker NapCat 与看图要点」。

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
- **QQ 空间**（需 NapCat 接 [onebot-qzone](https://github.com/Gu-Heping/onebot-qzone) 桥接；**参数与路由以各工具 `description` 为准**）：
  - **说说时间线**：`qzone_get_posts`（feeds3 / `get_emotion_list`；**支持 `cursor` + `offset` 分页**，见返回 `_meta.next_call`）
  - **本人混合动态（ic2）**：`qzone_get_space_html_act_feed`、`qzone_get_user_act_feed`（`start/count`，与说说翻页勿混用）
  - **好友混排**：`qzone_get_friend_feeds`（**cursor** 游标）
  - **评论 / 赞 / 转发 / 详情**：`qzone_get_comments`、`qzone_comment`、`qzone_delete_comment`、`qzone_like`、`qzone_unlike`、`qzone_get_likes`、`qzone_forward`、`qzone_get_post_detail`、`qzone_get_post_images`、`qzone_get_traffic`
  - **发删说说 / 相册等**：`qzone_publish`、`qzone_delete`、`qzone_get_albums`、`qzone_get_photos`、`qzone_upload_image`、`qzone_fetch_image`（评论图完整 URL + 落盘）、`qzone_emoji_list` …
  - **运维**：`qzone_status`、`qzone_version`、`qzone_probe_routes`；其它见 `src/tools/qzone.ts` 注册表。
- **表情包 / 梗图库**：`sticker_search`（检索，返回 rank/score）、`sticker_send`（发库内图）、`sticker_collect`（收藏；支持本地路径或 QQ 官方 CDN https，按文件内容去重）、`sticker_get_semantics` / `sticker_update_semantics` / `sticker_alias_add`。配置见 `plugins.entries["napcat-qq"].stickers`（`storageBackend`、`searchMode` 等，见 `config.ts` / `openclaw.plugin.json`）。

工具参数与说明见 **src/tools/** 下各文件的 `name`、`description` 与 `parameters`。

### QQ 空间说说图片与识图

`qzone_get_friend_feeds`、`qzone_get_posts` 在桥接返回带 base64 的图片时，会将图片**写入临时文件**（与聊天看图一致，使用 `paths.imageTemp`），在工具结果中只返回**本地路径**及「可用 image 工具分析」说明，不把长 base64 嵌在文本里。用户或 Agent 要求「分析这张图」「图像识别」时，用 **image** 工具的 **image** 参数传入该路径即可识图。若桥接未返回 base64（如未开 `include_image_data` 或 CDN 拉图 502），则仅返回图片 URL 行。

### QQ 空间与工作区约定（feeds / posts）

与 onebot-qzone 及 OpenClaw 工作区配合时，建议遵守：**今日是否已发** 只看 `memory/qzone/feeds/{今日日期}.md`（`[发布]` 或 `[状态]`）；**动态内容/灵感** 用 `qzone_get_friend_feeds` 当次结果或读 `memory/qzone/posts/`，**不**把 get_friend_feeds 结果写回 feeds。详见 [onebot-qzone README](https://github.com/Gu-Heping/onebot-qzone#openclaw-工作区约定feeds--posts-分工) 与工作区内 `QZONE.md`、`memory/qzone/README.md`。

## 故障排查（根因与应对）

### 回复出现「Unexpected non-whitespace character after JSON at position …」

- **原因**：OpenClaw 核心或模型在解析某段内容（如模型输出、工具结果）时执行了 `JSON.parse`，输入不是合法 JSON（例如带前缀/后缀、被截断），异常文案被当作回复内容下发。
- **本插件已做**：发送前若检测到该类文案会替换为「回复解析异常，请再发一句试试。」；若使用 legacy 入口（`index.js`），会先尝试从 stdout 中按字符串边界提取第一个完整 JSON 再解析，减少因前后缀导致的解析失败。
- **治本**：需在 OpenClaw 核心侧保证：出错时不要将原始 `JSON.parse` 异常直接作为回复内容；或对「可能含前后缀」的字符串先提取再解析。

### 用户发图后 Bot 只回复 [qqimg] 链接、无法看图

- **原因**：图片未解析成宿主机可读路径，Agent 只收到 URL 文本或 MediaUrls，未收到 MediaPaths。
- **检查**：NapCat 为 Docker 时，确认（1）OneBot 配置中 `messagePostFormat` 为 `"array"`；（2）宿主机环境变量 `NAPCAT_RECEIVED_FILE_HOST_PATH` 已设置且与 docker-compose 中挂载的宿主机路径一致；（3）Gateway 以能访问该目录的用户运行（建议非 root，见上文「建议以非 root 运行」）。
- **详见**：上文「Docker NapCat 与看图要点」。

### 回复出现「53 validation errors」「Field required 'function'」等 API 校验错误

- **原因**：调用模型 API 时，请求体里的 `tools` 格式与当前提供商要求不一致。例如核心按 OpenAI 风格发送（`name` / `description` / `input_schema`），而部分接口（如某些 Kimi/Anthropic 系）要求每项为 `{ type: "function", function: { name, description, input_schema } }`，缺少 `function` 字段会报错。
- **本插件**：只负责向核心注册工具（name、description、parameters），不参与构建发往模型 API 的请求体，无法在此修正格式。
- **治本**：升级 OpenClaw 到已适配该提供商 tools 格式的版本，或暂时换用与当前核心格式兼容的模型/提供商；也可在 [OpenClaw 仓库](https://github.com/openclaw/openclaw) 提 issue/PR 说明所用模型与期望的 tools 结构。

## 已知限制

- **工具代发到他人时的会话历史**：通过 `qq_send_message`、`qq_send_group_message` 向某用户或某群发送的消息，在发送成功后会**写入对方/该群会话的 jsonl 历史**（若该会话已存在，即对方或该群曾与 Bot 有过对话）。因此当对方之后与 Bot 对话时，AI 能读到「自己曾给该用户/群发过某条消息」。若对方从未与 Bot 聊过，会话尚未创建，则不会写入，待其首次发消息后新会话中的历史不包含本次代发。

## 近期更新

- **表情包库**：检索打分与 `useWhen` 等字段、可选 SQLite + FTS5、收藏按内容去重（重复时明确提示「库内已有相同图片」且不新建记录）、`sticker_search` 结果带 rank/score 与最佳候选摘要。
- **时间与日期**：AI 收到的「当前时间」统一为本地日期与时间（不再用 UTC 日期），主动对话与普通消息均带时区；记忆与笔记中的「今天」也改为本地日期，避免今天/昨天/明天混淆。
- **特殊消息历史**：主动对话、戳一戳、离线文件等合成事件使用唯一 `message_id`，避免在去重窗口内被误判为重复而丢失，保证这些轮次都会进入会话历史。
- **工具代发写入对方会话**：`qq_send_message`、`qq_send_group_message` 发送成功后，若目标用户/群已有会话，会将本次发送内容追加到该会话的 jsonl 历史中，对方后续对话时 AI 可见「曾发过该条」。

## 依赖

- [NapCat](https://github.com/NapNeko/NapCat)（OneBot v11，Docker 或本地部署，需提供 HTTP + WS）。
- OpenClaw（Gateway 加载本插件；会话、回复、路由、记忆由 OpenClaw 提供）。
- Node.js 18+，依赖仅 **ws**（见 package.json）。

## 入口与构建（统一为 TS 单一路径）

- **唯一入口**：根目录 **index.ts**（在 `package.json` 的 `openclaw.extensions` 中声明），再导出 **dist/index.js**。
- **源码**：**src/** 下 TypeScript；**构建产出**：**dist/**。安装依赖后需执行 `npm run build`，Gateway 才会正确加载。
- **已弃用**：根目录曾有的纯 JS 实现（index.js、client.js、websocket.js）已移至 **legacy/**，仅作参考，插件不再使用。

## 开发

```bash
npm install
npm run build   # 必须执行，否则 dist/ 为空则加载失败
```

构建产物在 **dist/**，入口为 **index.ts → dist/index.js**；插件通过 `openclaw.plugin.json` 的 `openclaw.extensions` 暴露。

## License

MIT
