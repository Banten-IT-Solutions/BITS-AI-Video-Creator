/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasTranslation } from "./index";

function walk(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "locales") continue;
      entries.push(...walk(full));
      continue;
    }
    if (/\.tsx?$/.test(name) && !name.includes(".test.")) entries.push(full);
  }
  return entries;
}

const callPattern = /\b(?:t|translate)\(\s*"([^"]+)"/g;

function collectKeys(): string[] {
  const keys = new Set<string>();
  const root = join(process.cwd(), "src");
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(callPattern)) {
      keys.add(match[1]!);
    }
  }
  return [...keys];
}

describe("indonesian translation coverage", () => {
  it("has an entry for every t()/translate() key in src", () => {
    const keys = collectKeys();
    expect(keys.length).toBeGreaterThan(50);
    const missing = keys.filter((key) => !hasTranslation(key));
    expect(missing).toEqual([]);
  });
});
