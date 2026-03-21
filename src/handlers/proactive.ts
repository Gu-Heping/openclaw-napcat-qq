import type { NapCatAPI } from "../napcat/api.js";
import type { BotConfig } from "../config.js";
import type { PluginLogger, PluginRuntime, OpenClawConfig } from "../types-compat.js";
import type { MemoryManager } from "../services/memory-manager.js";
import { getLocalDateString } from "../util/date.js";
import { zh as t } from "../locale/zh.js";

export interface ProactiveContext {
  api: NapCatAPI;
  config: BotConfig;
  log: PluginLogger;
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  accountId: string;
  memoryManager: MemoryManager;
  dispatchSynthetic: (userId: string, content: string) => Promise<void>;
}

export class ProactiveManager {
  private ctx: ProactiveContext;
  private activeUsers = new Map<string, number>();
  private lastProactiveGlobal = 0;
  private lastProactiveByUser = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstTickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: ProactiveContext) {
    this.ctx = ctx;
    this.loadActiveUsers();
  }

  start(signal: AbortSignal): void {
    if (!this.ctx.config.proactive.enabled) return;

    const pc = this.ctx.config.proactive;
    const tick = () => {
      this.tryProactiveChat().catch((e) => {
        this.ctx.log.warn?.(`[QQ] Proactive error: ${e}`);
      });
    };
    const jitterMax = Math.max(0, pc.initialCheckJitterMaxMs ?? 0);
    const firstDelay = jitterMax > 0 ? Math.floor(Math.random() * (jitterMax + 1)) : 0;
    this.firstTickTimer = setTimeout(() => {
      this.firstTickTimer = null;
      tick();
      this.timer = setInterval(tick, pc.checkIntervalMs);
    }, firstDelay);

    signal.addEventListener("abort", () => {
      if (this.firstTickTimer) clearTimeout(this.firstTickTimer);
      if (this.timer) clearInterval(this.timer);
    }, { once: true });
  }

  recordActivity(userId: string): void {
    this.activeUsers.set(userId, Date.now());
  }

  private loadActiveUsers(): void {
    const userIds = this.ctx.memoryManager.listUserIds();
    for (const uid of userIds) {
      if (!/^[1-9]\d*$/.test(uid)) continue;
      this.activeUsers.set(uid, Date.now() - 3600_000);
    }
    this.ctx.log.info?.(`[QQ] Proactive: loaded ${this.activeUsers.size} users from memory`);
  }

  private async tryProactiveChat(): Promise<void> {
    const now = Date.now();
    const pc = this.ctx.config.proactive;
    if (now - this.lastProactiveGlobal < pc.minGlobalIntervalMs) return;

    const hour = new Date().getHours();
    const inQuietHours = hour >= pc.quietHoursStart || hour < pc.quietHoursEnd;

    type Candidate = { userId: string; lastActive: number; minutesSince: number };
    const candidates: Candidate[] = [];

    for (const [userId, lastActive] of this.activeUsers) {
      if (!/^[1-9]\d*$/.test(userId)) continue;
      if (now - lastActive >= 7200_000) continue;
      const lastProactive = this.lastProactiveByUser.get(userId) ?? 0;
      if (now - lastProactive < pc.perUserIntervalMs) continue;
      if (lastProactive && lastActive <= lastProactive) continue;
      if (now - lastActive < pc.minSinceUserMsgMs) continue;
      candidates.push({ userId, lastActive, minutesSince: Math.floor((now - lastActive) / 60_000) });
    }

    if (!candidates.length) return;

    if (inQuietHours) {
      const hasPending = candidates.some((c) => {
        const ctx = this.ctx.memoryManager.readUserMemory(c.userId);
        return pc.pendingKeywords.some((k) => ctx.includes(k));
      });
      if (!hasPending) return;
    }

    candidates.sort((a, b) => {
      const ctxA = this.ctx.memoryManager.readUserMemory(a.userId);
      const ctxB = this.ctx.memoryManager.readUserMemory(b.userId);
      const pendA = pc.pendingKeywords.some((k) => ctxA.includes(k));
      const pendB = pc.pendingKeywords.some((k) => ctxB.includes(k));
      if (pendA !== pendB) return pendA ? -1 : 1;
      return Math.abs(a.minutesSince - 60) - Math.abs(b.minutesSince - 60);
    });

    const target = candidates[0];
    const nickname = this.ctx.memoryManager.getUserNickname(target.userId);
    const userCtx = this.ctx.memoryManager.readUserMemory(target.userId);

    const nowDate = new Date();
    const weekdayCn = "一二三四五六日"[nowDate.getDay() === 0 ? 6 : nowDate.getDay() - 1];
    const timeStr = nowDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const dateStr = getLocalDateString(nowDate);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Shanghai";
    const quietNote = inQuietHours ? "是（除非有约定/待办提醒，否则倾向不发）" : "否";

    const prompt = t.proactivePromptTemplate({
      timeStr, dateStr, weekdayCn, quietNote, timeZone,
      nickname, userCtx, minutesSince: target.minutesSince,
    });

    this.lastProactiveGlobal = now;
    this.lastProactiveByUser.set(target.userId, now);
    this.ctx.log.info?.(`[QQ] Proactive: sending to ${target.userId} (${nickname || target.userId}, ${target.minutesSince}min since last msg)`);

    const jitterMax = Math.max(0, pc.dispatchJitterMaxMs ?? 0);
    if (jitterMax > 0) {
      const waitMs = Math.floor(Math.random() * (jitterMax + 1));
      await new Promise((r) => setTimeout(r, waitMs));
    }

    try {
      await this.ctx.dispatchSynthetic(target.userId, `[系统提示-主动对话]\n${prompt}`);
    } catch (e) {
      this.ctx.log.warn?.(`[QQ] Proactive dispatch error: ${e}`);
    }
  }
}
