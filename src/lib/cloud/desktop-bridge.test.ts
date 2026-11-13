import { describe, expect, it } from "vitest";
import {
  isVigilBridgeMessage,
  isVigilWebOrigin,
  VIGIL_BRIDGE_SOURCE,
} from "./desktop-bridge";

describe("desktop-bridge", () => {
  it("accepts typed bridge messages", () => {
    expect(
      isVigilBridgeMessage({
        source: VIGIL_BRIDGE_SOURCE,
        type: "vigil:auth-request",
      }),
    ).toBe(true);
    expect(isVigilBridgeMessage({ type: "vigil:auth-request" })).toBe(false);
  });

  it("matches vigil web origin", () => {
    expect(
      isVigilWebOrigin("http://127.0.0.1:3000", "http://127.0.0.1:3000/app"),
    ).toBe(true);
    expect(
      isVigilWebOrigin("http://evil.example", "http://127.0.0.1:3000"),
    ).toBe(false);
  });
});
