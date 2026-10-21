import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Field, Textarea } from "../components/ui";
import { api, toApiError } from "../lib/api";
import type { LicenseStatus } from "../lib/types";

function formatIdr(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

export function LicenseGate({ status }: { status: LicenseStatus }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const plans = useQuery({
    queryKey: ["license-plans"],
    queryFn: api.getLicensePlans,
    staleTime: Infinity,
  });

  const activate = useMutation({
    mutationFn: () => api.activateLicense(token.trim()),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["license"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (cause) => setError(toApiError(cause).message),
  });

  const copyDevice = async () => {
    try {
      await navigator.clipboard.writeText(status.deviceId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard unavailable. Select the device id manually.");
    }
  };

  return (
    <div className="min-h-full overflow-y-auto bg-bg p-5 sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <KeyRound size={19} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent/80">
              BITS AI Video Creator
            </p>
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">Activate this studio</h1>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(280px,0.88fr)]">
          <Card className="overflow-hidden">
            <div className="border-b border-line/70 bg-warn/[0.035] px-5 py-4">
              <div className="flex items-center gap-2">
                <ShieldAlert size={15} className="text-warn" />
                <p className="text-xs font-medium text-warn">A valid license is required to use the workspace.</p>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-4 text-muted">
                This build is license-gated. Activation is verified offline with an Ed25519 signature. The token
                stays on this device and is never sent to a license server.
              </p>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-lg border border-line/70 bg-surface/50 p-3">
                <p className="text-[9.5px] uppercase tracking-[0.1em] text-faint">Device id</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-[10.5px] leading-4 text-muted">
                    {status.deviceId}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied ? <Check size={12} /> : <Copy size={12} />}
                    onClick={() => void copyDevice()}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="mt-1.5 text-[9.5px] leading-4 text-faint">
                  Send this id with your order if you want a device-bound token.
                </p>
              </div>

              <Field label="License token" hint="Paste the complete BITS1.… token you received after payment.">
                <Textarea
                  value={token}
                  onChange={(event) => {
                    setToken(event.target.value);
                    setError(null);
                  }}
                  rows={5}
                  placeholder="BITS1.eyJ2ZXJzaW9uIjox…"
                  className="font-mono text-[10.5px] leading-5"
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              {error ? (
                <p className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-[11px] leading-4 text-danger">
                  {error}
                </p>
              ) : null}

              <Button
                variant="primary"
                className="w-full"
                icon={<ShieldCheck size={14} />}
                loading={activate.isPending}
                disabled={!token.trim()}
                onClick={() => activate.mutate()}
              >
                Verify and activate
              </Button>

              <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-3 text-[10px] text-faint">
                <span>Mode: {status.mode}</span>
                <Badge tone="neutral">offline verification</Badge>
              </div>
              <p className="text-[9.5px] leading-4 text-faint">{status.message}</p>
            </div>
          </Card>

          <div className="space-y-3">
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-accent" />
                <p className="text-xs font-semibold text-fg">Choose a plan</p>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-muted">
                One workspace license. Storyboards, voiceover tools, provider workspaces, and local automation are
                included in every plan.
              </p>
              <div className="mt-3 space-y-2">
                {(plans.data ?? []).map((plan) => (
                  <div
                    key={plan.id}
                    className={`rounded-lg border p-3 ${
                      plan.id === "yearly"
                        ? "border-accent/35 bg-accent/[0.055]"
                        : "border-line/70 bg-surface/50"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-medium text-fg">{plan.name}</span>
                      {plan.id === "yearly" ? <Badge tone="accent">Best value</Badge> : null}
                    </div>
                    <p className="numeric mt-1 text-sm font-semibold text-accent">{formatIdr(plan.priceIdr)}</p>
                    <p className="mt-1 text-[9.5px] leading-4 text-muted">
                      {plan.description} · {plan.durationDays ? `${plan.durationDays} hari` : "Tanpa kedaluwarsa"}
                    </p>
                  </div>
                ))}
              </div>
              <Button
                className="mt-3 w-full"
                variant="secondary"
                onClick={() => window.open("https://bits.co.id", "_blank", "noopener,noreferrer")}
              >
                Order via bits.co.id
              </Button>
              <p className="mt-2 text-[9px] leading-4 text-faint">
                Payment is handled by BITS. After payment is confirmed, the issuer signs a token for your device.
              </p>
            </Card>
            <p className="px-1 text-[9.5px] leading-4 text-faint">
              Lost your token or need a device transfer? Contact the issuer. This build contains no recovery
              backdoor and does not phone home.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
