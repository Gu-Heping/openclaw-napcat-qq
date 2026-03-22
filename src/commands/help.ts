import type { Command, CommandContext } from "./types.js";
import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";

/** 仅 `/帮助`：避免与核心 `/help` 抢名；群聊未 @ 时仍可查看合并说明。 */
export const qqHelpZhCommand: Command = {
  names: ["帮助"],
  description: "QQ 合并指令说明（中文）",
  execute(msg: QQMessage, _args: string, _ctx: CommandContext): string {
    const mention = msg.messageType === "group" ? "（群聊需 @我 才会触发核心指令与 AI 回复）" : "";
    return t.helpText(mention);
  },
};

export const pingCommand: Command = {
  names: ["ping"],
  description: "测试连通性",
  execute(): string {
    return "pong";
  },
};
