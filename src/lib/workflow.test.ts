import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "./types";
import {
  autoLayout,
  blankDefinition,
  createNode,
  defaultConfig,
  definitionStats,
  nodeLabel,
  nodeSummary,
  normalizeEdgeBranch,
  scheduleFromDefinition,
} from "./workflow";

describe("workflow helpers", () => {
  it("creates deterministic unique node ids", () => {
    const first = createNode("action.http", new Set(), { x: 0, y: 0 });
    expect(first.id).toBe("http-1");
    expect(first.type).toBe("action.http");
    const second = createNode("action.http", new Set([first.id]), { x: 0, y: 0 });
    expect(second.id).toBe("http-2");
  });

  it("builds a valid starting definition with a single manual trigger", () => {
    const definition = blankDefinition();
    expect(definition.schemaVersion).toBe(1);
    expect(definition.nodes).toHaveLength(1);
    expect(definition.nodes[0].type).toBe("trigger.manual");
    expect(definition.edges).toHaveLength(0);
    expect(definition.nodes[0].position).toEqual({ x: 80, y: 160 });
  });

  it("summarizes schedule and retry configurations", () => {
    const schedule = createNode("trigger.schedule", new Set(), { x: 0, y: 0 });
    expect(defaultConfig("trigger.schedule")).toMatchObject({ cron: "0 9 * * * *" });
    expect(nodeSummary(schedule)).toContain("0 9 * * * *");
    const retry = createNode("error.retry", new Set(), { x: 0, y: 0 });
    expect(nodeSummary(retry)).toContain("2 retries");
    expect(nodeLabel("action.account_check")).toBe("Account check");
  });

  it("derives schedule input from the schedule trigger", () => {
    const definition = blankDefinition();
    const trigger = createNode("trigger.schedule", new Set(), { x: 0, y: 0 });
    definition.nodes.push({
      ...trigger,
      config: { cron: "0 */5 * * * *", timezone: "Europe/Warsaw", enabled: false },
    });
    definition.nodes = definition.nodes.filter((node) => node.type !== "trigger.manual");
    expect(scheduleFromDefinition(definition)).toEqual({
      cron: "0 */5 * * * *",
      timezone: "Europe/Warsaw",
      enabled: false,
    });

    expect(scheduleFromDefinition(blankDefinition())).toBeNull();
  });

  it("respects stored positions and lays out missing nodes by level", () => {
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        { id: "trigger", type: "trigger.manual", name: "Start", config: {}, position: { x: 10, y: 20 } },
        { id: "first", type: "action.log", name: "Log", config: {} },
        { id: "second", type: "action.log", name: "Log again", config: {} },
      ],
      edges: [
        { id: "e1", from: "trigger", to: "first" },
        { id: "e2", from: "first", to: "second" },
      ],
    };
    const positions = autoLayout(definition);
    expect(positions.trigger).toEqual({ x: 10, y: 20 });
    expect(positions.first.x).toBeGreaterThan(positions.trigger.x);
    expect(positions.second.x).toBeGreaterThan(positions.first.x);
  });

  it("counts nodes, edges, and conditions", () => {
    const definition = blankDefinition();
    definition.nodes.push(createNode("logic.condition", new Set(["trigger-1"]), { x: 1, y: 2 }));
    definition.edges.push({ id: "edge-1", from: "trigger-1", to: "condition-1", branch: null });
    expect(definitionStats(definition)).toEqual({ nodes: 2, edges: 1, conditions: 1 });
  });

  it("normalizes imported condition branches without inventing branches on other nodes", () => {
    const condition = createNode("logic.condition", new Set(), { x: 0, y: 0 });
    const action = createNode("action.log", new Set(), { x: 0, y: 0 });
    expect(normalizeEdgeBranch({ id: "e1", from: condition.id, to: "next" }, condition)).toBe("true");
    expect(normalizeEdgeBranch({ id: "e2", from: condition.id, to: "next", branch: "false" }, condition)).toBe("false");
    expect(normalizeEdgeBranch({ id: "e3", from: condition.id, to: "next", branch: null }, condition)).toBe("true");
    expect(normalizeEdgeBranch({ id: "e4", from: action.id, to: "next", branch: "false" }, action)).toBeNull();
    expect(normalizeEdgeBranch({ id: "e5", from: "missing", to: "next", branch: "false" }, undefined)).toBeNull();
  });
});
