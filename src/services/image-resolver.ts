import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { NapCatAPI } from "../napcat/api.js";
import type { BotConfig } from "../config.js";
import type { QQMessage } from "../napcat/types.js";

export class ImageResolver {
  constructor(
    private api: NapCatAPI,
    private config: BotConfig,
  ) {}

  async resolveImagePaths(msg: QQMessage): Promise<string[]> {
    const paths: string[] = [];
    const files = msg.imageFiles ?? msg.imageUrls.map(() => "");
    const fileIds = msg.imageFileIds ?? [];
    const maxSize = this.config.limits.imageMaxSize;
    const tempDir = this.config.paths.imageTemp;

    for (let i = 0; i < msg.imageUrls.length; i++) {
      const url = msg.imageUrls[i];
      const fileParam = files[i] || "";
      const fileId = fileIds[i] ?? "";
      let resolved = false;

      const tryGetImage = async (param: string, useFileId: boolean): Promise<boolean> => {
        if (!param) return false;
        try {
          const result = await this.api.getImage(param, useFileId);
          if (result.status !== "ok" || !result.data) return false;
          const d = result.data as Record<string, unknown>;
          const localPath = d.file ? String(d.file) : "";
          const base64 = d.base64 ? String(d.base64) : "";
          const apiUrl = d.url ? String(d.url) : "";
          if (localPath && path.isAbsolute(localPath) && fs.existsSync(localPath)) {
            paths.push(localPath);
            return true;
          }
          if (base64) {
            const buf = Buffer.from(base64, "base64");
            if (buf.length <= maxSize) {
              fs.mkdirSync(tempDir, { recursive: true });
              const ext = (d.type as string) === "image/png" ? ".png" : ".jpg";
              const outPath = path.join(tempDir, `${crypto.randomUUID()}${ext}`);
              fs.writeFileSync(outPath, buf);
              paths.push(outPath);
              return true;
            }
          }
          if (apiUrl && (apiUrl.startsWith("http://") || apiUrl.startsWith("https://"))) {
            const resp = await fetch(apiUrl, {
              signal: AbortSignal.timeout(this.config.network.imageFetchTimeoutMs),
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            });
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              if (buf.length > 0 && buf.length <= maxSize) {
                fs.mkdirSync(tempDir, { recursive: true });
                const outPath = path.join(tempDir, `${crypto.randomUUID()}.jpg`);
                fs.writeFileSync(outPath, buf);
                paths.push(outPath);
                return true;
              }
            }
          }
        } catch { /* ignore */ }
        return false;
      };

      // 先试 file，再试 file_id（与 OpenClaw 原 onebot 做法一致，兼容 NapCat 多种上报）
      if (fileParam) resolved = await tryGetImage(fileParam, false);
      if (!resolved && fileId) resolved = await tryGetImage(fileId, true);

      // 若 get_image 未返回可用数据，且消息里带 http(s) url（如部分实现直接上报 url），则直接拉取
      if (!resolved && url && (url.startsWith("http://") || url.startsWith("https://"))) {
        try {
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(this.config.network.imageFetchTimeoutMs),
            headers: {
              Referer: "https://qzone.qq.com/",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length > 0 && buf.length <= maxSize) {
              fs.mkdirSync(tempDir, { recursive: true });
              const outPath = path.join(tempDir, `${crypto.randomUUID()}.jpg`);
              fs.writeFileSync(outPath, buf);
              paths.push(outPath);
            }
          }
        } catch { /* ignore */ }
      }
    }
    return paths;
  }
}
