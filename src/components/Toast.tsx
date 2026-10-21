import clsx from "clsx";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastTone = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (toast: Omit<ToastItem, "id">) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, message) => push({ tone: "success", title, message }),
      error: (title, message) => push({ tone: "error", title, message }),
      info: (title, message) => push({ tone: "info", title, message }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onClose={() => remove(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, toast.tone === "error" ? 8_000 : 5_000);
    return () => window.clearTimeout(timer);
  }, [onClose, toast.tone]);

  const styles = {
    success: "border-accent/30 bg-[#0d1913] text-accent",
    error: "border-danger/35 bg-[#1c1111] text-danger",
    warning: "border-warn/35 bg-[#1b1510] text-warn",
    info: "border-info/30 bg-[#0d141c] text-info",
  };
  const icons = {
    success: <CheckCircle2 size={15} />,
    error: <XCircle size={15} />,
    warning: <TriangleAlert size={15} />,
    info: <Info size={15} />,
  };

  return (
    <div
      className={clsx(
        "pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl border px-3.5 py-3 shadow-[0_16px_45px_rgb(0_0_0/0.45)]",
        styles[toast.tone],
      )}
      role="status"
    >
      <span className="mt-0.5 shrink-0">{icons[toast.tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-fg">{toast.title}</p>
        {toast.message ? <p className="mt-1 break-words text-[11px] leading-4 text-muted">{toast.message}</p> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
