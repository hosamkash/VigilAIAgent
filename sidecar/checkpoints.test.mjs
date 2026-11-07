import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCheckpointWriter } from "./checkpoints.mjs";

const dirs = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createCheckpointWriter", () => {
  it("keeps the bytes from before the first write", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "vigil-cp-"));
    const store = await mkdtemp(path.join(tmpdir(), "vigil-cp-store-"));
    dirs.push(workspace, store);
    const target = path.join(workspace, "src", "app.ts");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "original\n");

    const writer = createCheckpointWriter({
      id: "msg-1",
      workspace,
      createdAt: 10,
      rootDir: store,
    });
    await writer.remember(target);
    await writeFile(target, "changed\n");
    await writer.remember(target);

    const saved = JSON.parse(await readFile(writer.file, "utf8"));
    expect(saved.files).toEqual([
      { path: "src/app.ts", existed: true, content: "original\n" },
    ]);
  });

  it("records a file that did not exist yet", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "vigil-cp-"));
    const store = await mkdtemp(path.join(tmpdir(), "vigil-cp-store-"));
    dirs.push(workspace, store);
    const writer = createCheckpointWriter({
      id: "msg-2",
      workspace,
      createdAt: 11,
      rootDir: store,
    });
    await writer.remember(path.join(workspace, "new.ts"));
    const saved = JSON.parse(await readFile(writer.file, "utf8"));
    expect(saved.files).toEqual([{ path: "new.ts", existed: false, content: "" }]);
  });
});
