import { describe, expect, it } from "vitest";
import {
  commandMatchesAllowlist,
  matchGlobish,
  pathMatchesDenylist,
} from "./agent-permissions";

describe("agent-permissions", () => {
  it("matches globish command patterns", () => {
    expect(matchGlobish("npm run test*", "npm run test")).toBe(true);
    expect(matchGlobish("npx vitest*", "npx vitest run")).toBe(true);
    expect(matchGlobish("npm test", "npm run build")).toBe(false);
  });

  it("allowlists safe test commands", () => {
    expect(
      commandMatchesAllowlist("npm test", ["npm test", "npx vitest*"]),
    ).toBe(true);
  });

  it("denies sensitive paths", () => {
    expect(pathMatchesDenylist("src/.env", [".env", "**/.env"])).toBe(true);
    expect(pathMatchesDenylist("src/App.tsx", [".env"])).toBe(false);
  });
});
