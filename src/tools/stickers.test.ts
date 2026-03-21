import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../context.js";
import { StickerStore } from "../services/sticker-store.js";
import { createStickerTools } from "./stickers.js";

describe("sticker_collect", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function mkTmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sticker-collect-"));
    tmpDirs.push(d);
    return d;
  }

  it("rejects path outside allowed directories", async () => {
    const root = mkTmp();
    const stickerRoot = path.join(root, "stickers");
    fs.mkdirSync(path.join(stickerRoot, "files"), { recursive: true });
    fs.writeFileSync(path.join(stickerRoot, "index.json"), JSON.stringify({ records: [] }));
    const store = new StickerStore(
      {
        paths: { stickerStore: stickerRoot, workspace: root, imageTemp: path.join(root, "images") },
        stickers: { enabled: true, inboundAutoCollect: false, autoCollectStickerOnly: true, autoCollectFromImage: false, privacyBlockCategories: [], maxAutoCollectPerMessage: 3, maxSemanticHistory: 10 },
        limits: { imageMaxSize: 5 * 1024 * 1024, fileMaxSize: 10 * 1024 * 1024, uploadFileMaxSize: 20 * 1024 * 1024, maxMessageHistory: 100, maxPendingRequests: 50 },
      } as never,
      { info: () => {}, warn: () => {} },
    );
    const outsideRoot = mkTmp();
    const outsidePath = path.join(outsideRoot, "x.gif");
    fs.writeFileSync(outsidePath, Buffer.from([0x47, 0x49, 0x46, 0x38]));
    const imageTemp = path.join(root, "images");
    fs.mkdirSync(imageTemp, { recursive: true });
    const ctx = {
      config: { paths: { workspace: root, imageTemp, stickerStore: stickerRoot } },
      log: { info: () => {}, warn: () => {} },
      stickerStore: store,
      stickerReplyStack: [],
      inboundMediaPathsStack: [[outsidePath]],
      inboundImageUrlsStack: [[]],
      inboundMessageRefStack: [{ userId: "123", messageId: "m1" }],
    } as unknown as PluginContext;
    const tools = createStickerTools(ctx);
    const collect = tools.find((t) => t.name === "sticker_collect");
    expect(collect).toBeDefined();
    const result = await collect!.execute!("tid", {
      local_image_path: outsidePath,
      collect_reason: "test",
    });
    expect((result.content[0] as { text: string }).text).toContain("路径不在允许的媒体目录内");
  });

  it("rejects path not in inboundMediaPathsStack", async () => {
    const root = mkTmp();
    const imageTemp = path.join(root, "images");
    fs.mkdirSync(imageTemp, { recursive: true });
    const onStackA = path.join(imageTemp, "stack_a.gif");
    const onStackB = path.join(imageTemp, "stack_b.gif");
    const otherPath = path.join(imageTemp, "other.gif");
    fs.writeFileSync(onStackA, Buffer.from([0x47, 0x49, 0x46, 0x38]));
    fs.writeFileSync(onStackB, Buffer.from([0x47, 0x49, 0x46, 0x38]));
    fs.writeFileSync(otherPath, Buffer.from([0x47, 0x49, 0x46, 0x38]));

    const stickerRoot = path.join(root, "stickers");
    fs.mkdirSync(path.join(stickerRoot, "files"), { recursive: true });
    fs.writeFileSync(path.join(stickerRoot, "index.json"), JSON.stringify({ records: [] }));

    const store = new StickerStore(
      {
        paths: { stickerStore: stickerRoot, workspace: root, imageTemp },
        stickers: { enabled: true, inboundAutoCollect: false, autoCollectStickerOnly: true, autoCollectFromImage: false, privacyBlockCategories: [], maxAutoCollectPerMessage: 3, maxSemanticHistory: 10 },
        limits: { imageMaxSize: 5 * 1024 * 1024, fileMaxSize: 10 * 1024 * 1024, uploadFileMaxSize: 20 * 1024 * 1024, maxMessageHistory: 100, maxPendingRequests: 50 },
      } as never,
      { info: () => {}, warn: () => {} },
    );

    const ctx = {
      config: { paths: { workspace: root, imageTemp, stickerStore: stickerRoot } },
      log: { info: () => {}, warn: () => {} },
      stickerStore: store,
      stickerReplyStack: [],
      inboundMediaPathsStack: [[onStackA, onStackB]],
      inboundImageUrlsStack: [[]],
      inboundMessageRefStack: [{ userId: "123", messageId: "m1" }],
    } as unknown as PluginContext;

    const tools = createStickerTools(ctx);
    const collect = tools.find((t) => t.name === "sticker_collect");
    const result = await collect!.execute!("tid", {
      local_image_path: otherPath,
      collect_reason: "test",
    });
    expect((result.content[0] as { text: string }).text).toContain("不是本条入站消息关联的图片");
  });

  it("imports when path is in allowed stack", async () => {
    const root = mkTmp();
    const imageTemp = path.join(root, "images");
    fs.mkdirSync(imageTemp, { recursive: true });
    const imagePath = path.join(imageTemp, "valid.gif");
    fs.writeFileSync(imagePath, Buffer.from([0x47, 0x49, 0x46, 0x38]));

    const stickerRoot = path.join(root, "stickers");
    fs.mkdirSync(path.join(stickerRoot, "files"), { recursive: true });
    fs.writeFileSync(path.join(stickerRoot, "index.json"), JSON.stringify({ records: [] }));

    const store = new StickerStore(
      {
        paths: { stickerStore: stickerRoot, workspace: root, imageTemp },
        stickers: { enabled: true, inboundAutoCollect: false, autoCollectStickerOnly: true, autoCollectFromImage: false, privacyBlockCategories: [], maxAutoCollectPerMessage: 3, maxSemanticHistory: 10 },
        limits: { imageMaxSize: 5 * 1024 * 1024, fileMaxSize: 10 * 1024 * 1024, uploadFileMaxSize: 20 * 1024 * 1024, maxMessageHistory: 100, maxPendingRequests: 50 },
      } as never,
      { info: () => {}, warn: () => {} },
    );

    const ctx = {
      config: { paths: { workspace: root, imageTemp, stickerStore: stickerRoot } },
      log: { info: () => {}, warn: () => {} },
      stickerStore: store,
      stickerReplyStack: [],
      inboundMediaPathsStack: [[imagePath]],
      inboundImageUrlsStack: [[]],
      inboundMessageRefStack: [{ userId: "123", messageId: "m1" }],
    } as unknown as PluginContext;

    const tools = createStickerTools(ctx);
    const collect = tools.find((t) => t.name === "sticker_collect");
    const result = await collect!.execute!("tid", {
      local_image_path: imagePath,
      collect_reason: "值得收藏的梗图",
      title: "测试收藏",
    });
    expect((result.content[0] as { text: string }).text).toMatch(/已收藏.*sticker_id=/);
  });

  it("imports when path is under workspace/qq_files/napcat_config (NapCat host mapping)", async () => {
    const root = mkTmp();
    const imageTemp = path.join(root, "qq_files", "images");
    fs.mkdirSync(imageTemp, { recursive: true });
    const napcatDir = path.join(root, "qq_files", "napcat_config", "recv");
    fs.mkdirSync(napcatDir, { recursive: true });
    const imagePath = path.join(napcatDir, "from-napcat.gif");
    fs.writeFileSync(imagePath, Buffer.from([0x47, 0x49, 0x46, 0x38]));

    const stickerRoot = path.join(root, "stickers");
    fs.mkdirSync(path.join(stickerRoot, "files"), { recursive: true });
    fs.writeFileSync(path.join(stickerRoot, "index.json"), JSON.stringify({ records: [] }));

    const store = new StickerStore(
      {
        paths: { stickerStore: stickerRoot, workspace: root, imageTemp },
        stickers: { enabled: true, inboundAutoCollect: false, autoCollectStickerOnly: true, autoCollectFromImage: false, privacyBlockCategories: [], maxAutoCollectPerMessage: 3, maxSemanticHistory: 10 },
        limits: { imageMaxSize: 5 * 1024 * 1024, fileMaxSize: 10 * 1024 * 1024, uploadFileMaxSize: 20 * 1024 * 1024, maxMessageHistory: 100, maxPendingRequests: 50 },
      } as never,
      { info: () => {}, warn: () => {} },
    );

    const ctx = {
      config: { paths: { workspace: root, imageTemp, stickerStore: stickerRoot } },
      log: { info: () => {}, warn: () => {} },
      stickerStore: store,
      stickerReplyStack: [],
      inboundMediaPathsStack: [[imagePath]],
      inboundImageUrlsStack: [[]],
      inboundMessageRefStack: [{ userId: "123", messageId: "m1" }],
    } as unknown as PluginContext;

    const tools = createStickerTools(ctx);
    const collect = tools.find((t) => t.name === "sticker_collect");
    const result = await collect!.execute!("tid", {
      local_image_path: imagePath,
      collect_reason: "napcat path",
      title: "napcat",
    });
    expect((result.content[0] as { text: string }).text).toMatch(/已收藏.*sticker_id=/);
  });

  it("collects via QQ CDN URL when inbound URL matches and fetch succeeds", async () => {
    const root = mkTmp();
    const imageTemp = path.join(root, "images");
    fs.mkdirSync(imageTemp, { recursive: true });
    const stickerRoot = path.join(root, "stickers");
    fs.mkdirSync(path.join(stickerRoot, "files"), { recursive: true });
    fs.writeFileSync(path.join(stickerRoot, "index.json"), JSON.stringify({ records: [] }));

    const store = new StickerStore(
      {
        paths: { stickerStore: stickerRoot, workspace: root, imageTemp },
        stickers: { enabled: true, inboundAutoCollect: false, autoCollectStickerOnly: true, autoCollectFromImage: false, privacyBlockCategories: [], maxAutoCollectPerMessage: 3, maxSemanticHistory: 10 },
        limits: { imageMaxSize: 5 * 1024 * 1024, fileMaxSize: 10 * 1024 * 1024, uploadFileMaxSize: 20 * 1024 * 1024, maxMessageHistory: 100, maxPendingRequests: 50 },
      } as never,
      { info: () => {}, warn: () => {} },
    );

    const qqUrl =
      "https://multimedia.nt.qq.com.cn/download?appid=1406&fileid=TESTFILEID123&rkey=abc";

    const prevFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "image/gif" : null) },
      arrayBuffer: async () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer,
    })) as typeof fetch;

    try {
      const ctx = {
        config: {
          paths: { workspace: root, imageTemp, stickerStore: stickerRoot },
          limits: { imageMaxSize: 5 * 1024 * 1024 },
          network: { imageFetchTimeoutMs: 5000 },
        },
        log: { info: () => {}, warn: () => {} },
        stickerStore: store,
        stickerReplyStack: [],
        inboundMediaPathsStack: [[]],
        inboundImageUrlsStack: [[qqUrl]],
        inboundMessageRefStack: [{ userId: "123", messageId: "m1" }],
      } as unknown as PluginContext;

      const tools = createStickerTools(ctx);
      const collect = tools.find((t) => t.name === "sticker_collect");
      const result = await collect!.execute!("tid", {
        local_image_path: qqUrl,
        collect_reason: "test-url",
        title: "url-collect",
      });
      expect((result.content[0] as { text: string }).text).toMatch(/已收藏.*sticker_id=/);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("collects via QQ CDN URL when inbound stacks are empty (model uses URL from context)", async () => {
    const root = mkTmp();
    const imageTemp = path.join(root, "images");
    fs.mkdirSync(imageTemp, { recursive: true });
    const stickerRoot = path.join(root, "stickers");
    fs.mkdirSync(path.join(stickerRoot, "files"), { recursive: true });
    fs.writeFileSync(path.join(stickerRoot, "index.json"), JSON.stringify({ records: [] }));

    const store = new StickerStore(
      {
        paths: { stickerStore: stickerRoot, workspace: root, imageTemp },
        stickers: { enabled: true, inboundAutoCollect: false, autoCollectStickerOnly: true, autoCollectFromImage: false, privacyBlockCategories: [], maxAutoCollectPerMessage: 3, maxSemanticHistory: 10 },
        limits: { imageMaxSize: 5 * 1024 * 1024, fileMaxSize: 10 * 1024 * 1024, uploadFileMaxSize: 20 * 1024 * 1024, maxMessageHistory: 100, maxPendingRequests: 50 },
      } as never,
      { info: () => {}, warn: () => {} },
    );

    const qqUrl =
      "https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=CTXONLY&rkey=abc";

    const prevFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "image/gif" : null) },
      arrayBuffer: async () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer,
    })) as typeof fetch;

    try {
      const ctx = {
        config: {
          paths: { workspace: root, imageTemp, stickerStore: stickerRoot },
          limits: { imageMaxSize: 5 * 1024 * 1024 },
          network: { imageFetchTimeoutMs: 5000 },
        },
        log: { info: () => {}, warn: () => {} },
        stickerStore: store,
        stickerReplyStack: [],
        inboundMediaPathsStack: [[]],
        inboundImageUrlsStack: [[]],
        inboundMessageRefStack: [{ userId: "123", messageId: "m1" }],
      } as unknown as PluginContext;

      const tools = createStickerTools(ctx);
      const collect = tools.find((t) => t.name === "sticker_collect");
      const result = await collect!.execute!("tid", {
        local_image_path: qqUrl,
        collect_reason: "from-context-url",
        title: "ctx-url",
      });
      expect((result.content[0] as { text: string }).text).toMatch(/已收藏.*sticker_id=/);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
