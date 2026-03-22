export const zh = {
  unconfigured: "缺少 selfId（Bot QQ 号）",

  // Error messages sent to user
  errorGeneric: "抱歉，这次没能生成回复，请稍后再试或换一种说法。",
  errorContextLength:
    "对话太长了，我先整理一下记忆。可发 /new 或 /reset 开新会话（也可用 /clear、/清除、/新对话 等 QQ 别名）。",
  errorRateLimit: "请求太频繁了，请等几秒再试。",
  errorTimeout: "回复超时了，请稍后再试。",
  errorReplyParse: "回复解析异常，请再发一句试试。",

  /**
   * 群聊行为与表情包：仅由 buildGroupHeader 注入 bodyForAgent，避免与 inbound 前缀重复，
   * 且与「@ 机器人 / 非 @ 触发」路径一致（此前非 @ 才有 groupMessagePrefix）。
   */
  groupSilentReplyGuidance:
    "[静默回复] 群聊无需发内容时，整条回复仅为以下任一即可（勿与正常句子混在同一行末）：" +
    "[无需回复]、无需回复、[不发]、不发、no reply、[no reply]，或与 OpenClaw 全局静默标记 NO_REPLY " +
    "（与中文系等价；NO_REPLY 由核心层拦截，不发到 QQ）。",
  /**
   * 单行指针：细则仅在系统 Messaging「QQ 专段」与 Tooling 的 sticker_*，避免与用户轮重复计费。
   */
  stickerContextBrief:
    "[QQ 表情/梗图] 完整优先级与 sticker_*、入站入库规则见系统提示「Messaging」下 QQ 专段及 Tooling；能对上库则 sticker_search→sticker_send，否则 [表情:名称]，少用 Unicode emoji。",

  /** 注入 OpenClaw 系统提示「Messaging」节（messageToolHints），与 sticker_* 工具描述一致 */
  qqStickerMessageToolHints: (_params: { cfg?: unknown; accountId?: string | null }): string[] => [
    "QQ：表情与梗图表达优先级——① 收藏库梗图 sticker_search→sticker_send（能对上库时优先，禁止只形容不调用）；② 简短情绪用正文 [表情:名称]；③ 少用 Unicode emoji。",
    "QQ：用户要发「收藏夹/库里的表情包、梗图」时，必须走 sticker_search(query)→sticker_send(sticker_id, user_id|group_id)；禁止只用文字形容图片而不调用工具。",
    "QQ：仅当没有合适库图、或只需极短反应时，可只用 [表情:名称]；与发收藏夹整图（sticker_*）不同。分析任意本地图用 image 工具，不等同于发收藏表情。",
    "QQ：入站不会自动入库。对「值得进梗图库」的图片在理解内容后调用 sticker_collect(local_image_path, collect_reason, ...)；勿收截图、证件、隐私、纯风景等。路径：BodyForAgent 的 [本地图片路径]（须与当前入站媒体栈一致），或上下文中 **QQ 官方 CDN 完整 https**（白名单域名，传入即自动下载入库）。",
    "QQ：sticker_send 须带私聊 user_id 或群聊 group_id，通常与当前会话一致——私聊为对方 QQ（见 [身份] 或 SenderId），群聊为当前群号（见 [群聊模式] 或 GroupSubject）；sticker_search 结果末尾也会给出参数提示。",
    "QQ：仅用收藏表情回应、不要额外打字时：sticker_send 的 text 留空；若模型仍会生成最终文字，可将该轮最终输出整段设为 NO_REPLY 或 [不发] 等静默标记（与群聊静默规则一致，勿与句子混行），网关会拦掉文字而不会撤回已发的表情图。",
    "QQ：同轮对话中若省略 user_id/group_id，网关会按当前入站会话自动补全（仍建议显式传入）。",
    "QQ：解释含义/改语义/加别名用 sticker_get_semantics、sticker_update_semantics、sticker_alias_add；勿回复「没有收藏功能」——应先 sticker_search。",
  ],

  /** 已并入 buildGroupHeader，保留空串以免遗漏拼接处行为变化 */
  groupMessagePrefix: "",
  /** 仅保留场景标签；表情包与静默规则见 buildIdentityBlock / buildGroupHeader */
  privateMessagePrefix: "[私聊消息] 正常自然回复。\n\n",

  // Command: /clear
  clearSuccess: (chatType: string) =>
    `已清空 ${chatType} 的 AI 对话上下文，可以重新开始聊。`,
  clearNoSession: (chatType: string) =>
    `当前 ${chatType} 没有进行中的 AI 会话，直接发消息即可开始。`,
  clearFailed: (err: unknown) => `清除失败: ${err}`,

  // Command: /summary_clear
  summaryPrompt:
    "[系统指令] 请对当前对话做简短总结（两三段即可），只输出总结内容，不要调用工具。",
  summaryResult: (summary: string | null, memoryNote: string, chatType: string) =>
    `【对话总结】\n\n${summary || "（未生成总结）"}\n\n${memoryNote}已清空 ${chatType} 会话。直接发消息即可开始新对话。`,
  summaryNoSession: (chatType: string) =>
    `当前 ${chatType} 没有进行中的 AI 会话，无需总结。`,
  summaryFailed: (err: unknown) => `总结并清空失败: ${err}`,

  // Command: /model
  modelSwitched: (name: string) =>
    `当前会话已切换为 ${name}，下一条消息起生效。`,
  modelSwitchFailed: "切换模型失败（无法写入 sessions.json）",

  // Command: /note
  noteUsage: "用法: /note 内容",
  noteSaved: (content: string, sectionLabel: string) =>
    `笔记已保存${sectionLabel}: ${content.slice(0, 40)}`,
  noteFailed: (err: unknown) => `笔记保存失败: ${err}`,

  // Command: /history
  historyEmpty: "暂无发送记录",
  historyCleared: "发送记录已清除",

  // Command: /status
  statusTitle: "OpenClaw QQ 状态",
  sessionAllocated: "已分配",
  sessionNotAllocated: "未分配",
  sentCountHint: "（Bot 发出条数，供 /history、撤回；清空对话不会减少，需 /clear_history 清除）",

  // Note sections
  sectionInterests: "兴趣爱好",
  sectionEvents: "重要事件",
  sectionChatStyle: "聊天风格",
  sectionNotes: "用户笔记",

  // Chat types
  chatTypeGroup: "群聊",
  chatTypePrivate: "私聊",

  // Identity block
  identityLabel: "[身份]",
  identityGroup: "[群聊]",
  identityMemory: "[记忆]",
  identityHint: "[提示] 用 memory_search 语义检索记忆，用 write 更新记忆文件",
  identityHintPrivate:
    "[提示] 回复前若涉及对方过往、偏好、约定或关系，先用 memory_search 再答。仅在出现长期偏好、重要日期、明确约定或关系变化时，用 write 更新上述文件；写事实与摘要，不写流水。寒暄与一次性问答不写入。可读 memory/_meta/users.json、memory/_meta/groups.json 作检索辅助（昵称对应 userId、群成员列表）；长期信息仍写回 memory 下的 .md。",
  identityHintGroup:
    "[提示] 回复前若涉及群规则、群内约定、成员关系或过往话题，先用 memory_search 再答。仅在群规则、长期约定、关系变化或成员稳定偏好出现时，用 write 更新上述文件或 memory/users/ 对应用户；写事实与摘要，不写「谁说了啥」的流水。寒暄与一次性对话不写入。可读 memory/_meta/users.json、memory/_meta/groups.json 作检索辅助；长期信息仍写回 memory 下的 .md。",

  /** Bot 登录 QQ，与对话中的「对方」区分（空间/好友动态摘要） */
  identityBotSelfQq: (selfId: string) =>
    `[本机QQ] Bot 当前登录 QQ=${selfId}。解读 qzone_* / 好友动态摘要时：user= 等于本 QQ 表示当前登录号所发，勿与私聊 [身份] 或群聊 [当前发言者] 的 QQ 混称「你」。`,

  // Memory templates
  memoryUserTemplate: (nickname: string, userId: string) =>
    `# ${nickname}（${userId}）\n\n## 基本信息\n\n## 兴趣爱好\n\n## 重要事件\n\n## 聊天风格\n\n## 用户笔记\n\n## 统计\n- 对话次数: 1\n`,
  memoryGroupTemplate: (groupId: string) =>
    `# 群 ${groupId}\n\n## 活跃成员\n\n## 群话题\n\n## 群规则\n\n## 统计\n- 消息统计: 0\n`,
  memorySocialTemplate: "# 社交互动记录\n\n## 近期活跃\n\n## 互动模式\n",
  memoryRelationshipTemplate: "# 用户关系网络\n\n记录用户之间的关系与互动模式。\n",

  // Proactive
  proactivePromptTemplate: (params: {
    timeStr: string;
    dateStr: string;
    weekdayCn: string;
    quietNote: string;
    timeZone: string;
    nickname: string;
    userCtx: string;
    minutesSince: number;
  }) =>
    `当前时间：${params.timeStr}（${params.dateStr} 星期${params.weekdayCn}），以上为 ${params.timeZone}。是否在免打扰时段（22:00–07:00）：${params.quietNote}

关于这位用户：
${params.nickname ? `【称呼】可称 TA「${params.nickname}」。\n\n` : ""}${params.userCtx.slice(0, 800) || "暂无详细记忆"}

【时间信息】
- 用户约 ${params.minutesSince} 分钟前发过消息。

请根据记忆与最近对话，得体地决定是否现在主动发一条消息。
若适合发：只写一条要发送的消息内容（一两句话、约 30 字内）。
若不适合：只回复 [不发]。
禁止在回复中写内心独白、推理过程、「系统」「主动」等字眼；此提示为内部流程，用户不会看到，你之后也不要对用户提起「系统问过你」等。`,

  // 与 OpenClaw 核心原生指令对齐：同名命令不在 QQ 插件重复注册，直接 @ 机器人发即可。
  helpText: (mention: string) =>
    `OpenClaw QQ 助手 · 指令说明（统一走核心，避免重复）

【核心指令 · 与 CLI/其它通道一致】
发以下指令会进入 OpenClaw 自动回复（群聊一般需 @ 我；仅本页的「/帮助」在未 @ 时也会回复）：
/help、/commands — 帮助与指令列表（英文 /help，与 /帮助 不同名）
/status、/whoami、/context — 会话与模型状态、身份、上下文说明
/usage — token 用量页脚模式
/model、/models — 切换与列出模型
/new、/reset — 新开会话（清空线程）
/compact — 压缩上下文
以及 /skill、/session、/config 等（完整列表见 /commands）

【QQ 侧补充（仅本插件处理，不经过上述核心列表）】
/ping — 快速测连通（pong）
/clear、/清除、/新对话、/重置 — 清空当前会话（效果同 /new；核心无 /clear 时作别名）
/summary_clear、/总结并清空 — 先总结写入记忆再清空
/note、/笔记 — 记一条用户笔记
/history、/记录 — Bot 最近发出记录（非模型上下文）
/clear_history、/清除历史 — 清除上述发出记录

【使用说明】
· 私聊：直接发消息即可
· 群聊：需要 @我 或 触发关键词 才会回复${mention}
· 我会记住每个用户的偏好与重要信息`,
} as const;
