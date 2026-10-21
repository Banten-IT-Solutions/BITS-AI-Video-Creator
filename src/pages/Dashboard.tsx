import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Mic2,
  MonitorSmartphone,
  Plus,
  Play,
  RefreshCw,
  ScrollText,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { PageContainer } from "../components/Layout";
import { RunDetailDialog } from "../components/RunDetailDialog";
import { RunTable } from "../components/RunTable";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, SectionLabel } from "../components/ui";
import { api } from "../lib/api";
import { dayLabel, formatNumber, humanStatus, relativeTime, statusTone } from "../lib/format";
import { isAndroid } from "../lib/platform";
import { navigate } from "../lib/router";
import type { CountBucket, DayCount } from "../lib/types";

function StatCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
  tone?: "neutral" | "accent" | "info" | "danger";
}) {
  const tones = {
    neutral: "border-line/90",
    accent: "border-accent/25",
    info: "border-info/25",
    danger: "border-danger/25",
  };
  const icons = {
    neutral: "bg-raised text-muted",
    accent: "bg-accent/10 text-accent",
    info: "bg-info/10 text-info",
    danger: "bg-danger/10 text-danger",
  };
  return (
    <Card className={tones[tone]}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <SectionLabel>{label}</SectionLabel>
          <div className="numeric mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] text-fg">{value}</div>
          <div className="mt-2 text-[11px] leading-4 text-muted">{detail}</div>
        </div>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${icons[tone]}`}>{icon}</span>
      </div>
    </Card>
  );
}

function RunChart({ days }: { days: DayCount[] }) {
  const maximum = Math.max(1, ...days.map((day) => day.succeeded + day.failed));
  return (
    <div className="px-5 py-4">
      {days.length === 0 ? (
        <div className="flex h-[184px] items-center justify-center text-xs text-faint">
          No run activity recorded yet.
        </div>
      ) : (
        <div className="flex h-[184px] items-end gap-2.5" role="img" aria-label="Runs over the last seven days">
          {days.map((day) => {
            const total = day.succeeded + day.failed;
            const successHeight = total === 0 ? 0 : (day.succeeded / maximum) * 150;
            const failureHeight = total === 0 ? 0 : (day.failed / maximum) * 150;
            return (
              <div key={day.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="numeric text-[9.5px] text-faint">{total > 0 ? total : ""}</span>
                <div className="flex w-full max-w-[44px] items-end justify-center gap-[2px]">
                  <div
                    className="w-[46%] rounded-t-[3px] bg-accent/75"
                    style={{ height: Math.max(successHeight, day.succeeded > 0 ? 3 : 0) }}
                    title={`${day.succeeded} succeeded`}
                  />
                  <div
                    className="w-[46%] rounded-t-[3px] bg-danger/70"
                    style={{ height: Math.max(failureHeight, day.failed > 0 ? 3 : 0) }}
                    title={`${day.failed} failed`}
                  />
                </div>
                <span className="h-px w-full bg-line/70" />
                <span className="text-[10px] text-faint">{dayLabel(day.day)}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex items-center gap-4 border-t border-line/60 pt-3 text-[10px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-accent/75" /> Succeeded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-danger/70" /> Failed
        </span>
        <span className="ml-auto">Last 7 days</span>
      </div>
    </div>
  );
}

function BucketList({ buckets, empty }: { buckets: CountBucket[]; empty: string }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (buckets.length === 0) return <p className="px-5 py-6 text-xs text-faint">{empty}</p>;
  return (
    <div className="space-y-3 px-5 py-4">
      {buckets.map((bucket) => {
        const percentage = total === 0 ? 0 : Math.round((bucket.count / total) * 100);
        return (
          <div key={bucket.label}>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="capitalize text-muted">{bucket.label.replace(/-/g, " ")}</span>
              <span className="numeric text-faint">
                {formatNumber(bucket.count)} · {percentage}%
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-line/60">
              <div className="h-full rounded-full bg-info/65" style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardPage() {
  const [runId, setRunId] = useState<string | null>(null);
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.getDashboard });
  const data = dashboard.data;
  const completed = (data?.succeededRuns ?? 0) + (data?.failedRuns ?? 0);
  const successRate = completed === 0 ? null : Math.round(((data?.succeededRuns ?? 0) / completed) * 100);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Studio"
        title="Production overview"
        description="Your local production desk: storyboards, scene voiceovers, provider workspaces, and the automation engine that supports them. Everything shown here comes from the local database."
        actions={
          <>
            <Button icon={<Mic2 size={15} />} onClick={() => navigate("/voiceover")}>
              Voiceover studio
            </Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate("/storyboards")}>
              New storyboard
            </Button>
          </>
        }
      />

      <Card className="mt-5 border-accent/20 bg-accent-soft/20">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
              <Clapperboard size={19} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-fg">Build the next scene</p>
              <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
                Start from a logline, break it into shots, then preview the voiceover in the same workspace.
                Storyboards stay on this device and export as a clean Markdown brief or JSON.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Mic2 size={13} />} onClick={() => navigate("/voiceover")}>
              Voiceover
            </Button>
            <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => navigate("/storyboards")}>
              Open storyboards
            </Button>
          </div>
        </div>
      </Card>

      {isAndroid() ? (
        <Card className="mt-4 border-info/20">
          <div className="flex gap-2.5 p-4">
            <MonitorSmartphone size={16} className="mt-0.5 shrink-0 text-info" />
            <div>
              <p className="text-[11px] font-medium text-fg">Android build</p>
              <p className="mt-1 text-[10.5px] leading-4 text-muted">
                Workflows and schedules run while the app is open. Embedded provider sign-in and in-app updates
                are desktop-only; use the system browser and install newer signed APKs manually.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {dashboard.isError ? (
        <Card className="mt-6 border-danger/30">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 text-danger" />
              <div>
                <p className="text-sm font-medium text-fg">Unable to read application state</p>
                <p className="mt-1 text-xs leading-5 text-muted">{dashboard.error.message}</p>
              </div>
            </div>
            <Button icon={<RefreshCw size={14} />} onClick={() => void dashboard.refetch()}>
              Retry
            </Button>
          </div>
        </Card>
      ) : null}

      {dashboard.isLoading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-[116px] animate-pulse rounded-xl border border-line/70 bg-panel/60" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Storyboards"
              value={formatNumber(data.totalStoryboards ?? 0)}
              detail="Scenes, shots, and prompts stored locally."
              icon={<Clapperboard size={15} />}
              tone="accent"
            />
            <StatCard
              label="Voiceover files"
              value={formatNumber(data.totalVoiceoverAssets ?? 0)}
              detail="Generated audio references for your scenes."
              icon={<Mic2 size={15} />}
              tone="info"
            />
            <StatCard
              label="Accounts"
              value={formatNumber(data.totalAccounts)}
              detail={
                data.accountsByStatus.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {data.accountsByStatus.map((bucket) => (
                      <Badge key={bucket.label} tone="neutral">
                        {bucket.label.replace(/_/g, " ")} {bucket.count}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  "Add a provider account to begin."
                )
              }
              icon={<Users size={15} />}
            />
            <StatCard
              label="Run queue"
              value={formatNumber(data.queuedRuns + data.runningRuns)}
              detail={
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={11} />
                  {data.runningRuns} running · {data.queuedRuns} queued
                  {successRate != null ? ` · ${successRate}% success` : ""}
                </span>
              }
              icon={<Play size={15} />}
              tone={data.failedRuns > data.succeededRuns ? "danger" : "neutral"}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Card>
              <CardHeader
                title="Execution volume"
                description="Completed runs by outcome, grouped by local calendar day."
                actions={<Badge tone="neutral">7 days</Badge>}
              />
              <RunChart days={data.runsLast7Days} />
            </Card>

            <Card>
              <CardHeader
                title="Account coverage"
                description="Distribution across configured providers."
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/accounts")}>
                    Manage
                  </Button>
                }
              />
              <BucketList buckets={data.accountsByProvider} empty="No accounts configured yet." />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Card>
              <CardHeader
                title="Recent runs"
                description="Newest executions across every workflow."
                actions={
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowUpRight size={13} />}
                    onClick={() => navigate("/runs")}
                  >
                    All runs
                  </Button>
                }
              />
              {data.recentRuns.length === 0 ? (
                <EmptyState
                  icon={<Activity size={18} />}
                  title="No runs yet"
                  description="Run a workflow manually or let the scheduler queue one. Run history and step output will appear here."
                  action={
                    <Button variant="primary" icon={<Play size={14} />} onClick={() => navigate("/workflows")}>
                      Choose a workflow
                    </Button>
                  }
                />
              ) : (
                <div className="px-3 pb-3">
                  <RunTable runs={data.recentRuns} onSelect={setRunId} compact />
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Scheduler"
                  description={data.schedulerEnabled ? "Due workflows are queued by the local scheduler." : "The scheduler is paused in settings."}
                  actions={
                    <Badge tone={data.schedulerEnabled ? "success" : "warning"} dot>
                      {data.schedulerEnabled ? "Active" : "Paused"}
                    </Badge>
                  }
                />
                <div className="space-y-3 px-5 py-4 text-xs">
                  <div className="flex items-start gap-2.5">
                    <CalendarClock size={15} className="mt-0.5 shrink-0 text-muted" />
                    <div>
                      <p className="text-muted">Next scheduled run</p>
                      <p className="mt-1 text-sm font-medium text-fg">
                        {data.nextScheduledRun ? relativeTime(data.nextScheduledRun) : "Nothing scheduled"}
                      </p>
                      {data.nextScheduledRun ? (
                        <p className="mt-0.5 text-[10px] text-faint">{new Date(data.nextScheduledRun).toLocaleString()}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-line/60 pt-3">
                    <span className="text-[11px] text-faint">
                      {data.enabledWorkflows} enabled workflow{data.enabledWorkflows === 1 ? "" : "s"}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => navigate("/settings")}>
                      Scheduler settings
                    </Button>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Recent errors"
                  description="Redacted application and run errors."
                  actions={
                    <Button size="sm" variant="ghost" icon={<ScrollText size={13} />} onClick={() => navigate("/logs")}>
                      Logs
                    </Button>
                  }
                />
                {data.recentErrors.length === 0 ? (
                  <div className="flex items-center gap-2.5 px-5 py-6 text-xs text-muted">
                    <CheckCircle2 size={15} className="text-accent" />
                    No errors recorded.
                  </div>
                ) : (
                  <ul className="divide-y divide-line/50">
                    {data.recentErrors.map((entry) => (
                      <li key={entry.id} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge tone={entry.level === "error" ? "danger" : "warning"}>{entry.level}</Badge>
                          <span className="text-[10px] text-faint">{relativeTime(entry.ts)}</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 break-words text-[11px] leading-4 text-muted">{entry.message}</p>
                        <p className="mt-1 font-mono text-[9.5px] text-faint">{entry.scope}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="Account status" description="Local sign-in state tracked per provider profile." />
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {data.accountsByStatus.length === 0 ? (
                  <p className="text-xs text-faint">No account status recorded.</p>
                ) : (
                  data.accountsByStatus.map((bucket) => (
                    <Badge key={bucket.label} tone={statusTone(bucket.label)} dot>
                      {humanStatus(bucket.label)} · {bucket.count}
                    </Badge>
                  ))
                )}
              </div>
            </Card>
            <Card className="border-accent/20 bg-accent-soft/20">
              <div className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-[13px] font-semibold text-fg">Hear the scene</p>
                  <p className="mt-1 max-w-md text-xs leading-5 text-muted">
                    Preview a scene with the system speech engine, or generate a downloadable voice track through
                    your own TTS provider. The script stays attached to the storyboard.
                  </p>
                </div>
                <Button variant="primary" icon={<Mic2 size={14} />} onClick={() => navigate("/voiceover")}>
                  Open
                </Button>
              </div>
            </Card>
          </div>
        </>
      ) : null}

      <RunDetailDialog runId={runId} open={runId != null} onClose={() => setRunId(null)} />
    </PageContainer>
  );
}
