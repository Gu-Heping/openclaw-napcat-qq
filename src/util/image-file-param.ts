/**
 * 将 mediaUrl 转为 OneBot 图片 segment 可用的 file 参数。
 * NapCat 可能在 Docker 中运行，无法访问宿主机路径，故将本地路径转为 base64。
 */
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_SIZE = 15 * 1024 * 1024; // 15MB，与 limits.imageMaxSize 一致

export function toImageFileParam(
  mediaUrl: string,
  maxSizeBytes: number = MAX_SIZE,
): string {
  const s = (mediaUrl ?? "").trim();
  if (!s) return s;
  // 已是 URL 或 base64，直接返回（NapCat 可请求 URL；base64 可直接用）
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("base64://")) {
    return s;
  }
  // 本地路径：转为 base64，便于 NapCat 在容器内使用
  let absPath = s;
  if (!path.isAbsolute(s)) absPath = path.resolve(s);
  try {
    if (!fs.existsSync(absPath)) return s;
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > maxSizeBytes) return s;
    const b64 = fs.readFileSync(absPath).toString("base64");
    return `base64://${b64}`;
  } catch {
    return s;
  }
}
