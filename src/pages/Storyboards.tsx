import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  FileJson,
  FileText,
  Loader2,
  Mic2,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SectionLabel,
  Select,
  Textarea,
  cn,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { relativeTime } from "../lib/format";
import { setBeforeNavigate } from "../lib/router";
import {
  cloneValue,
  formatDuration,
  newScene,
  newShot,
  slugify,
  storyboardCounts,
  storyboardToInput,
  type StoryboardDraft,
} from "../lib/studio";
import type { Scene, Shot, Storyboard, StoryboardInput } from "../lib/types";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5", "21:9"];

export function StoryboardsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const list = useQuery({ queryKey: ["storyboards"], queryFn: api.listStoryboards });
  const detail = useQuery({
    queryKey: ["storyboard", selectedId],
    queryFn: () => api.getStoryboard(selectedId as string),
    enabled: selectedId != null,
  });

  useEffect(() => {
    if (!list.data) return;
    if (selectedId && list.data.some((item) => item.id === selectedId)) return;
    setSelectedId(list.data[0]?.id ?? null);
  }, [list.data, selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list.data ?? [];
    return (list.data ?? []).filter((item) =>
      `${item.title} ${item.logline} ${item.style}`.toLowerCase().includes(query),
    );
  }, [list.data, search]);

  function selectStoryboard(id: string) {
    if (id === selectedId) return;
    if (dirty && !window.confirm("This storyboard has unsaved changes. Discard them?")) return;
    setDirty(false);
    setSelectedId(id);
  }

  function refresh(saved?: Storyboard) {
    void queryClient.invalidateQueries({ queryKey: ["storyboards"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    if (saved) {
      setSelectedId(saved.id);
      void queryClient.invalidateQueries({ queryKey: ["storyboard", saved.id] });
    }
  }

  const create = useMutation({
    mutationFn: (input: StoryboardInput) => api.createStoryboard(input),
    onSuccess: (storyboard) => {
      toast.success("Storyboard created", "Start adding scenes, prompts, and voiceover.");
      setCreateOpen(false);
      refresh(storyboard);
    },
    onError: (error) => toast.error("Could not create storyboard", toApiError(error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteStoryboard(id),
    onSuccess: () => {
      toast.success("Storyboard deleted", "Its generated voiceover files remain on disk.");
      setSelectedId(null);
      setDirty(false);
      refresh();
    },
    onError: (error) => toast.error("Could not delete storyboard", toApiError(error).message),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.duplicateStoryboard(id),
    onSuccess: (storyboard) => {
      toast.success("Storyboard duplicated", "The copy is independent and ready to edit.");
      refresh(storyboard);
    },
    onError: (error) => toast.error("Could not duplicate storyboard", toApiError(error).message),
  });

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Native studio"
        title="Storyboards"
        description="Shape a video from scene to shot. Every prompt, camera note, and voiceover line is stored locally in your own library."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>
            New storyboard
          </Button>
        }
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(248px,310px)_minmax(0,1fr)]">
        <aside className="min-w-0">
          <Card className="overflow-hidden">
            <div className="border-b border-line/70 p-3">
              <label className="relative block">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find a storyboard…"
                  className="pl-9"
                  aria-label="Search storyboards"
                />
              </label>
            </div>
            {list.isLoading ? (
              <div className="flex items-center justify-center p-8 text-xs text-muted">
                <Loader2 size={14} className="mr-2 animate-spin text-accent" /> Loading library…
              </div>
            ) : list.isError ? (
              <div className="p-4 text-xs leading-5 text-danger">{list.error.message}</div>
            ) : filtered.length === 0 ? (
              <div className="p-5">
                <p className="text-xs leading-5 text-muted">
                  {list.data?.length === 0
                    ? "Your studio is empty. Create a storyboard to begin."
                    : "No storyboard matches this search."}
                </p>
                {list.data?.length === 0 ? (
                  <Button className="mt-3" size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
                    Create the first one
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="max-h-[calc(100vh-290px)] divide-y divide-line/50 overflow-y-auto">
                {filtered.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => selectStoryboard(item.id)}
                      aria-current={selectedId === item.id ? "true" : undefined}
                      className={cn(
                        "group w-full px-4 py-3.5 text-left transition-colors",
                        selectedId === item.id ? "bg-raised/90" : "hover:bg-raised/45",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-[12.5px] font-medium leading-5 text-fg">
                          {item.title}
                        </span>
                        <ChevronRight
                          size={13}
                          className={cn(
                            "mt-1 shrink-0",
                            selectedId === item.id ? "text-accent" : "text-faint",
                          )}
                        />
                      </div>
                      {item.logline ? (
                        <p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-muted">{item.logline}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] text-faint">
                        <span>{item.sceneCount} scenes</span>
                        <span>·</span>
                        <span>{item.shotCount} shots</span>
                        <span>·</span>
                        <span>{formatDuration(item.totalDurationSeconds)}</span>
                      </div>
                      <p className="mt-1 text-[9.5px] text-faint">Edited {relativeTime(item.updatedAt)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="mt-2 px-1 text-[9.5px] leading-4 text-faint">
            Storyboards are SQLite-backed. Export a clean Markdown brief or a JSON snapshot at any time.
          </p>
        </aside>

        <section className="min-w-0">
          {detail.isLoading && selectedId ? (
            <Card>
              <div className="flex items-center justify-center p-20 text-xs text-muted">
                <Loader2 size={15} className="mr-2 animate-spin text-accent" /> Loading storyboard…
              </div>
            </Card>
          ) : detail.isError ? (
            <Card className="border-danger/30">
              <div className="p-6">
                <p className="text-sm font-medium text-fg">Could not open this storyboard</p>
                <p className="mt-2 text-xs leading-5 text-muted">{detail.error.message}</p>
                <Button className="mt-4" variant="secondary" onClick={() => void detail.refetch()}>
                  Try again
                </Button>
              </div>
            </Card>
          ) : detail.data ? (
            <StoryboardEditor
              key={detail.data.id}
              storyboard={detail.data}
              onSaved={refresh}
              onDeleted={() => remove.mutate(detail.data.id)}
              onDuplicated={() => duplicate.mutate(detail.data.id)}
              onDirtyChange={setDirty}
              busy={remove.isPending || duplicate.isPending}
            />
          ) : (
            <Card>
              <EmptyState
                icon={<Clapperboard size={20} />}
                title="A blank frame is waiting"
                description="Create a storyboard to sketch scenes, write shots, and attach a voiceover to every scene."
                action={
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                    New storyboard
                  </Button>
                }
              />
            </Card>
          )}
        </section>
      </div>

      <CreateStoryboardDialog
        open={createOpen}
        busy={create.isPending}
        onClose={() => setCreateOpen(false)}
        onCreate={(input) => create.mutate(input)}
      />
    </PageContainer>
  );
}

function CreateStoryboardDialog({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: StoryboardInput) => void;
}) {
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [style, setStyle] = useState("Cinematic");
  const [aspectRatio, setAspectRatio] = useState("16:9");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setLogline("");
    setStyle("Cinematic");
    setAspectRatio("16:9");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="New storyboard"
      description="Give the piece a working title. You can change everything later."
      size="md"
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!title.trim()}
            onClick={() =>
              onCreate({
                title,
                logline,
                style,
                aspectRatio,
                scenes: [newScene(1)],
              })
            }
          >
            Create storyboard
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The last light over Banten"
            autoFocus
            maxLength={120}
          />
        </Field>
        <Field label="Logline" hint="One or two sentences that keep the edit focused.">
          <Textarea
            value={logline}
            onChange={(event) => setLogline(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="A courier crosses the coast before sunset to deliver a message that changes everything."
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Visual style">
            <Input
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              maxLength={120}
              placeholder="Warm cinematic"
            />
          </Field>
          <Field label="Aspect ratio">
            <Select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
              {ASPECT_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function StoryboardEditor({
  storyboard,
  onSaved,
  onDeleted,
  onDuplicated,
  onDirtyChange,
  busy,
}: {
  storyboard: Storyboard;
  onSaved: (storyboard?: Storyboard) => void;
  onDeleted: () => void;
  onDuplicated: () => void;
  onDirtyChange: (dirty: boolean) => void;
  busy: boolean;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<StoryboardDraft>(() => storyboardToInput(storyboard));
  const [dirty, setDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"markdown" | "json" | null>(null);
  const counts = storyboardCounts(draft.scenes);

  useEffect(() => {
    setDraft(storyboardToInput(storyboard));
    setDirty(false);
  }, [storyboard]);

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
    setBeforeNavigate(() => window.confirm("Discard unsaved storyboard changes?"));
    return () => {
      window.removeEventListener("beforeunload", warn);
      setBeforeNavigate(null);
    };
  }, [dirty]);

  const saveMutation = useMutation({
    mutationFn: () => api.updateStoryboard(storyboard.id, draft),
    onSuccess: (saved) => {
      setDraft(storyboardToInput(saved));
      setDirty(false);
      toast.success("Storyboard saved", "Scenes and voiceover notes are stored locally.");
      onSaved(saved);
    },
    onError: (error) => toast.error("Could not save storyboard", toApiError(error).message),
  });

  function patch(next: Partial<StoryboardDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  function patchScene(sceneId: string, next: Partial<Scene>) {
    patch({
      scenes: draft.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...next } : scene)),
    });
  }

  function patchShot(sceneId: string, shotId: string, next: Partial<Shot>) {
    patch({
      scenes: draft.scenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              shots: scene.shots.map((shot) => (shot.id === shotId ? { ...shot, ...next } : shot)),
            }
          : scene,
      ),
    });
  }

  function addScene() {
    patch({ scenes: [...draft.scenes, newScene(draft.scenes.length + 1)] });
  }

  function removeScene(sceneId: string) {
    patch({ scenes: draft.scenes.filter((scene) => scene.id !== sceneId) });
  }

  function moveScene(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= draft.scenes.length) return;
    const scenes = cloneValue(draft.scenes);
    [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
    patch({ scenes });
  }

  function addShot(sceneId: string) {
    patchScene(sceneId, {
      shots: [...(draft.scenes.find((scene) => scene.id === sceneId)?.shots ?? []), newShot()],
    });
  }

  function removeShot(sceneId: string, shotId: string) {
    const scene = draft.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    patchScene(sceneId, { shots: scene.shots.filter((shot) => shot.id !== shotId) });
  }

  function moveShot(sceneId: string, index: number, delta: number) {
    const scene = draft.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const target = index + delta;
    if (target < 0 || target >= scene.shots.length) return;
    const shots = cloneValue(scene.shots);
    [shots[index], shots[target]] = [shots[target], shots[index]];
    patchScene(sceneId, { shots });
  }

  async function exportStoryboard(format: "markdown" | "json") {
    setExporting(format);
    try {
      let saved = storyboard;
      if (dirty) saved = await saveMutation.mutateAsync();
      const extension = format === "json" ? "json" : "md";
      const path = await save({
        defaultPath: `${slugify(saved.title)}.${extension}`,
        filters: [
          {
            name: format === "json" ? "Storyboard JSON" : "Storyboard brief",
            extensions: [extension],
          },
        ],
      });
      if (!path) return;
      await api.exportStoryboard(saved.id, path, format);
      setExportOpen(false);
      toast.success("Storyboard exported", format === "json" ? "JSON snapshot written." : "Markdown brief written.");
    } catch (error) {
      toast.error("Could not export storyboard", toApiError(error).message);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel>Storyboard</SectionLabel>
              <Badge tone={dirty ? "warning" : "success"} dot>
                {dirty ? "Unsaved" : "Saved"}
              </Badge>
            </div>
            <h2 className="mt-1 line-clamp-2 text-lg font-semibold tracking-[-0.01em] text-fg">
              {draft.title || "Untitled storyboard"}
            </h2>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-faint">
              <span>{counts.scenes} scenes</span>
              <span>{counts.shots} shots</span>
              <span>{formatDuration(counts.durationSeconds)}</span>
              <span>Aspect {draft.aspectRatio}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={14} />}
              loading={saveMutation.isPending}
              disabled={!dirty}
              onClick={() => saveMutation.mutate()}
            >
              Save
            </Button>
            <IconButton label="Duplicate storyboard" size="sm" onClick={onDuplicated} disabled={busy}>
              <Copy size={14} />
            </IconButton>
            <IconButton label="Export storyboard" size="sm" onClick={() => setExportOpen(true)}>
              <Download size={14} />
            </IconButton>
            <IconButton label="Delete storyboard" size="sm" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 size={14} className="text-danger" />
            </IconButton>
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[1.5fr_1fr_130px]">
          <Field label="Title">
            <Input
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              maxLength={120}
              className="text-[15px] font-medium"
            />
          </Field>
          <Field label="Visual style">
            <Input
              value={draft.style}
              onChange={(event) => patch({ style: event.target.value })}
              maxLength={120}
            />
          </Field>
          <Field label="Aspect ratio">
            <Select
              value={draft.aspectRatio}
              onChange={(event) => patch({ aspectRatio: event.target.value })}
            >
              {ASPECT_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio}
                </option>
              ))}
            </Select>
          </Field>
          <div className="lg:col-span-3">
            <Field label="Logline" hint={`${draft.logline.length}/500`}>
              <Textarea
                value={draft.logline}
                onChange={(event) => patch({ logline: event.target.value })}
                rows={2}
                maxLength={500}
                placeholder="What changes between the first frame and the last?"
              />
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Scenes</h3>
          <p className="mt-0.5 text-[10.5px] text-muted">
            Each scene holds shots, camera language, dialogue, and one voiceover script.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addScene}>
          Add scene
        </Button>
      </div>

      {draft.scenes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Clapperboard size={18} />}
            title="No scenes yet"
            description="Add a scene, then break it into shots. A scene can be as small as one image or as large as a sequence."
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={addScene}>
                Add the first scene
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {draft.scenes.map((scene, sceneIndex) => (
            <Card key={scene.id} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line/70 bg-raised/35 px-4 py-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-[10px] font-semibold text-accent">
                  {sceneIndex + 1}
                </span>
                <Input
                  value={scene.title}
                  onChange={(event) => patchScene(scene.id, { title: event.target.value })}
                  maxLength={160}
                  aria-label={`Scene ${sceneIndex + 1} title`}
                  className="h-8 min-w-[150px] flex-1 border-transparent bg-transparent px-2 text-[12.5px] font-medium focus:border-line focus:bg-surface"
                  placeholder={`Scene ${sceneIndex + 1}`}
                />
                <div className="flex items-center gap-0.5">
                  <IconButton
                    label="Move scene up"
                    size="sm"
                    disabled={sceneIndex === 0}
                    onClick={() => moveScene(sceneIndex, -1)}
                  >
                    <ArrowUp size={13} />
                  </IconButton>
                  <IconButton
                    label="Move scene down"
                    size="sm"
                    disabled={sceneIndex === draft.scenes.length - 1}
                    onClick={() => moveScene(sceneIndex, 1)}
                  >
                    <ArrowDown size={13} />
                  </IconButton>
                  <IconButton label="Remove scene" size="sm" onClick={() => removeScene(scene.id)}>
                    <Trash2 size={13} className="text-danger" />
                  </IconButton>
                </div>
              </div>

              <div className="space-y-4 p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="md:col-span-3">
                    <Field label="Scene direction">
                      <Textarea
                        value={scene.description}
                        onChange={(event) => patchScene(scene.id, { description: event.target.value })}
                        rows={2}
                        maxLength={2000}
                        placeholder="What the audience sees and feels in this scene."
                      />
                    </Field>
                  </div>
                  <Field label="Location">
                    <Input
                      value={scene.location}
                      onChange={(event) => patchScene(scene.id, { location: event.target.value })}
                      maxLength={2000}
                      placeholder="Harbour at dawn"
                    />
                  </Field>
                  <Field label="Time of day">
                    <Input
                      value={scene.timeOfDay}
                      onChange={(event) => patchScene(scene.id, { timeOfDay: event.target.value })}
                      maxLength={2000}
                      placeholder="Blue hour"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Badge tone="neutral">{scene.shots.length} shots</Badge>
                  </div>
                </div>

                <div className="rounded-xl border border-line/75 bg-surface/40 p-3">
                  <div className="flex items-center gap-2">
                    <Mic2 size={14} className="text-accent" />
                    <span className="text-[11px] font-medium text-fg">Voiceover</span>
                    <span className="text-[9.5px] text-faint">Optional · one script per scene</span>
                  </div>
                  <Textarea
                    className="mt-2"
                    value={scene.voiceover.text}
                    onChange={(event) =>
                      patchScene(scene.id, {
                        voiceover: { ...scene.voiceover, text: event.target.value },
                      })
                    }
                    rows={2}
                    maxLength={8000}
                    placeholder="The line that carries this scene…"
                    aria-label={`Scene ${sceneIndex + 1} voiceover`}
                  />
                </div>

                <div className="space-y-3">
                  {scene.shots.map((shot, shotIndex) => (
                    <div key={shot.id} className="rounded-xl border border-line/75 bg-panel/55 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[9.5px] text-faint">
                          SHOT {sceneIndex + 1}.{shotIndex + 1}
                        </span>
                        <div className="ml-auto flex items-center gap-0.5">
                          <IconButton
                            label="Move shot up"
                            size="sm"
                            disabled={shotIndex === 0}
                            onClick={() => moveShot(scene.id, shotIndex, -1)}
                          >
                            <ArrowUp size={12} />
                          </IconButton>
                          <IconButton
                            label="Move shot down"
                            size="sm"
                            disabled={shotIndex === scene.shots.length - 1}
                            onClick={() => moveShot(scene.id, shotIndex, 1)}
                          >
                            <ArrowDown size={12} />
                          </IconButton>
                          <IconButton
                            label="Remove shot"
                            size="sm"
                            onClick={() => removeShot(scene.id, shot.id)}
                          >
                            <Trash2 size={12} className="text-danger" />
                          </IconButton>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-[1fr_110px]">
                        <Field label="Shot description">
                          <Textarea
                            value={shot.description}
                            onChange={(event) =>
                              patchShot(scene.id, shot.id, { description: event.target.value })
                            }
                            rows={2}
                            maxLength={4000}
                            placeholder="Close on hands opening the envelope."
                          />
                        </Field>
                        <Field label="Duration" hint="1–600 sec">
                          <Input
                            type="number"
                            min={1}
                            max={600}
                            value={shot.durationSeconds}
                            onChange={(event) =>
                              patchShot(scene.id, shot.id, {
                                durationSeconds: Math.max(1, Math.min(600, Number(event.target.value) || 0)),
                              })
                            }
                          />
                        </Field>
                      </div>
                      <div className="mt-3">
                        <Field label="Generation prompt" hint="The visual instruction you would paste into a video model.">
                          <Textarea
                            value={shot.prompt}
                            onChange={(event) =>
                              patchShot(scene.id, shot.id, { prompt: event.target.value })
                            }
                            rows={3}
                            maxLength={4000}
                            placeholder="Warm 35mm film, low sun through harbour mist, intimate handheld close-up…"
                          />
                        </Field>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <Field label="Camera">
                          <Input
                            value={shot.camera}
                            onChange={(event) =>
                              patchShot(scene.id, shot.id, { camera: event.target.value })
                            }
                            maxLength={4000}
                            placeholder="Slow dolly in"
                          />
                        </Field>
                        <Field label="Dialogue">
                          <Input
                            value={shot.dialogue}
                            onChange={(event) =>
                              patchShot(scene.id, shot.id, { dialogue: event.target.value })
                            }
                            maxLength={4000}
                            placeholder="We start here."
                          />
                        </Field>
                        <Field label="Transition">
                          <Input
                            value={shot.transition}
                            onChange={(event) =>
                              patchShot(scene.id, shot.id, { transition: event.target.value })
                            }
                            maxLength={4000}
                            placeholder="Cut"
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus size={13} />}
                    onClick={() => addShot(scene.id)}
                  >
                    Add shot
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent-soft/20 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Mic2 size={15} className="text-accent" />
          <div>
            <p className="text-[11.5px] font-medium text-fg">Ready to hear it?</p>
            <p className="text-[10px] text-muted">Open Voiceover studio to preview or generate scene audio.</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={saveMutation.isPending}
          onClick={async () => {
            if (dirty) {
              try {
                await saveMutation.mutateAsync();
              } catch {
                return;
              }
            }
            window.location.hash = "/voiceover";
          }}
        >
          Open voiceover
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete storyboard?"
        description={
          <>
            <strong className="text-fg">{storyboard.title}</strong> and its scene plan will be removed from this
            device. Generated audio files stay where they were saved.
          </>
        }
        confirmLabel="Delete storyboard"
        confirmationLabel={storyboard.title}
        busy={busy}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          onDeleted();
        }}
      />

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export storyboard"
        description="Choose a format. A Markdown brief is readable anywhere; JSON preserves the full edit."
        size="sm"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="rounded-xl border border-line bg-surface/60 p-4 text-left transition-colors hover:border-accent/35 hover:bg-raised"
            disabled={exporting != null}
            onClick={() => void exportStoryboard("markdown")}
          >
            <FileText size={17} className="text-accent" />
            <p className="mt-2 text-xs font-medium text-fg">Markdown brief</p>
            <p className="mt-1 text-[10px] leading-4 text-muted">Scenes, shots, prompts, and voiceover in one document.</p>
            {exporting === "markdown" ? <Loader2 size={13} className="mt-2 animate-spin text-accent" /> : null}
          </button>
          <button
            type="button"
            className="rounded-xl border border-line bg-surface/60 p-4 text-left transition-colors hover:border-accent/35 hover:bg-raised"
            disabled={exporting != null}
            onClick={() => void exportStoryboard("json")}
          >
            <FileJson size={17} className="text-info" />
            <p className="mt-2 text-xs font-medium text-fg">JSON snapshot</p>
            <p className="mt-1 text-[10px] leading-4 text-muted">A portable backup of the complete storyboard model.</p>
            {exporting === "json" ? <Loader2 size={13} className="mt-2 animate-spin text-info" /> : null}
          </button>
        </div>
      </Modal>
    </div>
  );
}
