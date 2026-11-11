import { describe, expect, it } from "vitest";
import {
  buildIdf,
  embedText,
  cosine,
  quantizeVec,
  dequantizeVec,
  hybridRank,
} from "./local-embed.mjs";
import { tokenize } from "./bm25.mjs";

describe("local-embed", () => {
  it("embeds similar texts closer than unrelated", () => {
    const docs = [
      tokenize("function searchCodebase query symbols"),
      tokenize("function listFiles directory listing"),
      tokenize("unrelated payment invoice billing"),
    ];
    const idf = buildIdf(docs);
    const q = embedText("search codebase symbols", idf);
    const a = embedText("function searchCodebase query symbols", idf);
    const b = embedText("unrelated payment invoice billing", idf);
    expect(cosine(q, a)).toBeGreaterThan(cosine(q, b));
  });

  it("round-trips quantization with usable cosine", () => {
    const idf = buildIdf([tokenize("alpha beta gamma")]);
    const v = embedText("alpha beta gamma", idf);
    const q = dequantizeVec(quantizeVec(v));
    expect(cosine(v, q)).toBeGreaterThan(0.95);
  });

  it("hybridRank prefers exact symbol titles", () => {
    const chunks = [
      {
        id: "1",
        path: "a.ts",
        title: "searchCodebase",
        kind: "function",
        text: "a",
      },
      {
        id: "2",
        path: "b.ts",
        title: "other",
        kind: "function",
        text: "b",
      },
    ];
    const hits = hybridRank({
      chunks,
      bm25Hits: [
        { id: "1", score: 2 },
        { id: "2", score: 3 },
      ],
      vectorHits: [
        { id: "1", score: 0.9 },
        { id: "2", score: 0.2 },
      ],
      query: "searchCodebase",
      importNeighbors: new Set(),
      limit: 2,
    });
    expect(hits[0].id).toBe("1");
  });
});
