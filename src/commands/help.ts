import type { Command, CommandContext } from "./types.js";
import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";

export const helpCommand: Command = {
  names: ["help", "h", "帮助"],
  description: "显示帮助信息",
  execute(msg: QQMessage, _args: string, _ctx: CommandContext): string {
    const mention = msg.messageType === "group" ? "（群聊需 @我 才会回复）" : "";
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
