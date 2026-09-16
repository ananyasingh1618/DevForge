import { describe, expect, it, vi, afterEach } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a structured JSON line with level, message, and fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test_event", { requestId: "abc-123", statusCode: 200 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(line.level).toBe("info");
    expect(line.message).toBe("test_event");
    expect(line.requestId).toBe("abc-123");
    expect(line.statusCode).toBe(200);
    expect(typeof line.timestamp).toBe("string");
  });

  it("redacts a secret-shaped value in a field before writing it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("unhandled_exception", { message: "failed calling sk-ant-abcdefghijklmnopqrstuvwxyz1234567890" });

    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(line.message).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(line.message).toContain("[REDACTED-SECRET]");
  });

  it("routes warn and error to console.error, debug and info to console.log", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.warn("a warning");
    logger.error("an error");
    logger.info("some info");

    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
