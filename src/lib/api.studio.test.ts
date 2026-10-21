import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { api } from "./api";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("studio API bridge", () => {
  it("lists storyboards through the expected command", async () => {
    invokeMock.mockResolvedValue([]);
    await expect(api.listStoryboards()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("list_storyboards", undefined);
  });

  it("passes the storyboard input by value to the create command", async () => {
    const input = {
      title: "Coastal delivery",
      logline: "",
      style: "Cinematic",
      aspectRatio: "16:9",
      scenes: [],
    };
    invokeMock.mockResolvedValue({ id: "storyboard-1", ...input });
    await api.createStoryboard(input);
    expect(invokeMock).toHaveBeenCalledWith("create_storyboard", { input });
  });

  it("maps voiceover generation arguments to the Rust command", async () => {
    invokeMock.mockResolvedValue({
      id: "asset-1",
      storyboardId: "storyboard-1",
      sceneId: "scene-1",
      path: "/tmp/scene.mp3",
      format: "mp3",
      bytes: 1024,
      voice: "alloy",
      createdAt: "2026-01-01T00:00:00Z",
    });
    await api.synthesizeVoiceover(
      "Every delivery starts with a departure.",
      "/tmp/scene.mp3",
      "storyboard-1",
      "scene-1",
    );
    expect(invokeMock).toHaveBeenCalledWith("synthesize_voiceover", {
      text: "Every delivery starts with a departure.",
      path: "/tmp/scene.mp3",
      storyboardId: "storyboard-1",
      sceneId: "scene-1",
    });
  });

  it("surfaces backend errors as typed API errors", async () => {
    invokeMock.mockRejectedValue({ code: "validation", message: "Storyboard not found" });
    await expect(api.getStoryboard("missing")).rejects.toMatchObject({
      name: "ApiError",
      code: "validation",
      message: "Storyboard not found",
    });
  });
});
