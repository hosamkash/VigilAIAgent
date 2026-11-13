import { describe, expect, it } from "vitest";
import { permissionDecision } from "./permissions.mjs";

describe("permissionDecision", () => {
  it("allowlists test commands when auto-run is off", () => {
    expect(
      permissionDecision({
        toolName: "run_commands",
        input: { command: "npm test" },
        autoRun: false,
        sessionAllow: false,
        commandAllowlist: ["npm test", "npx vitest*"],
        pathDenylist: [],
      }),
    ).toBe("allow");
  });

  it("asks for non-allowlisted commands when auto-run is off", () => {
    expect(
      permissionDecision({
        toolName: "run_commands",
        input: { command: "rm -rf /" },
        autoRun: false,
        sessionAllow: false,
        commandAllowlist: ["npm test"],
        pathDenylist: [],
      }),
    ).toBe("ask");
  });

  it("always asks for denied write paths even with auto-run", () => {
    expect(
      permissionDecision({
        toolName: "write_file",
        input: { path: ".env", content: "x=1" },
        autoRun: true,
        sessionAllow: true,
        commandAllowlist: [],
        pathDenylist: [".env", "**/.env"],
      }),
    ).toBe("ask");
  });

  it("denies write tools in Plan mode until Execute unlock", () => {
    expect(
      permissionDecision({
        toolName: "write_file",
        input: { path: "src/a.ts", content: "x" },
        autoRun: true,
        sessionAllow: true,
        planMode: true,
        planExecuteUnlocked: false,
      }),
    ).toBe("deny");
    expect(
      permissionDecision({
        toolName: "apply_patch",
        input: {},
        autoRun: true,
        sessionAllow: true,
        planMode: true,
        planExecuteUnlocked: false,
      }),
    ).toBe("deny");
    expect(
      permissionDecision({
        toolName: "search_codebase",
        input: { query: "plan" },
        autoRun: false,
        sessionAllow: false,
        planMode: true,
        planExecuteUnlocked: false,
      }),
    ).toBe("ask");
  });

  it("allows writes in Plan mode after Execute unlock", () => {
    expect(
      permissionDecision({
        toolName: "write_file",
        input: { path: "src/a.ts", content: "x" },
        autoRun: true,
        sessionAllow: true,
        planMode: true,
        planExecuteUnlocked: true,
      }),
    ).toBe("allow");
  });

  it("denies write tools in Ask mode", () => {
    expect(
      permissionDecision({
        toolName: "apply_patch",
        input: {},
        autoRun: true,
        sessionAllow: true,
        askMode: true,
        planExecuteUnlocked: false,
      }),
    ).toBe("deny");
  });
});
