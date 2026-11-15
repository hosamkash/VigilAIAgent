import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDECAR_PORT,
  getSidecarPort,
  setSidecarPort,
  sidecarBaseUrl,
} from "./sidecar-endpoint";

describe("sidecar-endpoint", () => {
  it("builds the loopback URL from the remembered port", () => {
    setSidecarPort(DEFAULT_SIDECAR_PORT);
    expect(sidecarBaseUrl()).toBe("http://127.0.0.1:47821");
    setSidecarPort(51234);
    expect(getSidecarPort()).toBe(51234);
    expect(sidecarBaseUrl()).toBe("http://127.0.0.1:51234");
    setSidecarPort(DEFAULT_SIDECAR_PORT);
  });
});
