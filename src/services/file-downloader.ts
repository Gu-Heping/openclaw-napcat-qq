import * as fs from "node:fs";
import * as path from "node:path";
import type { BotConfig } from "../config.js";
import type { PluginLogger } from "../types-compat.js";
import type { NapCatAPI } from "../napcat/api.js";

export interface DownloadResult {
  path: string;
  preview?: string;
}

export class FileDownloader {
  private config: BotConfig;
  private log: PluginLogger;

  constructor(config: BotConfig, log: PluginLogger) {
    this.config = config;
    this.log = log;
  }

  resolveContainerPath(rawPath: string, hostPath: string | undefined): string | null {
    if (!hostPath) return null;
    for (const prefix of this.config.paths.containerPrefixes) {
      if (rawPath.startsWith(prefix)) {
        const mapped = path.join(hostPath, rawPath.slice(prefix.length));
        if (fs.existsSync(mapped)) {
          this.log.info?.(`[QQ] Mapped container path: ${rawPath} → ${mapped}`);
          return mapped;
        }
        break;
      }
    }
    if (fs.existsSync(rawPath)) return rawPath;
    return null;
  }

  async downloadToLocal(
    url: string,
    name: string,
    subDir: string,
  ): Promise<DownloadResult | null> {
    const outDir = path.join(this.config.paths.workspace, "qq_files", "incoming", subDir);
    fs.mkdirSync(outDir, { recursive: true });

    const safeName = (name || "unnamed").replace(/[/\\:*?"<>|]/g, "_").slice(0, 100);
    const localPath = path.join(outDir, safeName);

    try {
      if (url.startsWith("base64://")) {
        const b64 = url.slice("base64://".length);
        fs.writeFileSync(localPath, Buffer.from(b64, "base64"));
      } else if (url.startsWith("file://")) {
        const srcPath = url.slice("file://".length);
        fs.copyFileSync(srcPath, localPath);
      } else {
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(this.config.network.fetchTimeoutMs),
        });
        if (!resp.ok) return null;
        const buffer = Buffer.from(await resp.arrayBuffer());
        if (buffer.length > this.config.limits.fileMaxSize) return null;
        fs.writeFileSync(localPath, buffer);
      }

      const stat = fs.statSync(localPath);
      let preview: string | undefined;
      const ext = path.extname(safeName).toLowerCase();
      if (this.config.paths.textExts.includes(ext) && stat.size < 4096) {
        preview = fs.readFileSync(localPath, "utf-8").slice(0, 2000);
      }

      this.log.info?.(`[QQ] Downloaded file ${safeName} to ${localPath} (${stat.size} bytes)`);
      return { path: localPath, preview };
    } catch (e) {
      this.log.warn?.(`[QQ] File download failed for ${name}: ${e}`);
      return null;
    }
  }

  async resolveFileUrl(
    api: NapCatAPI,
    fileId: string | undefined,
    existingUrl: string | undefined,
    fileName: string,
  ): Promise<{ url: string | undefined; name: string }> {
    let url = existingUrl;
    let name = fileName;

    if (!url && fileId) {
      try {
        const info = await api.getFile(fileId);
        if (info.status === "ok" && info.data) {
          const d = info.data as Record<string, unknown>;
          const rawUrl = String(d.url ?? d.file ?? "");
          const rawBase64 = d.base64 ? String(d.base64) : "";
          const hostPath = process.env["NAPCAT_RECEIVED_FILE_HOST_PATH"];

          if (rawUrl.startsWith("http") || rawUrl.startsWith("base64://")) {
            url = rawUrl;
          } else if (rawUrl && hostPath) {
            const mapped = this.resolveContainerPath(rawUrl, hostPath);
            if (mapped) url = `file://${mapped}`;
          } else if (rawUrl && fs.existsSync(rawUrl)) {
            url = `file://${rawUrl}`;
          } else if (rawBase64) {
            url = `base64://${rawBase64}`;
          }

          if (!name || name === "未知文件") {
            name = String(d.file_name ?? d.name ?? name);
          }
          this.log.info?.(`[QQ] getFile result for ${fileId}: url=${url?.slice(0, 60)}`);
        }
      } catch (e) {
        this.log.warn?.(`[QQ] getFile failed for ${fileId}: ${e}`);
      }
    }

    return { url, name };
  }
}
