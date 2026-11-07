import { describe, expect, it } from "vitest";
import { VigilDbStore } from "./store";
import { buildDocumentPath, buildTenantCollectionPath } from "./paths";
import { VIGIL_DB_KIND } from "./constants";

describe("VigilDbStore", () => {
  it("creates, writes, and round-trips .vigilDB bytes", async () => {
    const store = VigilDbStore.create("test-agent");
    expect(store.meta.kind).toBe(VIGIL_DB_KIND);

    const col = buildTenantCollectionPath("VigilAgent", "runCommands");
    const path = buildDocumentPath(col, "cmd1");
    store.setDocument(path, {
      id: "cmd1",
      command: "npm run dev",
      description: "تشغيل السيرفر المحلي",
      kind: "custom",
    });

    expect(store.getDocument(path).exists).toBe(true);
    expect(store.listDocuments(col)).toHaveLength(1);

    const bytes = await store.toBytes();
    expect(bytes.byteLength).toBeGreaterThan(20);

    const loaded = await VigilDbStore.fromBuffer(bytes);
    const doc = loaded.getDocument(path);
    expect(doc.data.command).toBe("npm run dev");
    expect(doc.data.description).toBe("تشغيل السيرفر المحلي");
  });

  it("merges documents", () => {
    const store = VigilDbStore.create("merge");
    const path = buildDocumentPath("VigilAgent.runCommands", "x");
    store.setDocument(path, { command: "a", description: "old" });
    store.setDocument(path, { description: "new" }, true);
    expect(store.getDocument(path).data).toMatchObject({
      command: "a",
      description: "new",
    });
  });

  it("stores chat session history docs", async () => {
    const store = VigilDbStore.create("history");
    const col = buildTenantCollectionPath("VigilAgent", "chatSessions");
    const path = buildDocumentPath(col, "sess-1");
    store.setDocument(path, {
      id: "sess-1",
      title: "Debugging deploy",
      messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1 }],
      archived: true,
      createdAt: 1,
      updatedAt: 2,
    });
    const listed = store.listDocuments(col);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.data.title).toBe("Debugging deploy");
    expect(listed[0]!.data.archived).toBe(true);

    const loaded = await VigilDbStore.fromBuffer(await store.toBytes());
    expect(loaded.getDocument(path).data.messages).toHaveLength(1);
  });
});
