import type { Command, CommandContext } from "./types.js";
import type { QQMessage } from "../napcat/types.js";
import { zh as t } from "../locale/zh.js";
import { getLocalDateString } from "../util/date.js";
import { getSenderDisplayName } from "../util/identity.js";

export const noteCommand: Command = {
  names: ["note", "笔记"],
  description: "给当前用户记一条笔记",
  execute(msg: QQMessage, args: string, ctx: CommandContext): string {
    const noteContent = args.trim();
    if (!noteContent) return t.noteUsage;

    try {
      const section = ctx.memoryManager.guessNoteSection(noteContent);
      const now = getLocalDateString();
      const entry = `- [${now}] ${noteContent}`;
      const nickname = getSenderDisplayName(msg);
      ctx.memoryManager.writeUserNote(msg.userId, nickname, section, entry);

      const sectionLabel = section === t.sectionNotes ? "" : `（分类: ${section}）`;
      return t.noteSaved(noteContent, sectionLabel);
    } catch (e) {
      return t.noteFailed(e);
    }
  },
};
