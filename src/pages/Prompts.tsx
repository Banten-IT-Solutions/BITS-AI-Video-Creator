import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  Check,
  Copy,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
  Select,
  Textarea,
  Toggle,
  cn,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Prompt, PromptInput } from "../lib/types";

const COLORS = [
  { id: "default", label: "Neutral", className: "border-line/80 bg-panel" },
  { id: "blue", label: "Blue", className: "border-info/30 bg-info/[0.045]" },
  { id: "green", label: "Green", className: "border-accent/30 bg-accent/[0.045]" },
  { id: "amber", label: "Amber", className: "border-warn/30 bg-warn/[0.045]" },
  { id: "violet", label: "Violet", className: "border-violet-400/30 bg-violet-400/[0.05]" },
  { id: "rose", label: "Rose", className: "border-rose-400/30 bg-rose-400/[0.05]" },
  { id: "slate", label: "Slate", className: "border-slate-400/25 bg-slate-400/[0.04]" },
] as const;

function colorClass(color: string): string {
  return COLORS.find((item) => item.id === color)?.className ?? COLORS[0].className;
}

function PromptModal({
  open,
  prompt,
  categories,
  onClose,
}: {
  open: boolean;
  prompt: Prompt | null;
  categories: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [pinned, setPinned] = useState(false);
  const [cardColor, setCardColor] = useState<string>("default");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(prompt?.title ?? "");
    setBody(prompt?.prompt ?? "");
    setCategory(prompt?.category ?? "");
    setPinned(prompt?.pinned ?? false);
    setCardColor(prompt?.cardColor ?? "default");
    setError(null);
  }, [open, prompt]);

  const save = useMutation({
    mutationFn: () => {
      const input: PromptInput = {
        title: title.trim(),
        prompt: body.trim(),
        category: category.trim(),
        pinned,
        cardColor,
      };
      return prompt ? api.updatePrompt(prompt.id, input) : api.createPrompt(input);
    },
    onSuccess: (saved) => {
      toast.success(prompt ? "Prompt updated" : "Prompt created", saved.title);
      void queryClient.invalidateQueries({ queryKey: ["prompts"] });
      onClose();
    },
    onError: (cause) => setError(toApiError(cause).message),
  });

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => undefined : onClose}
      closeOnBackdrop={!save.isPending}
      title={prompt ? "Edit prompt" : "New prompt"}
      description="Prompts are local reference text. They are never sent anywhere unless you paste them into a tool or workflow."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!title.trim() || !body.trim()}
            onClick={() => save.mutate()}
          >
            {prompt ? "Save changes" : "Create prompt"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" hint={`${title.length}/200 characters`}>
          <Input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            maxLength={200}
            placeholder="Cinematic product shot"
            autoFocus
          />
        </Field>
        <Field label="Prompt" hint={`${body.length}/100,000 characters`}>
          <Textarea
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setError(null);
            }}
            rows={10}
            maxLength={100_000}
            placeholder="Describe the prompt, including reusable variables and constraints."
            className="min-h-[220px] font-mono text-[12px] leading-5"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" hint="Optional. Up to 100 characters.">
            <Input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={100}
              placeholder="Video"
              list="prompt-categories"
            />
            <datalist id="prompt-categories">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </Field>
          <Field label="Card color">
            <Select value={cardColor} onChange={(event) => setCardColor(event.target.value)}>
              {COLORS.map((color) => (
                <option key={color.id} value={color.id}>
                  {color.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Toggle
          checked={pinned}
          onChange={setPinned}
          label="Pin to the top"
          description="Pinned prompts stay above the rest of the library."
        />
        {error ? (
          <p className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs leading-5 text-danger">{error}</p>
        ) : null}
      </div>
    </Modal>
  );
}

export function PromptsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const prompts = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api.listPrompts(),
  });

  const categories = useMemo(
    () => Array.from(new Set((prompts.data ?? []).map((item) => item.category).filter(Boolean))).sort(),
    [prompts.data],
  );

  const visible = (prompts.data ?? []).filter((item) => {
    if (category && item.category !== category) return false;
    const text = deferredQuery.trim().toLowerCase();
    if (!text) return true;
    return (
      item.title.toLowerCase().includes(text) ||
      item.prompt.toLowerCase().includes(text) ||
      item.category.toLowerCase().includes(text)
    );
  });

  const togglePin = useMutation({
    mutationFn: (item: Prompt) => api.setPromptPinned(item.id, !item.pinned),
    onSuccess: (item) => {
      toast.success(item.pinned ? "Prompt pinned" : "Prompt unpinned", item.title);
      void queryClient.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (cause) => toast.error("Unable to update prompt", toApiError(cause).message),
  });

  const remove = useMutation({
    mutationFn: (item: Prompt) => api.deletePrompt(item.id),
    onSuccess: (_result, item) => {
      toast.success("Prompt deleted", item.title);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (cause) => toast.error("Unable to delete prompt", toApiError(cause).message),
  });

  const copy = async (item: Prompt) => {
    try {
      await navigator.clipboard.writeText(item.prompt);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1800);
    } catch {
      toast.error("Clipboard unavailable", "Select and copy the prompt text manually.");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Library"
        title="Prompt library"
        description="Reusable local prompts for provider tools and AI drafting. Values stay in SQLite and are never uploaded."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={openCreate}>
            New prompt
          </Button>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, prompt text, categories…"
            className="h-9 pl-8"
            aria-label="Search prompts"
          />
        </div>
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="h-9 w-[190px]"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <span className="numeric text-[10px] text-faint">
          {visible.length} of {prompts.data?.length ?? 0}
        </span>
      </div>

      {prompts.isLoading ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="h-48 animate-pulse rounded-xl border border-line/60 bg-raised/30" />
          ))}
        </div>
      ) : prompts.isError ? (
        <Card className="mt-4 border-danger/30 p-4 text-xs text-danger">{prompts.error.message}</Card>
      ) : visible.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<BookOpenText size={20} />}
            title={prompts.data?.length ? "No matching prompts" : "Your library is empty"}
            description={
              prompts.data?.length
                ? "Adjust the search or category filter."
                : "Save a reusable prompt once, then copy it into a provider tool or use it as a starting point for AI drafting."
            }
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
                New prompt
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <Card key={item.id} className={cn("flex flex-col", colorClass(item.cardColor))}>
              <div className="flex items-start justify-between gap-3 border-b border-line/50 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {item.pinned ? <Pin size={11} className="shrink-0 text-accent" /> : null}
                    <h2 className="truncate text-[13px] font-semibold text-fg">{item.title}</h2>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {item.category ? <Badge tone="neutral">{item.category}</Badge> : null}
                    <span className="text-[9.5px] text-faint">{formatDateTime(item.updatedAt)}</span>
                  </div>
                </div>
                <IconButton
                  label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
                  size="sm"
                  onClick={() => togglePin.mutate(item)}
                  disabled={togglePin.isPending}
                >
                  {item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </IconButton>
              </div>
              <p className="line-clamp-6 flex-1 whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-[18px] text-muted">
                {item.prompt}
              </p>
              <div className="flex items-center justify-between gap-2 border-t border-line/50 px-3 py-2">
                <span className="numeric text-[9.5px] text-faint">{item.prompt.length.toLocaleString()} chars</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" icon={copiedId === item.id ? <Check size={12} /> : <Copy size={12} />} onClick={() => void copy(item)}>
                    {copiedId === item.id ? "Copied" : "Copy"}
                  </Button>
                  <IconButton
                    label={`Edit ${item.title}`}
                    size="sm"
                    onClick={() => {
                      setEditing(item);
                      setModalOpen(true);
                    }}
                  >
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton label={`Delete ${item.title}`} size="sm" tone="danger" onClick={() => setDeleteTarget(item)}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <PromptModal open={modalOpen} prompt={editing} categories={categories} onClose={() => setModalOpen(false)} />
      <ConfirmDialog
        open={deleteTarget != null}
        title="Delete prompt"
        description={
          <>
            Permanently remove <strong className="text-fg">{deleteTarget?.title}</strong> from the local library. This
            cannot be undone.
          </>
        }
        confirmLabel="Delete prompt"
        busy={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
