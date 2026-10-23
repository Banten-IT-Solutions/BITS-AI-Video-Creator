import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  AudioLines,
  FolderOpen,
  Loader2,
  Mic2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  SectionLabel,
  Select,
  Textarea,
  cn,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatBytes, relativeTime } from "../lib/format";
import { navigate, setBeforeNavigate } from "../lib/router";
import { sceneLabel, slugify, storyboardToInput } from "../lib/studio";
import type { Scene, Storyboard, Voiceover } from "../lib/types";

export function VoiceoverPage() {
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const list = useQuery({ queryKey: ["storyboards"], queryFn: api.listStoryboards });
  const detail = useQuery({
    queryKey: ["storyboard", storyboardId],
    queryFn: () => api.getStoryboard(storyboardId as string),
    enabled: storyboardId != null,
  });

  useEffect(() => {
    if (!list.data) return;
    if (storyboardId && list.data.some((item) => item.id === storyboardId)) return;
    setStoryboardId(list.data[0]?.id ?? null);
  }, [list.data, storyboardId]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Native studio"
        title="Voiceover studio"
        description="Preview every scene with the system speech engine, or generate a downloadable voice track through your own OpenAI-compatible TTS provider."
        actions={
          <Button variant="secondary" icon={<Mic2 size={15} />} onClick={() => navigate("/storyboards")}>
            Edit storyboards
          </Button>
        }
      />

      {list.isLoading ? (
        <Card className="mt-5">
          <div className="flex items-center justify-center p-16 text-xs text-muted">
            <Loader2 size={15} className="mr-2 animate-spin text-accent" /> Loading voiceover projects…
          </div>
        </Card>
      ) : list.isError ? (
        <Card className="mt-5 border-danger/30">
          <div className="p-5 text-xs leading-5 text-danger">{list.error.message}</div>
        </Card>
      ) : (list.data?.length ?? 0) === 0 ? (
        <Card className="mt-5">
          <EmptyState
            icon={<Mic2 size={20} />}
            title="No scenes to voice yet"
            description="Create a storyboard first. Every scene can carry its own voiceover script, voice, pacing, and generated audio."
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate("/storyboards")}>
                Create a storyboard
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="mt-5 space-y-4">
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
                  Storyboard
                </label>
                <Select
                  value={storyboardId ?? ""}
                  onChange={(event) => {
                    const next = event.target.value || null;
                    if (dirty && next !== storyboardId && !window.confirm("Discard unsaved voiceover changes?")) {
                      return;
                    }
                    setDirty(false);
                    setStoryboardId(next);
                  }}
                  aria-label="Choose storyboard"
                >
                  {(list.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title} · {item.sceneCount} scenes
                    </option>
                  ))}
                </Select>
              </div>
              {detail.data ? (
                <div className="flex flex-wrap gap-2 text-[10px] text-faint">
                  <Badge tone="neutral">{detail.data.style}</Badge>
                  <Badge tone="neutral">{detail.data.aspectRatio}</Badge>
                  <Badge tone="neutral">{detail.data.scenes.length} scenes</Badge>
                </div>
              ) : null}
            </div>
          </Card>

          {detail.isLoading ? (
            <Card>
              <div className="flex items-center justify-center p-16 text-xs text-muted">
                <Loader2 size={15} className="mr-2 animate-spin text-accent" /> Loading scenes…
              </div>
            </Card>
          ) : detail.isError ? (
            <Card className="border-danger/30">
              <div className="p-5 text-xs leading-5 text-danger">{detail.error.message}</div>
            </Card>
          ) : detail.data ? (
            <VoiceoverWorkspace
              key={detail.data.id}
              storyboard={detail.data}
              onDirtyChange={setDirty}
            />
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}

function VoiceoverWorkspace({
  storyboard,
  onDirtyChange,
}: {
  storyboard: Storyboard;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: api.listSecrets });
  const assets = useQuery({
    queryKey: ["voiceover-assets", storyboard.id],
    queryFn: () => api.listVoiceoverAssets(storyboard.id),
  });
  const [scenes, setScenes] = useState<Scene[]>(() => storyboard.scenes);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    storyboard.scenes[0]?.id ?? null,
  );
  const [dirty, setDirty] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [generating, setGenerating] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const voiceover = selectedScene?.voiceover ?? null;
  const hasTtsKey = (secrets.data ?? []).some(
    (secret) => secret.name === "tts.api_key" || secret.name === "ai.api_key",
  );
  const sceneNumber = selectedScene ? scenes.findIndex((scene) => scene.id === selectedScene.id) + 1 : 0;

  const voiceGroups = useMemo(() => {
    const preferred = voices.filter((voice) => /^(id|en)/i.test(voice.lang));
    const others = voices.filter((voice) => !preferred.includes(voice));
    return [...preferred, ...others];
  }, [voices]);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      utteranceRef.current = null;
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  useEffect(() => {
    stopSpeaking();
    // The selected scene is intentionally the only trigger: changing voice
    // settings should not interrupt a preview that is already playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSceneId]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    setBeforeNavigate(() => window.confirm("Discard unsaved voiceover changes?"));
    return () => {
      window.removeEventListener("beforeunload", warn);
      setBeforeNavigate(null);
    };
  }, [dirty]);

  function stopSpeaking() {
    if (!supported) return;
    utteranceRef.current = null;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }

  function updateVoiceover(patch: Partial<Voiceover>) {
    if (!selectedScene) return;
    setScenes((current) =>
      current.map((scene) =>
        scene.id === selectedScene.id
          ? { ...scene, voiceover: { ...scene.voiceover, ...patch } }
          : scene,
      ),
    );
    setDirty(true);
  }

  function speak() {
    if (!supported) {
      toast.error("System speech is unavailable", "Use provider generation to create an audio file instead.");
      return;
    }
    const text = voiceover?.text.trim();
    if (!text) {
      toast.error("Nothing to preview", "Write a voiceover line for this scene first.");
      return;
    }
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    const chosen =
      voices.find((voice) => voice.name === voiceover?.voice) ||
      voices.find((voice) => voice.default) ||
      voices[0];
    if (chosen) {
      utterance.voice = chosen;
      utterance.lang = chosen.lang;
    }
    utterance.rate = voiceover?.rate ?? 1;
    utterance.pitch = voiceover?.pitch ?? 1;
    utterance.volume = voiceover?.volume ?? 1;
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
    };
    utterance.onerror = (event) => {
      // `cancel` and `interrupted` are emitted for user-initiated stops (stop
      // button, new line, unmount). Only surface genuine engine failures.
      const cancelled =
        utteranceRef.current !== utterance ||
        event.error === "canceled" ||
        event.error === "interrupted";
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      if (!cancelled) {
        toast.error("Preview stopped", "The system speech engine could not finish this line.");
      }
    };
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
    setPaused(false);
  }

  function togglePause() {
    if (!supported || !speaking) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setPaused(false);
    } else {
      window.speechSynthesis.pause();
      setPaused(true);
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateStoryboard(storyboard.id, {
        ...storyboardToInput(storyboard),
        scenes,
      }),
    onSuccess: (saved) => {
      setScenes(saved.scenes);
      setDirty(false);
      toast.success("Voiceover saved", "The script and voice settings are stored with the storyboard.");
      void queryClient.invalidateQueries({ queryKey: ["storyboards"] });
      void queryClient.invalidateQueries({ queryKey: ["storyboard", saved.id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error("Could not save voiceover", toApiError(error).message),
  });

  async function generateAudio() {
    if (!selectedScene || !voiceover?.text.trim()) {
      toast.error("Nothing to generate", "Write a voiceover line for this scene first.");
      return;
    }
    if (!hasTtsKey) {
      toast.error("TTS provider is not configured", "Add a tts.api_key or ai.api_key secret in Settings.");
      return;
    }
    setGenerating(true);
    try {
      if (dirty) {
        const saved = await saveMutation.mutateAsync();
        const savedScene = saved.scenes.find((scene) => scene.id === selectedScene.id);
        if (savedScene) {
          setScenes(saved.scenes);
          setSelectedSceneId(savedScene.id);
        }
      }
      const format = settings.data?.ttsFormat ?? "mp3";
      const path = await save({
        defaultPath: `${slugify(selectedScene.title || storyboard.title, "voiceover")}.${format}`,
        filters: [{ name: `${format.toUpperCase()} audio`, extensions: [format] }],
      });
      if (!path) return;
      const asset = await api.synthesizeVoiceover(
        voiceover.text,
        path,
        storyboard.id,
        selectedScene.id,
      );
      toast.success("Voiceover generated", `${formatBytes(asset.bytes)} written to disk.`);
      void queryClient.invalidateQueries({ queryKey: ["voiceover-assets", storyboard.id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (error) {
      toast.error("Could not generate voiceover", toApiError(error).message);
    } finally {
      setGenerating(false);
    }
  }

  const deleteAsset = useMutation({
    mutationFn: (id: string) => api.deleteVoiceoverAsset(id),
    onSuccess: () => {
      toast.success("Audio reference removed", "The file itself was left untouched on disk.");
      void queryClient.invalidateQueries({ queryKey: ["voiceover-assets", storyboard.id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error("Could not remove audio reference", toApiError(error).message),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(260px,330px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <Card className="overflow-hidden">
          <CardHeader
            title={storyboard.title}
            description={storyboard.logline || "No logline yet."}
            actions={<Badge tone={dirty ? "warning" : "success"}>{dirty ? "Unsaved" : "Saved"}</Badge>}
          />
          <div className="max-h-[360px] overflow-y-auto border-t border-line/60">
            {scenes.length === 0 ? (
              <p className="p-4 text-xs text-faint">This storyboard has no scenes.</p>
            ) : (
              <ul className="divide-y divide-line/50">
                {scenes.map((scene, index) => {
                  const active = scene.id === selectedSceneId;
                  const hasScript = scene.voiceover.text.trim().length > 0;
                  return (
                    <li key={scene.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedSceneId(scene.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors",
                          active ? "bg-raised/90" : "hover:bg-raised/45",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[9px] font-semibold",
                            active
                              ? "border-accent/30 bg-accent/10 text-accent"
                              : "border-line bg-panel text-faint",
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-medium text-fg">
                            {sceneLabel(scene, index)}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted">
                            {hasScript ? scene.voiceover.text : "No voiceover script"}
                          </span>
                        </span>
                        {hasScript ? <Mic2 size={12} className="mt-1 shrink-0 text-accent" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-line/60 p-3">
            <Button
              className="w-full"
              variant="secondary"
              size="sm"
              icon={<Save size={13} />}
              loading={saveMutation.isPending}
              disabled={!dirty}
              onClick={() => saveMutation.mutate()}
            >
              Save voiceover
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Generated audio"
            description="Files created through your TTS provider for this storyboard."
            actions={
              <IconButton
                label="Refresh audio references"
                size="sm"
                onClick={() => void assets.refetch()}
              >
                {assets.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              </IconButton>
            }
          />
          {assets.isLoading ? (
            <div className="p-4 text-xs text-muted">Loading audio references…</div>
          ) : assets.isError ? (
            <div className="p-4 text-xs text-danger">{assets.error.message}</div>
          ) : (assets.data?.length ?? 0) === 0 ? (
            <p className="px-4 py-5 text-xs leading-5 text-faint">
              No generated audio yet. Provider generation creates a file on disk and keeps a reference here.
            </p>
          ) : (
            <ul className="divide-y divide-line/50">
              {(assets.data ?? []).map((asset) => (
                <li key={asset.id} className="flex items-start gap-2 px-4 py-3">
                  <AudioLines size={14} className="mt-0.5 shrink-0 text-info" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-fg">
                      {asset.path.split(/[\\/]/).pop()}
                    </p>
                    <p className="mt-0.5 text-[9.5px] text-faint">
                      {asset.format.toUpperCase()} · {formatBytes(asset.bytes)} · {relativeTime(asset.createdAt)}
                    </p>
                  </div>
                  <IconButton label="Open audio file" size="sm" onClick={() => void openPath(asset.path)}>
                    <FolderOpen size={12} />
                  </IconButton>
                  <IconButton
                    label="Remove audio reference"
                    size="sm"
                    onClick={() => {
                      if (window.confirm("Remove this audio reference? The file stays on disk.")) {
                        deleteAsset.mutate(asset.id);
                      }
                    }}
                  >
                    <Trash2 size={12} className="text-danger" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {selectedScene && voiceover ? (
        <Card className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
            <div>
              <SectionLabel>Scene {sceneNumber}</SectionLabel>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em] text-fg">
                {sceneLabel(selectedScene, sceneNumber - 1)}
              </h2>
              <p className="mt-1 text-[10.5px] text-muted">
                {selectedScene.location || "Unspecified location"}
                {selectedScene.timeOfDay ? ` · ${selectedScene.timeOfDay}` : ""}
              </p>
            </div>
            <Badge tone={voiceover.text.trim() ? "success" : "neutral"} dot>
              {voiceover.text.trim() ? "Script ready" : "No script"}
            </Badge>
          </div>

          <div className="space-y-5 p-5">
            <Field
              label="Voiceover script"
              hint={`${voiceover.text.length}/8,000 characters · saved with the scene`}
            >
              <Textarea
                value={voiceover.text}
                onChange={(event) => updateVoiceover({ text: event.target.value })}
                rows={6}
                maxLength={8000}
                placeholder="Write the line exactly as it should be spoken. Keep it short enough to breathe."
                className="text-[13px] leading-6"
              />
            </Field>

            {selectedScene.shots.some((shot) => shot.dialogue.trim()) ? (
              <div className="rounded-lg border border-line/70 bg-surface/50 p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">
                  Dialogue in this scene
                </p>
                <ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-muted">
                  {selectedScene.shots
                    .filter((shot) => shot.dialogue.trim())
                    .map((shot, index) => (
                      <li key={shot.id}>
                        <span className="font-mono text-[9px] text-faint">SHOT {index + 1}</span>{" "}
                        {shot.dialogue}
                      </li>
                    ))}
                </ul>
                <p className="mt-2 text-[9.5px] text-faint">
                  Copy a line into the voiceover field to preview it with the controls below.
                </p>
              </div>
            ) : null}

            <div className="rounded-xl border border-line/75 bg-surface/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Volume2 size={15} className="text-accent" />
                  <div>
                    <p className="text-xs font-medium text-fg">System speech preview</p>
                    <p className="text-[9.5px] text-faint">
                      Local playback only · no audio file is created
                    </p>
                  </div>
                </div>
                {!supported ? (
                  <Badge tone="warning">Unavailable in this webview</Badge>
                ) : (
                  <Badge tone="neutral">{voices.length} system voices</Badge>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Voice">
                  <Select
                    value={voiceover.voice}
                    onChange={(event) => updateVoiceover({ voice: event.target.value })}
                    disabled={!supported || voices.length === 0}
                  >
                    <option value="">System default</option>
                    {voiceGroups.map((voice) => (
                      <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                        {voice.name} · {voice.lang}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <SliderField
                    label="Rate"
                    value={voiceover.rate}
                    min={0.5}
                    max={2}
                    step={0.05}
                    onChange={(value) => updateVoiceover({ rate: value })}
                  />
                  <SliderField
                    label="Pitch"
                    value={voiceover.pitch}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(value) => updateVoiceover({ pitch: value })}
                  />
                  <SliderField
                    label="Volume"
                    value={voiceover.volume}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(value) => updateVoiceover({ volume: value })}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Play size={13} />}
                  disabled={!supported || !voiceover.text.trim() || speaking}
                  onClick={speak}
                >
                  Preview
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Pause size={13} />}
                  disabled={!speaking}
                  onClick={togglePause}
                >
                  {paused ? "Resume" : "Pause"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Square size={12} />}
                  disabled={!speaking}
                  onClick={stopSpeaking}
                >
                  Stop
                </Button>
                {speaking ? (
                  <span className="ml-auto inline-flex items-center gap-1.5 self-center text-[10px] text-accent">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    {paused ? "Paused" : "Speaking"}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-info/20 bg-info/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AudioLines size={16} className="mt-0.5 text-info" />
                  <div>
                    <p className="text-xs font-medium text-fg">Generate an audio file</p>
                    <p className="mt-1 max-w-xl text-[10.5px] leading-5 text-muted">
                      Uses the OpenAI-compatible endpoint in Settings. The provider must support{" "}
                      <code className="rounded bg-raised px-1 py-0.5 font-mono text-[9px]">/audio/speech</code>.
                      You choose the destination file before the provider request.
                    </p>
                  </div>
                </div>
                <Badge tone={hasTtsKey ? "success" : "warning"} dot>
                  {hasTtsKey ? "Key configured" : "No TTS key"}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  icon={generating ? <Loader2 size={13} className="animate-spin" /> : <Mic2 size={13} />}
                  loading={generating}
                  disabled={!voiceover.text.trim()}
                  onClick={() => void generateAudio()}
                >
                  Generate {settings.data?.ttsFormat?.toUpperCase() ?? "MP3"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate("/settings?tab=integrations")}>
                  Configure TTS
                </Button>
                {!hasTtsKey ? (
                  <span className="inline-flex items-center gap-1 text-[9.5px] text-warn">
                    <AlertTriangle size={10} /> Add a secret named tts.api_key or ai.api_key.
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<Mic2 size={18} />}
            title="Select a scene"
            description="Choose a scene from the left to write and preview its voiceover."
          />
        </Card>
      )}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[9.5px] uppercase tracking-[0.08em] text-muted">
        {label}
        <span className="numeric text-faint">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-[var(--accent)]"
        aria-label={`${label} ${value.toFixed(2)}`}
      />
    </label>
  );
}
