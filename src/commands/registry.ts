import type { QQMessage } from "../napcat/types.js";
import type { Command, CommandContext } from "./types.js";

export class CommandRegistry {
  private commands: Command[] = [];
  private nameIndex = new Map<string, Command>();

  register(command: Command): void {
    this.commands.push(command);
    for (const name of command.names) {
      this.nameIndex.set(name.toLowerCase(), command);
    }
  }

  registerAll(commands: Command[]): void {
    for (const cmd of commands) this.register(cmd);
  }

  execute(msg: QQMessage, ctx: CommandContext): string | Promise<string> | null {
    const text = msg.content.trim();
    if (!text.startsWith("/")) return null;

    const parts = text.slice(1).split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = text.slice(1 + parts[0].length).trim();

    const cmd = this.nameIndex.get(name);
    if (!cmd) return null;

    return cmd.execute(msg, args, ctx);
  }
}
