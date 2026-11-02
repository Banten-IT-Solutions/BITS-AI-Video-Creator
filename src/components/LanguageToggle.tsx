import { useI18n } from "../i18n";
import { cn } from "./ui";

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("language.title", "Language")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-line/80 bg-surface/70 p-0.5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setLanguage("en")}
        aria-pressed={language === "en"}
        className={cn(
          "rounded-md px-2.5 py-1 text-[10.5px] font-medium transition-colors",
          language === "en" ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg",
        )}
      >
        {t("language.english", "English")}
      </button>
      <button
        type="button"
        onClick={() => setLanguage("id")}
        aria-pressed={language === "id"}
        className={cn(
          "rounded-md px-2.5 py-1 text-[10.5px] font-medium transition-colors",
          language === "id" ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg",
        )}
      >
        {t("language.indonesian", "Bahasa Indonesia")}
      </button>
    </div>
  );
}
