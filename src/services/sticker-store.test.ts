import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { BotConfig } from "../config.js";
import type { QQMessage } from "../napcat/types.js";
import { StickerStore } from "./sticker-store.js";

function createTestConfig(stickerRoot: string): BotConfig {
  const workspace = path.join(os.tmpdir(), `sticker-test-${Date.now()}`);
  return {
    paths: {
      workspace,
      stickerStore: stickerRoot,
      imageTemp: path.join(workspace, "qq_files", "images"),
      sessionsDir: path.join(workspace, "sessions"),
      containerPrefixes: [],
      textExts: [],
    },
    stickers: {
      enabled: true,
      inboundAutoCollect: true,
      autoCollectStickerOnly: true,
      autoCollectFromImage: false,
      privacyBlockCategories: [],
      maxAutoCollectPerMessage: 3,
      maxSemanticHistory: 10,
    },
    limits: {
      imageMaxSize: 5 * 1024 * 1024,
      fileMaxSize: 10 * 1024 * 1024,
      uploadFileMaxSize: 20 * 1024 * 1024,
      maxMessageHistory: 100,
      maxPendingRequests: 50,
    },
  } as BotConfig;
}

function createMinimalMsg(overrides?: Partial<QQMessage>): QQMessage {
  return {
    id: "msg-1",
    userId: "123456",
    content: "",
    messageType: "private",
    rawMessage: "",
    timestamp: Date.now() / 1000,
    sender: {},
    atBot: false,
    files: [],
    imageUrls: [],
    imageFiles: [],
    imageFileIds: [],
    stickerCandidates: [],
    ...overrides,
  } as QQMessage;
}

describe("StickerStore", () => {
  let tmpDir: string;
  let store: StickerStore;
  let config: BotConfig;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("importFromFile creates record and dedupes by hash", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sticker-store-"));
    const imagePath = path.join(tmpDir, "test.gif");
    fs.writeFileSync(imagePath, Buffer.from([0x47, 0x49, 0x46, 0x38])); // minimal gif header

    config = createTestConfig(tmpDir);
    store = new StickerStore(config, { info: () => {}, warn: () => {} });
    const msg = createMinimalMsg();

    const out1 = store.importFromFile(msg, imagePath, {
      reason: "agent-collect:test",
      source: "user-guided",
      semantics: { title: "测试图", meaning: "测试用" },
    });
    expect(out1.kind).toBe("created");
    expect(out1.record.id).toBeDefined();
    expect(out1.record.semantics.title).toBe("测试图");
    expect(out1.record.semantics.meaning).toBe("测试用");

    const out2 = store.importFromFile(msg, imagePath, {
      reason: "agent-collect:again",
      source: "user-guided",
    });
    expect(out2.kind).toBe("duplicate");
    expect(out2.record.id).toBe(out1.record.id);

    const byId = store.getById(out1.record.id);
    expect(byId?.usageCount).toBe(2);
  });

  it("collectFromInbound returns 0 when inboundAutoCollect is false", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sticker-store-"));
    const imagePath = path.join(tmpDir, "test.jpg");
    fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff]));

    config = createTestConfig(tmpDir);
    config.stickers.inboundAutoCollect = false;
    store = new StickerStore(config, { info: () => {}, warn: () => {} });
    const msg = createMinimalMsg({ stickerCandidates: [{ kind: "image", protocolEmoji: true, segmentIndex: 0 }] });

    const saved = await store.collectFromInbound(msg, [imagePath]);
    expect(saved).toBe(0);
  });

  it("collectFromInbound imports when inboundAutoCollect is true and scoreCandidate allows", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sticker-store-"));
    const imagePath = path.join(tmpDir, "test.gif");
    fs.writeFileSync(imagePath, Buffer.from([0x47, 0x49, 0x46, 0x38]));

    config = createTestConfig(tmpDir);
    config.stickers.inboundAutoCollect = true;
    config.stickers.autoCollectFromImage = true;
    config.stickers.autoCollectStickerOnly = false;
    store = new StickerStore(config, { info: () => {}, warn: () => {} });
    const msg = createMinimalMsg();

    const saved = await store.collectFromInbound(msg, [imagePath]);
    expect(saved).toBe(1);
  });
});
