import { describe, expect, it } from "vitest";
import { parseHash } from "./router";

describe("hash routing", () => {
  it("resolves top-level pages", () => {
    expect(parseHash("")).toEqual({ page: "dashboard" });
    expect(parseHash("#/")).toEqual({ page: "dashboard" });
    expect(parseHash("#/accounts")).toEqual({ page: "accounts" });
    expect(parseHash("#/runs")).toEqual({ page: "runs" });
    expect(parseHash("#/logs")).toEqual({ page: "logs" });
    expect(parseHash("#/settings")).toEqual({ page: "settings" });
  });

  it("resolves workflow editor ids", () => {
    expect(parseHash("#/workflows/abc-123")).toEqual({ page: "workflow", id: "abc-123" });
  });

  it("ignores query parameters used for settings tabs", () => {
    expect(parseHash("#/settings?tab=data")).toEqual({ page: "settings" });
  });

  it("falls back to the dashboard for unknown routes", () => {
    expect(parseHash("#/not-a-page")).toEqual({ page: "dashboard" });
  });
});
