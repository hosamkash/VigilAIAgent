import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCloudRefreshLoopRunning,
  startCloudChatRefreshLoop,
  stopCloudChatRefreshLoop,
} from "./cloud-refresh-loop";

describe("cloud-refresh-loop", () => {
  afterEach(() => {
    stopCloudChatRefreshLoop();
    vi.useRealTimers();
  });

  it("starts and stops the interval", () => {
    expect(isCloudRefreshLoopRunning()).toBe(false);
    startCloudChatRefreshLoop("uid-1", 20_000);
    expect(isCloudRefreshLoopRunning()).toBe(true);
    stopCloudChatRefreshLoop();
    expect(isCloudRefreshLoopRunning()).toBe(false);
  });

  it("does not start without uid", () => {
    startCloudChatRefreshLoop("");
    expect(isCloudRefreshLoopRunning()).toBe(false);
  });

  it("idempotent for same uid", () => {
    startCloudChatRefreshLoop("uid-1", 20_000);
    startCloudChatRefreshLoop("uid-1", 20_000);
    expect(isCloudRefreshLoopRunning()).toBe(true);
  });
});
