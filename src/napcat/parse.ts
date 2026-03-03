import type { OneBotMessageEvent, QQMessage, QQFileInfo, MessageSegment } from "./types.js";
import { getFaceName, TEXT_LIKE_FACE_NAMES } from "./face-map.js";

/**
 * Parse a OneBot message event into a QQMessage.
 * Handles text, at, face, marketface, mface, image, forward, reply, file segments.
 */
export function parseMessageEvent(event: OneBotMessageEvent, botQQ: string): QQMessage {
  const message = event.message;
  let content = "";
  let atBot = false;
  const files: QQFileInfo[] = [];
  const imageUrls: string[] = [];
  const imageFiles: string[] = [];
  const segmentsSeen: Array<{ type: string; value?: string }> = [];

  if (Array.isArray(message)) {
    for (const seg of message as MessageSegment[]) {
      const { type, data } = seg;
      switch (type) {
        case "text": {
          const text = String(data.text ?? "");
          content += text;
          segmentsSeen.push({ type: "text" });
          break;
        }
        case "at": {
          const qq = String(data.qq ?? "");
          if (qq === botQQ || qq === "all") atBot = true;
          content += `@${qq} `;
          segmentsSeen.push({ type: "at" });
          break;
        }
        case "face": {
          const faceId = String(data.id ?? "");
          const faceName = getFaceName(faceId);
          content += `[表情:${faceName}]`;
          segmentsSeen.push({ type: "face", value: faceName });
          break;
        }
        case "marketface": {
          content += `[大表情:${data.name ?? ""}]`;
          segmentsSeen.push({ type: "marketface" });
          break;
        }
        case "mface": {
          const name = data.name || data.id || "";
          content += `[收藏表情:${name}]`;
          segmentsSeen.push({ type: "mface" });
          break;
        }
        case "image": {
          const url = String(data.url ?? data.file ?? "");
          const fileParam = String(data.file ?? data.filename ?? "");
          content += `[图片:${url}]`;
          imageUrls.push(url || fileParam);
          imageFiles.push(fileParam || url);
          segmentsSeen.push({ type: "image" });
          break;
        }
        case "forward": {
          content += `[转发消息:${data.id ?? ""}]`;
          segmentsSeen.push({ type: "forward" });
          break;
        }
        case "reply": {
          content += `[回复消息:${data.id ?? ""}]`;
          segmentsSeen.push({ type: "reply" });
          break;
        }
        case "file": {
          const fileName = String(data.name ?? data.file_name ?? data.fileName ?? data.file ?? "未知文件");
          const fileSize = Number(data.size ?? data.file_size ?? data.fileSize ?? 0);
          const fileUrl = String(data.url ?? data.file_url ?? data.fileUrl ?? "");
          const fileId = String(data.file_id ?? data.fileId ?? data.file ?? data.id ?? "");
          files.push({ name: fileName, size: fileSize, url: fileUrl, fileId });
          let sizeStr = "";
          if (fileSize > 0) {
            if (fileSize < 1024) sizeStr = `, ${fileSize}B`;
            else if (fileSize < 1024 * 1024) sizeStr = `, ${(fileSize / 1024).toFixed(1)}KB`;
            else sizeStr = `, ${(fileSize / (1024 * 1024)).toFixed(1)}MB`;
          }
          content += `[文件:${fileName}${sizeStr}]`;
          segmentsSeen.push({ type: "file" });
          break;
        }
        default: {
          const dataStr = JSON.stringify(data ?? {}).slice(0, 120);
          content += `[${type ?? "unknown"}:${dataStr}]`;
          segmentsSeen.push({ type: type || "other" });
          break;
        }
      }
    }

    // Single text-like face → render as plain text to avoid AI treating it as emoji
    if (
      segmentsSeen.length === 1 &&
      segmentsSeen[0].type === "face" &&
      segmentsSeen[0].value &&
      TEXT_LIKE_FACE_NAMES.has(segmentsSeen[0].value)
    ) {
      content = segmentsSeen[0].value;
    }
  } else {
    content = String(message);
  }

  return {
    id: String(event.message_id),
    userId: String(event.user_id),
    content: content.trim(),
    messageType: event.message_type,
    groupId: event.group_id ? String(event.group_id) : undefined,
    rawMessage: event.raw_message ?? "",
    timestamp: event.time,
    sender: event.sender,
    atBot,
    files,
    imageUrls,
    imageFiles,
  };
}
