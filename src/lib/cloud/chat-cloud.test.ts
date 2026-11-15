import { describe, expect, it } from "vitest";
import {
  CLOUD_MESSAGE_CONTENT_MAX,
  chatTabToCloudDoc,
  messageToCloudDoc,
  sanitizeMessageContent,
} from "./chat-cloud";
import { assertNoCodeUpload } from "./no-code-upload";
import type { ChatMessage } from "../../store/chatStore";

describe("chat-cloud mapping", () => {
  it("maps tab metadata without local blobs", () => {
    const doc = chatTabToCloudDoc(
      {
        id: "c1",
        title: " Hello ",
        archived: false,
        createdAt: 1,
        updatedAt: 2,
      },
      "user-1",
      { workspaceHint: "proj" },
    );
    expect(doc.title).toBe("Hello");
    expect(doc.userId).toBe("user-1");
    expect(doc.uid).toBe("user-1");
    expect(doc.createdAtMs).toBe(1);
    expect(doc.updatedAtMs).toBe(2);
    expect(doc.linkedWorkspaceHint).toBe("proj");
    expect(assertNoCodeUpload(doc).ok).toBe(true);
  });

  it("strips attachments and keeps text + model", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "fixed the bug",
      createdAt: 10,
      modelLabel: "gemini",
      images: [{ id: "i", name: "x.png", dataUrl: "data:image/png;base64,AAA" }],
      editedFiles: [
        {
          path: "src/a.ts",
          label: "a.ts",
          original: "old",
          modified: "new",
        },
      ],
    };
    const doc = messageToCloudDoc(msg, "c1", "user-1");
    expect(doc.content).toBe("fixed the bug");
    expect(doc.model).toBe("gemini");
    expect(doc).not.toHaveProperty("images");
    expect(doc).not.toHaveProperty("editedFiles");
    expect(assertNoCodeUpload(doc).ok).toBe(true);
  });

  it("truncates oversized message content", () => {
    const huge = "x".repeat(CLOUD_MESSAGE_CONTENT_MAX + 500);
    const out = sanitizeMessageContent(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain("[truncated for cloud]");
  });
});
