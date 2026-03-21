import { describe, expect, it } from "vitest";
import {
  buildStickerSearchCorpus,
  rankStickerRecordsByQuery,
  scoreStickerSemanticMatch,
  tokenizeSearchQuery,
} from "./sticker-search-score.js";
import type { StickerRecord } from "./sticker-store.js";

function minimalRecord(partial: Partial<StickerRecord> & { semantics: StickerRecord["semantics"] }): StickerRecord {
  const now = new Date().toISOString();
  return {
    id: "id1",
    hash: "h",
    ext: ".gif",
    filePath: "files/x.gif",
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
    sourceType: "image",
    sourceUserId: "",
    sourceMessageId: "",
    protocolEmoji: false,
    semanticHistory: [],
    ...partial,
    semantics: partial.semantics,
  };
}

describe("sticker-search-score", () => {
  it("tokenizeSearchQuery adds bigrams for long CJK without spaces", () => {
    const t = tokenizeSearchQuery("无话可说");
    expect(t).toContain("无话");
    expect(t).toContain("话可");
  });

  it("scoreStickerSemanticMatch weights useWhen and title", () => {
    const s = {
      title: "狗头",
      meaning: "普通说明",
      emotionTags: [],
      intentTags: [],
      useWhen: ["吐槽同事"],
      avoidWhen: [],
      aliases: [],
      confidence: 0.5,
    };
    const a = scoreStickerSemanticMatch("吐槽", s, 0);
    const b = scoreStickerSemanticMatch("普通", s, 0);
    expect(a).toBeGreaterThan(b);
  });

  it("avoidWhen in query reduces score", () => {
    const s = {
      title: "严肃",
      meaning: "x",
      emotionTags: [],
      intentTags: [],
      useWhen: [],
      avoidWhen: ["开会"],
      aliases: [],
      confidence: 0.5,
    };
    const withAvoid = scoreStickerSemanticMatch("开会用这个", s, 0);
    const noAvoid = scoreStickerSemanticMatch("用这个", s, 0);
    expect(withAvoid).toBeLessThan(noAvoid);
  });

  it("rankStickerRecordsByQuery sorts by score", () => {
    const r1 = minimalRecord({
      id: "a",
      semantics: {
        title: "笑",
        meaning: "",
        emotionTags: [],
        intentTags: [],
        useWhen: [],
        avoidWhen: [],
        aliases: [],
        confidence: 0.5,
      },
    });
    const r2 = minimalRecord({
      id: "b",
      semantics: {
        title: "大笑",
        meaning: "哈哈大笑",
        emotionTags: [],
        intentTags: [],
        useWhen: [],
        avoidWhen: [],
        aliases: [],
        confidence: 0.5,
      },
    });
    const ranked = rankStickerRecordsByQuery("哈哈", [r1, r2], 5);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.record.id).toBe("b");
  });

  it("buildStickerSearchCorpus joins searchable fields", () => {
    const c = buildStickerSearchCorpus({
      title: "T",
      meaning: "M",
      emotionTags: ["e"],
      intentTags: ["i"],
      useWhen: ["u"],
      avoidWhen: ["skip"],
      aliases: ["a"],
      confidence: 0.5,
    });
    expect(c).toContain("T");
    expect(c).toContain("u");
    expect(c).not.toContain("skip");
  });
});
