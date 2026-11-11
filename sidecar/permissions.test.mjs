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
});
