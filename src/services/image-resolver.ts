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
    const maxSize = this.config.limits.imageMaxSize;
    const tempDir = this.config.paths.imageTemp;

    for (let i = 0; i < msg.imageUrls.length; i++) {
      const url = msg.imageUrls[i];
      const fileParam = files[i] || url;
      let resolved = false;

      if (fileParam) {
        try {
          const result = await this.api.getImage(fileParam);
          if (result.status === "ok" && result.data) {
            const d = result.data as Record<string, unknown>;
            const localPath = d.file ? String(d.file) : "";
            const base64 = d.base64 ? String(d.base64) : "";
            if (localPath && path.isAbsolute(localPath) && fs.existsSync(localPath)) {
              paths.push(localPath);
              resolved = true;
            } else if (base64) {
              const buf = Buffer.from(base64, "base64");
              if (buf.length <= maxSize) {
                fs.mkdirSync(tempDir, { recursive: true });
                const ext = (d.type as string) === "image/png" ? ".png" : ".jpg";
                const outPath = path.join(tempDir, `${crypto.randomUUID()}${ext}`);
                fs.writeFileSync(outPath, buf);
                paths.push(outPath);
                resolved = true;
              }
            }
          }
        } catch { /* ignore */ }
      }

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
