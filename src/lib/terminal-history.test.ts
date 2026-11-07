import { describe, expect, it } from "vitest";
import { pushCommandHistory, stepCommandHistory } from "./terminal-history";

describe("pushCommandHistory", () => {
  it("skips blanks and consecutive duplicates", () => {
    expect(pushCommandHistory(["ls"], "  ")).toEqual(["ls"]);
    expect(pushCommandHistory(["ls"], "ls")).toEqual(["ls"]);
    expect(pushCommandHistory(["ls"], "pwd")).toEqual(["ls", "pwd"]);
  });
});

describe("stepCommandHistory", () => {
  const history = ["ls", "pwd", "npm run dev"];

  it("goes up from a fresh draft into the newest command", () => {
    const next = stepCommandHistory(history, -1, "up", "partial");
    expect(next).toEqual({ index: 2, value: "npm run dev", draft: "partial" });
  });

  it("walks older commands on repeated up", () => {
    const mid = stepCommandHistory(history, 2, "up", "partial");
    expect(mid.index).toBe(1);
    expect(mid.value).toBe("pwd");
  });

  it("restores the draft after walking back down past the newest", () => {
    const next = stepCommandHistory(history, 2, "down", "partial");
    expect(next).toEqual({ index: -1, value: "partial", draft: "partial" });
  });
});
