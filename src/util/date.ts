/**
 * Local date/time helpers to avoid UTC vs local confusion (e.g. "today" wrong when server is in UTC).
 * Use these instead of new Date().toISOString().slice(0, 10) for user-facing "today" or agent prompt time.
 */

/**
 * Returns YYYY-MM-DD for the given date in the **local** timezone.
 * Use for "today" in prompts, file names, and memory (e.g. 最近活跃, feed files).
 */
export function getLocalDateString(date: Date = new Date()): string {
  return date.toLocaleDateString("sv-SE"); // "sv-SE" => YYYY-MM-DD in local TZ
}

/**
 * Returns a one-line string for the agent: "当前时间：YYYY-MM-DD HH:mm（时区）".
 * Uses local time and resolved timezone (e.g. Asia/Shanghai) so the model knows today/now correctly.
 */
export function getCurrentTimeBlock(date: Date = new Date()): string {
  const dateStr = getLocalDateString(date);
  const timeStr = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Shanghai";
  return `当前时间：${dateStr} ${timeStr}（${tz}）`;
}
