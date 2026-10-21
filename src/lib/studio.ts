import type { Scene, Shot, Storyboard, StoryboardInput, Voiceover } from "./types";

export const DEFAULT_VOICEOVER: Voiceover = {
  text: "",
  voice: "",
  rate: 1,
  pitch: 1,
  volume: 1,
};

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newShot(): Shot {
  return {
    id: createId(),
    description: "",
    prompt: "",
    camera: "",
    durationSeconds: 5,
    dialogue: "",
    transition: "Cut",
  };
}

export function newScene(index: number): Scene {
  return {
    id: createId(),
    title: `Scene ${index}`,
    description: "",
    location: "",
    timeOfDay: "",
    shots: [newShot()],
    voiceover: { ...DEFAULT_VOICEOVER },
  };
}

export type StoryboardDraft = StoryboardInput & {
  title: string;
  logline: string;
  style: string;
  aspectRatio: string;
  scenes: Scene[];
};

export function storyboardToInput(storyboard: Storyboard): StoryboardDraft {
  return {
    title: storyboard.title,
    logline: storyboard.logline,
    style: storyboard.style,
    aspectRatio: storyboard.aspectRatio,
    scenes: storyboard.scenes,
  };
}

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function storyboardCounts(scenes: Scene[]): {
  scenes: number;
  shots: number;
  durationSeconds: number;
} {
  return {
    scenes: scenes.length,
    shots: scenes.reduce((total, scene) => total + scene.shots.length, 0),
    durationSeconds: scenes.reduce(
      (total, scene) =>
        total + scene.shots.reduce((sceneTotal, shot) => sceneTotal + (shot.durationSeconds || 0), 0),
      0,
    ),
  };
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

export function slugify(value: string, fallback = "storyboard"): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

export function sceneLabel(scene: Scene, index: number): string {
  return scene.title.trim() || `Scene ${index + 1}`;
}
