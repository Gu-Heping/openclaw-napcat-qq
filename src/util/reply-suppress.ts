/**
 * Outbound text that should not be sent to QQ (model "silent" markers).
 * Used by gateway deliver() and MessageSender for command/tool paths.
 */
export function isSuppressedReplyText(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const normalized = text.trim().toLowerCase();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  const hasSuppressedLine = lines.some(
    (line) =>
      line === "[\u65e0\u9700\u56de\u590d]" ||
      line === "\u65e0\u9700\u56de\u590d" ||
      line === "[\u4e0d\u53d1]" ||
      line === "\u4e0d\u53d1" ||
      line === "[no reply]" ||
      line === "no reply",
  );
  return (
    hasSuppressedLine ||
    text.includes("[\u65e0\u9700\u56de\u590d]") ||
    normalized === "[\u65e0\u9700\u56de\u590d]" ||
    normalized === "\u65e0\u9700\u56de\u590d" ||
    normalized === "[\u4e0d\u53d1]" ||
    normalized === "\u4e0d\u53d1" ||
    normalized === "[no reply]" ||
    normalized === "no reply"
  );
}
