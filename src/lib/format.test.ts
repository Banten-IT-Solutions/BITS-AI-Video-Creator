import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  humanStatus,
  parseJsonObject,
  relativeTime,
  statusTone,
  truncate,
} from "./format";

describe("format helpers", () => {
  it("formats durations across magnitudes", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(1_500)).toBe("1.5 s");
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(95_000)).toBe("1m 35s");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_048)).toBe("2.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("maps statuses to tones and labels", () => {
    expect(statusTone("succeeded")).toBe("success");
    expect(statusTone("needs_login")).toBe("info");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("cancelled")).toBe("warning");
    expect(statusTone("unknown")).toBe("neutral");
    expect(humanStatus("needs_login")).toBe("Needs sign-in");
    expect(humanStatus("queued")).toBe("Queued");
  });

  it("describes relative times deterministically", () => {
    const now = new Date("2026-10-19T12:00:00.000Z").getTime();
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("2026-10-19T11:59:58.000Z", now)).toBe("just now");
    expect(relativeTime("2026-10-19T11:00:00.000Z", now)).toBe("1 hour ago");
    expect(relativeTime("2026-10-19T14:00:00.000Z", now)).toBe("in 2 hours");
  });

  it("parses JSON objects and reports failures", () => {
    expect(parseJsonObject("  ")).toEqual({ ok: true, value: {} });
    expect(parseJsonObject('{"ready":true}')).toEqual({ ok: true, value: { ready: true } });
    const invalid = parseJsonObject("{nope");
    expect(invalid.ok).toBe(false);
  });

  it("truncates long text without cutting the marker", () => {
    expect(truncate("short", 20)).toBe("short");
    const value = truncate("a".repeat(30), 10);
    expect(value).toHaveLength(10);
    expect(value.endsWith("…")).toBe(true);
  });
});
