export const zh = {
  unconfigured: "缺少 selfId（Bot QQ 号）",

  // Error messages sent to user
  errorGeneric: "抱歉，这次没能生成回复，请稍后再试或换一种说法。",
  errorContextLength: "对话太长了，我先整理一下记忆。试试发 /clear 清空对话。",
  errorRateLimit: "请求太频繁了，请等几秒再试。",
  errorTimeout: "回复超时了，请稍后再试。",

  // Group message prefix
  groupMessagePrefix: "[群消息] 需回复则回复，否则回复 [无需回复]。\n\n",

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
    nickname: string;
    userCtx: string;
    minutesSince: number;
  }) =>
    `当前时间：${params.timeStr}（${params.dateStr} 星期${params.weekdayCn}）。是否在免打扰时段（22:00–07:00）：${params.quietNote}

关于这位用户：
${params.nickname ? `【称呼】可称 TA「${params.nickname}」。\n\n` : ""}${params.userCtx.slice(0, 800) || "暂无详细记忆"}

【时间信息】
- 用户约 ${params.minutesSince} 分钟前发过消息。

请根据记忆与最近对话，得体地决定是否现在主动发一条消息。
若适合发：只写一条要发送的消息内容（一两句话、约 30 字内）。
若不适合：只回复 [不发]。
禁止在回复中写内心独白、推理过程等，否则会整段发给用户。`,

  // Help text builder
  helpText: (mention: string) =>
    `OpenClaw QQ 助手 · 指令说明

【常用】
/help（/h、/帮助）— 显示本说明
/status（/状态）— 查看运行状态
/ping — 测连通

【模型切换】
/model <别名>（/模型）— 切换当前会话的 AI 模型
  可用别名：kimi · claude · deepseek · minimax · qwen · kimi-or · openrouter
  示例：/model claude → Claude 3.5 Sonnet
/models — 查看提供商列表；/models <provider> — 查看该提供商下的模型

【会话与记忆】
/clear（/new、/清除、/新会话、/reset）— 清空当前 AI 对话上下文
/summary_clear（/总结并清空）— 先总结对话写入记忆，再清空会话
/note 内容（/笔记）— 给当前用户记一条笔记

【消息记录】
/history（/记录）— 查看最近发送的消息
/clear_history（/清除历史）— 清除消息发送记录

【使用说明】
· 私聊：直接发消息即可
· 群聊：需要 @我 或 触发关键词 才会回复${mention}
· 我会记住每个用户的偏好与重要信息`,
} as const;
