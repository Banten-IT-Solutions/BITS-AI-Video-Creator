import clsx from "clsx";
import { X } from "lucide-react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { humanStatus, statusTone, type Tone } from "../lib/format";

export function cn(...values: Array<string | false | null | undefined>): string {
  return clsx(values);
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-[#04140c] hover:bg-accent-strong active:bg-accent-strong shadow-[0_1px_0_rgb(255_255_255/0.25)_inset]",
  secondary:
    "border border-line bg-panel text-fg hover:border-faint/60 hover:bg-raised active:bg-raised",
  ghost: "text-muted hover:bg-raised hover:text-fg",
  danger: "border border-danger/35 bg-danger/10 text-danger hover:bg-danger/15",
  subtle: "bg-raised text-fg hover:bg-line/60",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-[38px] px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-sm gap-2 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size={size === "sm" ? 13 : 15} /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  tone?: "default" | "danger";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, label, size = "md", tone = "default", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 w-7" : "h-[34px] w-[34px]",
        tone === "danger" && "hover:bg-danger/10 hover:text-danger",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function Card({
  className,
  children,
  as: Component = "section",
}: {
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article";
}) {
  return (
    <Component
      className={cn(
        "rounded-xl border border-line/90 bg-panel/85 shadow-panel backdrop-blur-[2px]",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line/75 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[0.01em] text-fg">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  const tones: Record<Tone, string> = {
    neutral: "border-line bg-raised/70 text-muted",
    success: "border-accent/25 bg-accent/10 text-accent",
    danger: "border-danger/25 bg-danger/10 text-danger",
    warning: "border-warn/25 bg-warn/10 text-warn",
    info: "border-info/25 bg-info/10 text-info",
    accent: "border-accent/25 bg-accent/10 text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-4 tracking-[0.02em]",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {humanStatus(status)}
    </Badge>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg shadow-[0_1px_0_rgb(var(--highlight)/0.02)_inset] placeholder:text-faint transition-colors hover:border-faint/50 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-line bg-surface px-3 pr-8 text-sm text-fg transition-colors hover:border-faint/50 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-6 text-fg placeholder:text-faint transition-colors hover:border-faint/50 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          {label}
        </label>
        {optional ? <span className="text-[10px] text-faint">optional</span> : null}
      </div>
      {children}
      {error ? <p className="text-xs leading-5 text-danger">{error}</p> : hint ? <p className="text-[11px] leading-[18px] text-faint">{hint}</p> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <label className={cn("flex items-start gap-3", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "border-accent/50 bg-accent/85" : "border-line bg-raised",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-transform",
            checked ? "translate-x-[18px] bg-[#04140c]" : "translate-x-0.5 bg-muted",
          )}
        />
      </button>
      <span>
        <span className="block text-sm text-fg">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block animate-spin rounded-full border-2 border-current border-r-transparent", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}>
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-raised/70 text-muted">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line/70 pb-5">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent/80">{eyebrow}</p>
        ) : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] text-faint", className)}>{children}</div>
  );
}

export function ProgressBar({ value, maximum = 100, className }: { value: number; maximum?: number; className?: string }) {
  const percentage = maximum <= 0 ? 0 : Math.min(100, Math.max(0, (value / maximum) * 100));
  return (
    <div
      className={cn("h-1 overflow-hidden rounded-full bg-line/70", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={maximum}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percentage}%` }} />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  closeOnBackdrop?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      focusable?.focus();
    }, 20);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh] sm:pt-[10vh]">
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-[3px] animate-[fade-rise_120ms_ease-out]"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "relative z-10 w-full animate-fade-rise rounded-2xl border border-line bg-panel shadow-[0_30px_90px_rgb(0_0_0/0.5)]",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/75 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close dialog" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line/75 bg-surface/50 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
  tone = "danger",
  confirmationLabel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  tone?: "danger" | "primary";
  confirmationLabel?: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    if (open) setConfirmation("");
  }, [open]);
  const ready = !confirmationLabel || confirmation.trim() === confirmationLabel.trim();

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="sm"
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={busy}
            disabled={!ready}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm leading-6 text-muted">
        <div>{description}</div>
        {confirmationLabel ? (
          <Field label="Type to confirm" hint={`Enter “${confirmationLabel}” exactly.`}>
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Confirmation text"
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 rounded-lg border border-line/70 bg-surface/60 p-1", className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === tab.id ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {tab.label}
          {tab.count != null ? <span className="numeric text-[10px] text-faint">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

const MenuContext = createContext<{ close: () => void } | null>(null);

export function Dropdown({
  trigger,
  children,
  align = "right",
  width = "w-52",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div
          className={cn(
            "absolute z-30 mt-1.5 overflow-hidden rounded-lg border border-line bg-panel p-1 shadow-[0_18px_50px_rgb(0_0_0/0.4)] animate-fade-rise",
            width,
            align === "right" ? "right-0" : "left-0",
          )}
          role="menu"
        >
          <MenuContext.Provider value={{ close: () => setOpen(false) }}>{children}</MenuContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  icon,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  const context = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        context?.close();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        danger ? "text-danger hover:bg-danger/10" : "text-muted hover:bg-raised hover:text-fg",
      )}
    >
      {icon ? <span className="shrink-0 opacity-80">{icon}</span> : null}
      {children}
    </button>
  );
}
