import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  KeyRound,
  Mic2,
  Rocket,
  Sparkles,
  Users,
  Workflow,
  Clapperboard,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useI18n } from "../i18n";
import { navigate } from "../lib/router";
import { LanguageToggle } from "./LanguageToggle";
import { Badge, Button, Card, Modal, ProgressBar, SectionLabel } from "./ui";

const WELCOME_KEY = "bits.onboarding.welcome.v1";
const CHECKLIST_KEY = "bits.onboarding.checklist.v1";
const RESET_EVENT = "bits:onboarding-reset";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // The tour remains usable for the current session when storage is blocked.
  }
}

export function resetOnboarding(): void {
  writeFlag(WELCOME_KEY, false);
  writeFlag(CHECKLIST_KEY, false);
  window.dispatchEvent(new Event(RESET_EVENT));
}

export function WelcomeOnboarding() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => !readFlag(WELCOME_KEY));

  useEffect(() => {
    const onReset = () => setOpen(true);
    window.addEventListener(RESET_EVENT, onReset);
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, []);

  const close = () => {
    writeFlag(WELCOME_KEY, true);
    setOpen(false);
  };

  const bullets: Array<{ icon: ReactNode; text: string }> = [
    { icon: <Sparkles size={14} />, text: t("onboarding.welcomeBullet1", "Set your language and theme.") },
    {
      icon: <KeyRound size={14} />,
      text: t("onboarding.welcomeBullet2", "Add AI and voiceover keys plus a provider account."),
    },
    {
      icon: <Clapperboard size={14} />,
      text: t("onboarding.welcomeBullet3", "Start with your first storyboard, then generate voiceover."),
    },
  ];

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={t("onboarding.welcomeTitle", "Welcome to BITS AI Video Creator")}
      description={t(
        "onboarding.welcomeBody",
        "A local video studio for storyboards, voiceover, and production automation. All data stays on this device.",
      )}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t("onboarding.explore", "Explore dashboard")}
          </Button>
          <Button
            variant="primary"
            icon={<Rocket size={14} />}
            onClick={() => {
              close();
              navigate("/settings");
            }}
          >
            {t("onboarding.openSettings", "Open settings")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-2.5">
          {bullets.map((bullet) => (
            <li key={bullet.text} className="flex items-start gap-2.5 rounded-lg border border-line/70 bg-surface/50 p-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                {bullet.icon}
              </span>
              <span className="text-[11.5px] leading-5 text-muted">{bullet.text}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line/70 bg-surface/50 p-3">
          <div>
            <p className="text-[11px] font-medium text-fg">{t("language.title", "Language")}</p>
            <p className="mt-0.5 text-[10px] leading-4 text-faint">
              {t("language.description", "The interface language applies immediately and is stored on this device.")}
            </p>
          </div>
          <LanguageToggle />
        </div>
        <p className="text-[10px] leading-4 text-faint">
          {t("onboarding.dontShow", "You can reopen this tour from Settings → About.")}
        </p>
      </div>
    </Modal>
  );
}

interface SetupStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  path: string;
  icon: ReactNode;
}

export function GettingStartedCard() {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(() => readFlag(CHECKLIST_KEY));
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.getDashboard });
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: api.listSecrets });

  useEffect(() => {
    const onReset = () => setHidden(false);
    window.addEventListener(RESET_EVENT, onReset);
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, []);

  if (hidden || !dashboard.data) return null;

  const stats = dashboard.data;
  const secretNames = new Set((secrets.data ?? []).map((secret) => secret.name));
  const aiReady = secretNames.has("ai.api_key") || secretNames.has("tts.api_key");

  const steps: SetupStep[] = [
    {
      id: "ai",
      title: t("onboarding.step.aiTitle", "Connect AI and voiceover"),
      description: t(
        "onboarding.step.aiDesc",
        "Store ai.api_key or tts.api_key so provider drafts and audio can run.",
      ),
      done: aiReady,
      path: "/settings?tab=secrets",
      icon: <KeyRound size={14} />,
    },
    {
      id: "account",
      title: t("onboarding.step.accountTitle", "Add a provider account"),
      description: t(
        "onboarding.step.accountDesc",
        "Track a provider identity and open an isolated session to sign in.",
      ),
      done: stats.totalAccounts > 0,
      path: "/accounts",
      icon: <Users size={14} />,
    },
    {
      id: "storyboard",
      title: t("onboarding.step.storyboardTitle", "Create your first storyboard"),
      description: t(
        "onboarding.step.storyboardDesc",
        "Break an idea into scenes and shots with prompts and camera notes.",
      ),
      done: stats.totalStoryboards > 0,
      path: "/storyboards",
      icon: <Clapperboard size={14} />,
    },
    {
      id: "voiceover",
      title: t("onboarding.step.voiceoverTitle", "Generate voiceover"),
      description: t(
        "onboarding.step.voiceoverDesc",
        "Write a script per scene, preview system speech, then save provider audio.",
      ),
      done: stats.totalVoiceoverAssets > 0,
      path: "/voiceover",
      icon: <Mic2 size={14} />,
    },
    {
      id: "automation",
      title: t("onboarding.step.automationTitle", "Try an automation"),
      description: t(
        "onboarding.step.automationDesc",
        "Optional: build a manual or scheduled workflow for repeatable tasks.",
      ),
      done: stats.totalWorkflows > 0,
      path: "/workflows",
      icon: <Workflow size={14} />,
    },
  ];

  const done = steps.filter((step) => step.done).length;
  const allDone = done === steps.length;

  const dismiss = () => {
    writeFlag(CHECKLIST_KEY, true);
    setHidden(true);
  };

  return (
    <Card className="mt-4 border-accent/20 bg-accent-soft/15">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line/70 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <Rocket size={18} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[13px] font-semibold text-fg">
                {allDone
                  ? t("onboarding.complete", "Ready to produce")
                  : t("onboarding.checklistTitle", "Start here")}
              </h2>
              <Badge tone={allDone ? "success" : "accent"} dot>
                {done}/{steps.length}
              </Badge>
            </div>
            <p className="mt-1 max-w-2xl text-[10.5px] leading-4 text-muted">
              {allDone
                ? t(
                    "onboarding.completeBody",
                    "All core steps are complete. You can close this checklist.",
                  )
                : t(
                    "onboarding.checklistDescription",
                    "{done} of {total} steps complete. You can close this checklist at any time.",
                    { done, total: steps.length },
                  )}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<X size={13} />}
          aria-label={t("onboarding.hide", "Dismiss checklist")}
          onClick={dismiss}
        >
          {t("common.dismiss", "Dismiss")}
        </Button>
      </div>

      <div className="px-5 pt-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t("onboarding.progress", "Setup progress")}</SectionLabel>
          <span className="numeric text-[10px] text-faint">
            {done}/{steps.length}
          </span>
        </div>
        <ProgressBar className="mt-2" value={done} maximum={steps.length} />
      </div>

      <ul className="divide-y divide-line/50 px-5 pb-2 pt-1">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-center gap-3 py-3">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                step.done ? "bg-accent/10 text-accent" : "bg-raised text-faint"
              }`}
            >
              {step.done ? <CheckCircle2 size={15} /> : <Circle size={14} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-medium text-fg">{step.title}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-faint">{step.description}</span>
            </span>
            {step.done ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-accent">
                {step.icon}
                {t("onboarding.step.done", "Done")}
              </span>
            ) : (
              <Button size="sm" variant="secondary" icon={step.icon} onClick={() => navigate(step.path)}>
                {t("onboarding.step.open", "Open")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
