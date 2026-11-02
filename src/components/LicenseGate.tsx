import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, Card, Field, Input } from "./ui";
import { LanguageToggle } from "./LanguageToggle";
import { api, toApiError } from "../lib/api";
import { openExternal } from "../lib/platform";
import { useI18n } from "../i18n";
import type { LicenseState } from "../lib/types";

export const LICENSE_PORTAL_URL = "https://license.bits.co.id/user/device-link";

function sanitizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function GateShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-full items-center justify-center overflow-y-auto bg-bg p-5 sm:p-8">
      <div className="w-full max-w-md">
        <div className="mb-3 flex justify-end">
          <LanguageToggle />
        </div>
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <KeyRound size={19} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent/80">
              BITS AI Video Creator
            </p>
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">
              {t("license.title", "License")}
            </h1>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function PairingScreen() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const link = useMutation({
    mutationFn: () => api.linkLicenseCode(sanitizeCode(code)),
    onSuccess: (next) => {
      setError(null);
      queryClient.setQueryData(["license"], next);
      void queryClient.invalidateQueries({ queryKey: ["license"] });
    },
    onError: (cause) => setError(toApiError(cause).message),
  });

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line/70 bg-warn/[0.035] px-5 py-4">
        <h2 className="text-[13px] font-semibold tracking-[0.01em] text-fg">
          {t("license.pairing.title", "Connect license")}
        </h2>
        <p className="mt-1 text-[10.5px] leading-4 text-muted">
          {t(
            "license.pairing.description",
            "Sign in to BITS License Manager on the web, open the Connect Application page, copy the 8-character code, and paste it here.",
          )}
        </p>
      </div>
      <div className="space-y-4 p-5">
        <Field
          label={t("license.pairing.code", "Pairing code")}
          htmlFor="license-pairing-code"
          hint={t("license.pairing.codeHint", "8 letters and numbers.")}
        >
          <Input
            id="license-pairing-code"
            value={code}
            onChange={(event) => {
              setCode(sanitizeCode(event.target.value));
              setError(null);
            }}
            placeholder="XXXXXXXX"
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="text-center font-mono text-lg tracking-[0.45em]"
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-[11px] leading-4 text-danger">
            {error}
          </p>
        ) : null}

        <Button
          variant="primary"
          className="w-full"
          loading={link.isPending}
          disabled={code.length !== 8}
          onClick={() => link.mutate()}
        >
          {t("license.pairing.connect", "Connect")}
        </Button>

        <button
          type="button"
          onClick={() => void openExternal(LICENSE_PORTAL_URL)}
          className="mx-auto flex items-center gap-1.5 text-[11px] font-medium text-accent hover:underline"
        >
          <ExternalLink size={12} />
          {t("license.pairing.openManager", "Open BITS License Manager")}
        </button>
      </div>
    </Card>
  );
}

function BlockedScreen({ state }: { state: LicenseState }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: api.refreshLicense,
    onSuccess: (next) => {
      queryClient.setQueryData(["license"], next);
      void queryClient.invalidateQueries({ queryKey: ["license"] });
    },
  });

  const expired = state.status === "expired";
  const message = expired
    ? t(
        "license.blocked.expiredBody",
        "Your license has expired. Renew the subscription in BITS License Manager, then refresh here.",
      )
    : (state.error ??
      t(
        "license.blocked.errorBody",
        "Something went wrong with the license. Try refreshing or manage your license on the web.",
      ));

  return (
    <Card className="overflow-hidden">
      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-danger/25 bg-danger/10 text-danger">
            <ShieldAlert size={16} />
          </span>
          <div>
            <h2 className="text-[13px] font-semibold text-fg">
              {expired
                ? t("license.blocked.expiredTitle", "License expired")
                : t("license.blocked.errorTitle", "License status problem")}
            </h2>
            <p className="mt-1 text-[10.5px] leading-4 text-muted">{message}</p>
          </div>
        </div>

        {refresh.isError ? (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-[11px] leading-4 text-danger">
            {toApiError(refresh.error).message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<RefreshCw size={14} />}
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {t("license.blocked.tryAgain", "Try again")}
          </Button>
          <Button
            variant="secondary"
            icon={<ExternalLink size={14} />}
            onClick={() => void openExternal(LICENSE_PORTAL_URL)}
          >
            {t("license.blocked.manage", "Manage license")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-3">
          <Badge tone={expired ? "warning" : "danger"} dot>
            {expired
              ? t("license.blocked.expiredBadge", "Expired")
              : t("license.blocked.errorBadge", "Error")}
          </Badge>
          {state.plan ? (
            <span className="text-[10px] text-faint">
              {t("license.blocked.plan", "Plan: {plan}", { plan: state.plan })}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function LicenseGate({ state, children }: { state?: LicenseState; children: ReactNode }) {
  const { t } = useI18n();
  if (!state) {
    return (
      <GateShell>
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" /> {t("license.checking", "Checking license…")}
        </div>
      </GateShell>
    );
  }
  if (state.status === "licensed") return <>{children}</>;
  return (
    <GateShell>{state.status === "unlinked" ? <PairingScreen /> : <BlockedScreen state={state} />}</GateShell>
  );
}
