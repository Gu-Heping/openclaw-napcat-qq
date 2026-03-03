import { NTQQ_FACE_MAP, findFaceId } from "../napcat/face-map.js";

/**
 * Convert plain @QQ号 / @all in text to OneBot CQ codes.
 */
export function convertPlainAtToCq(message: string): string {
  if (!message || message.includes("[CQ:at,")) return message;
  message = message.replace(/@all\b/gi, "[CQ:at,qq=all]");
  message = message.replace(/@(\d+)/g, "[CQ:at,qq=$1]");
  return message;
}

type Segment = { type: string; data: Record<string, string> };

/**
 * Expand inline [表情:名称] placeholders into QQ face segments.
 * Returns original string if no faces found, otherwise returns segment array.
 */
export function expandInlineFaces(text: string): string | Segment[] {
  if (!text || !text.includes("[表情:")) return text;

  const pattern = /\[表情:([^\]]+)\]/g;
  const segments: Segment[] = [];
  let lastEnd = 0;
  let hadFace = false;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastEnd) {
      const seg = text.slice(lastEnd, match.index);
      if (seg) segments.push({ type: "text", data: { text: seg } });
    }
    const name = match[1].trim();
    const faceId = findFaceId(name);
    if (faceId != null) {
      segments.push({ type: "face", data: { id: faceId } });
      hadFace = true;
    } else {
      segments.push({ type: "text", data: { text: match[0] } });
    }
    lastEnd = match.index + match[0].length;
  }

  if (!hadFace) return text;
  if (lastEnd < text.length) {
    segments.push({ type: "text", data: { text: text.slice(lastEnd) } });
  }
  return segments;
}
