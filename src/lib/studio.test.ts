import { describe, expect, it } from "vitest";
import {
  cloneValue,
  formatDuration,
  newScene,
  sceneLabel,
  slugify,
  storyboardCounts,
  storyboardToInput,
} from "./studio";
import type { Storyboard } from "./types";

function storyboard(): Storyboard {
  return {
    id: "storyboard-1",
    schemaVersion: 1,
    title: "Coastal delivery",
    logline: "A courier crosses the island before sunset.",
    style: "Warm cinematic",
    aspectRatio: "16:9",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    scenes: [
      {
        id: "scene-1",
        title: "Departure",
        description: "",
        location: "Harbour",
        timeOfDay: "Morning",
        shots: [
          {
            id: "shot-1",
            description: "",
            prompt: "",
            camera: "",
            durationSeconds: 6,
            dialogue: "",
            transition: "Cut",
          },
          {
            id: "shot-2",
            description: "",
            prompt: "",
            camera: "",
            durationSeconds: 4,
            dialogue: "",
            transition: "Cut",
          },
        ],
        voiceover: { text: "We start here.", voice: "", rate: 1, pitch: 1, volume: 1 },
      },
    ],
  };
}

describe("studio helpers", () => {
  it("converts a storyboard into a complete editable draft", () => {
    const draft = storyboardToInput(storyboard());
    expect(draft.title).toBe("Coastal delivery");
    expect(draft.scenes).toHaveLength(1);
    expect(draft.scenes[0].shots).toHaveLength(2);
  });

  it("counts scenes, shots, and runtime from shot durations", () => {
    expect(storyboardCounts(storyboard().scenes)).toEqual({
      scenes: 1,
      shots: 2,
      durationSeconds: 10,
    });
  });

  it("formats short and long runtimes", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59)).toBe("59s");
    expect(formatDuration(61)).toBe("1m 01s");
    expect(formatDuration(3661)).toBe("61m 01s");
  });

  it("creates a usable default scene with one shot", () => {
    const scene = newScene(3);
    expect(scene.title).toBe("Scene 3");
    expect(scene.shots).toHaveLength(1);
    expect(scene.shots[0].durationSeconds).toBe(5);
    expect(scene.voiceover.text).toBe("");
  });

  it("slugifies export names without leaving unsafe characters", () => {
    expect(slugify("  The Last Light / Banten  ")).toBe("the-last-light-banten");
    expect(slugify("???")).toBe("storyboard");
  });

  it("labels empty scenes by ordinal and trims titles for display", () => {
    const scene = newScene(1);
    expect(sceneLabel({ ...scene, title: "  Opening  " }, 0)).toBe("Opening");
    expect(sceneLabel({ ...scene, title: "   " }, 4)).toBe("Scene 5");
  });

  it("clones nested values so edits do not mutate the saved draft", () => {
    const original = storyboard();
    const copy = cloneValue(original);
    copy.scenes[0].shots[0].durationSeconds = 30;
    expect(original.scenes[0].shots[0].durationSeconds).toBe(6);
    expect(copy.scenes[0].shots[0].durationSeconds).toBe(30);
  });
});
