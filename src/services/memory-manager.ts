import * as fs from "node:fs";
import * as path from "node:path";
import type { BotConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";
import { zh as t } from "../locale/zh.js";

export class MemoryManager {
  private workspace: string;
  private log: PluginLogger;
  private groupRecentSpeakers = new Map<string, { userId: string; nickname: string; time: number }>();

  constructor(config: BotConfig, log: PluginLogger) {
    this.workspace = config.paths.workspace;
    this.log = log;
  }

  guessNoteSection(text: string): string {
    if (/喜欢|爱好|兴趣|追|粉|推/.test(text)) return t.sectionInterests;
    if (/生日|纪念|约定|事件|工作|学校|专业|大学|待办|记得|毕业/.test(text)) return t.sectionEvents;
    if (/说话|风格|习惯|称呼|口头禅|语气/.test(text)) return t.sectionChatStyle;
    return t.sectionNotes;
  }

  autoUpdateContextMemory(
    userId: string,
    nickname: string,
    groupId: string | undefined,
  ): void {
    try {
      this.ensureUserMemory(userId, nickname);
      this.incrementConversationCount(userId);
      if (groupId) this.updateGroupMemory(groupId, userId, nickname);
      this.updateSocialActivity(userId, groupId, nickname);
    } catch (e) {
      this.log.warn?.(`[QQ] auto context memory error: ${e}`);
    }
  }

  ensureUserMemory(userId: string, nickname: string): void {
    const filePath = path.join(this.workspace, "memory", "users", `${userId}.md`);
    if (fs.existsSync(filePath)) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, t.memoryUserTemplate(nickname, userId));
  }

  readUserMemory(userId: string): string {
    const filePath = path.join(this.workspace, "memory", "users", `${userId}.md`);
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  writeUserNote(userId: string, nickname: string, section: string, entry: string): void {
    const filePath = path.join(this.workspace, "memory", "users", `${userId}.md`);
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, t.memoryUserTemplate(nickname, userId));
    }
    let content = fs.readFileSync(filePath, "utf-8");
    const header = `## ${section}`;
    const idx = content.indexOf(header);
    if (idx !== -1) {
      const insertAt = content.indexOf("\n", idx) + 1;
      content = content.slice(0, insertAt) + entry + "\n" + content.slice(insertAt);
    } else {
      content += `\n${header}\n${entry}\n`;
    }
    fs.writeFileSync(filePath, content);
  }

  getUserNickname(userId: string): string {
    const ctx = this.readUserMemory(userId);
    if (!ctx) return "";
    for (const line of ctx.split("\n").slice(0, 20)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ") && trimmed.includes("（")) {
        return trimmed.replace("# ", "").split("（")[0].trim();
      }
      if (trimmed.includes("昵称") && (trimmed.includes("：") || trimmed.includes(":"))) {
        const sep = trimmed.includes("：") ? "：" : ":";
        return trimmed.split(sep, 2)[1]?.trim() ?? "";
      }
    }
    return "";
  }

  listUserIds(): string[] {
    const dir = path.join(this.workspace, "memory", "users");
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith(".md") && f !== "index.md")
        .map((f) => f.replace(".md", ""))
        .filter((uid) => /^\d+$/.test(uid));
    } catch {
      return [];
    }
  }

  private incrementConversationCount(userId: string): void {
    const filePath = path.join(this.workspace, "memory", "users", `${userId}.md`);
    if (!fs.existsSync(filePath)) return;
    try {
      let content = fs.readFileSync(filePath, "utf-8");
      const match = content.match(/- 对话次数: (\d+)/);
      if (match) {
        const count = parseInt(match[1], 10) + 1;
        content = content.replace(/- 对话次数: \d+/, `- 对话次数: ${count}`);
      } else {
        const statsHeader = "## 统计";
        if (content.includes(statsHeader)) {
          const idx = content.indexOf(statsHeader);
          const insertAt = content.indexOf("\n", idx) + 1;
          content = content.slice(0, insertAt) + "- 对话次数: 1\n" + content.slice(insertAt);
        } else {
          content += "\n## 统计\n- 对话次数: 1\n";
        }
      }
      fs.writeFileSync(filePath, content);
    } catch { /* ignore */ }
  }

  private updateGroupMemory(groupId: string, userId: string, nickname: string): void {
    const filePath = path.join(this.workspace, "memory", "groups", `${groupId}.md`);
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, t.memoryGroupTemplate(groupId));
    }
    try {
      let content = fs.readFileSync(filePath, "utf-8");
      const today = new Date().toISOString().slice(0, 10);
      const memberLine = `- ${nickname}(${userId}) 最近活跃: ${today}`;
      const memberRe = new RegExp(`^- .+\\(${userId}\\) 最近活跃:.+$`, "m");

      if (memberRe.test(content)) {
        content = content.replace(memberRe, memberLine);
      } else {
        const header = "## 活跃成员";
        const idx = content.indexOf(header);
        if (idx !== -1) {
          const insertAt = content.indexOf("\n", idx) + 1;
          const placeholder = "（机器人入群后自动记录）";
          if (content.includes(placeholder)) {
            content = content.replace(placeholder, memberLine);
          } else {
            content = content.slice(0, insertAt) + memberLine + "\n" + content.slice(insertAt);
          }
        }
      }

      const countMatch = content.match(/- 消息统计: (\d+)/);
      if (countMatch) {
        content = content.replace(/- 消息统计: \d+/, `- 消息统计: ${parseInt(countMatch[1], 10) + 1}`);
      }

      fs.writeFileSync(filePath, content);
    } catch { /* ignore */ }
  }

  private updateSocialActivity(userId: string, groupId: string | undefined, nickname: string, contextOverride?: string): void {
    const filePath = path.join(this.workspace, "memory", "social", "interactions.md");
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, t.memorySocialTemplate);
    }
    const relPath = path.join(this.workspace, "memory", "social", "relationships.md");
    if (!fs.existsSync(relPath)) {
      fs.writeFileSync(relPath, t.memoryRelationshipTemplate);
    }

    const context = contextOverride ?? (groupId ? `群${groupId}` : "私聊");
    const now = new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const entry = `- ${now} ${nickname}(${userId}) ${context}`;

    try {
      let content = fs.readFileSync(filePath, "utf-8");
      const sectionHeader = "## 近期活跃";
      const idx = content.indexOf(sectionHeader);
      if (idx === -1) return;

      const headerEnd = content.indexOf("\n", idx) + 1;
      const nextSection = content.indexOf("\n## ", headerEnd);
      const sectionEnd = nextSection === -1 ? content.length : nextSection;
      const sectionBody = content.slice(headerEnd, sectionEnd);

      const lines = sectionBody.split("\n").filter((l) => l.startsWith("- "));
      lines.unshift(entry);
      if (lines.length > 30) lines.length = 30;

      content = content.slice(0, headerEnd) + lines.join("\n") + "\n" + content.slice(sectionEnd);
      fs.writeFileSync(filePath, content);
    } catch { /* ignore */ }

    if (groupId) {
      const prev = this.groupRecentSpeakers.get(groupId);
      if (prev && prev.userId !== userId && Date.now() - prev.time < 300_000) {
        this.updateRelationship(prev.userId, userId, prev.nickname, nickname, `群${groupId}`);
      }
      this.groupRecentSpeakers.set(groupId, { userId, nickname, time: Date.now() });
    }
  }

  updateQzoneMemory(
    type: "comment" | "like" | "post",
    userId: string,
    nickname: string,
    detail: string,
    tid?: string,
  ): void {
    try {
      const feedDir = path.join(this.workspace, "memory", "qzone", "feeds");
      fs.mkdirSync(feedDir, { recursive: true });

      const today = new Date().toISOString().slice(0, 10);
      const feedFile = path.join(feedDir, `${today}.md`);
      const time = new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" });

      const labels: Record<string, string> = { comment: "评论", like: "点赞", post: "动态" };
      const entry = `- ${time} [${labels[type]}] ${nickname || userId}${nickname ? `(${userId})` : ""}: ${detail}${tid ? ` [tid:${tid}]` : ""}`;

      if (fs.existsSync(feedFile)) {
        const content = fs.readFileSync(feedFile, "utf-8");
        const lines = content.split("\n");
        const insertIdx = lines.findIndex((l) => l.startsWith("- "));
        if (insertIdx >= 0) {
          lines.splice(insertIdx, 0, entry);
        } else {
          lines.push(entry);
        }
        if (lines.filter((l) => l.startsWith("- ")).length > 100) {
          const kept = lines.filter((l) => !l.startsWith("- "));
          const items = lines.filter((l) => l.startsWith("- ")).slice(0, 100);
          const headerEnd = kept.findIndex((_, i) => i > 0);
          fs.writeFileSync(feedFile, [...kept.slice(0, headerEnd > 0 ? headerEnd : 1), ...items, ...kept.slice(headerEnd > 0 ? headerEnd : 1)].join("\n"));
        } else {
          fs.writeFileSync(feedFile, lines.join("\n"));
        }
      } else {
        fs.writeFileSync(feedFile, `# QQ空间动态 ${today}\n\n${entry}\n`);
      }

      this.updateSocialActivity(userId, undefined, nickname, `空间·${labels[type]}`);
    } catch (e) {
      this.log.warn?.(`[QQ] qzone memory write error: ${e}`);
    }
  }

  private updateRelationship(uidA: string, uidB: string, nameA: string, nameB: string, context: string): void {
    const relPath = path.join(this.workspace, "memory", "social", "relationships.md");
    if (!fs.existsSync(relPath)) return;
    const today = new Date().toISOString().slice(0, 10);
    const [sortedA, sortedB] = uidA < uidB ? [uidA, uidB] : [uidB, uidA];
    const [dispA, dispB] = uidA < uidB
      ? [`${nameA}(${uidA})`, `${nameB}(${uidB})`]
      : [`${nameB}(${uidB})`, `${nameA}(${uidA})`];
    const header = `## ${dispA} <-> ${dispB}`;

    try {
      let content = fs.readFileSync(relPath, "utf-8");
      const pairRe = new RegExp(`^## .*\\(${sortedA}\\).*<->.*\\(${sortedB}\\)`, "m");
      if (pairRe.test(content)) {
        content = content.replace(/- 最近互动：.+/m, `- 最近互动：${today}`);
        if (context && !content.includes(`- 共同群：${context}`)) {
          content = content.replace(pairRe, (match) => `${match}\n- 共同群：${context}`);
        }
      } else {
        content += `\n${header}\n- 关系：同群好友\n- 共同群：${context}\n- 最近互动：${today}\n`;
      }
      fs.writeFileSync(relPath, content);
    } catch { /* ignore */ }
  }
}
