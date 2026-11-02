import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "id";

export type TranslationParams = Record<string, string | number>;

export type Translate = (key: string, fallback: string, params?: TranslationParams) => string;

const STORAGE_KEY = "bits.language";
const DEFAULT_LANGUAGE: Language = "en";

const idModules = import.meta.glob<{ default: Record<string, string> }>("./locales/id/*.ts", {
  eager: true,
});

const idDictionary: Record<string, string> = Object.assign(
  {},
  ...Object.values(idModules).map((module) => module.default),
);

function readStoredLanguage(): Language {
  try {
    if (typeof window === "undefined") return DEFAULT_LANGUAGE;
    return window.localStorage.getItem(STORAGE_KEY) === "id" ? "id" : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let activeLanguage: Language = readStoredLanguage();

export function getLanguage(): Language {
  return activeLanguage;
}

export function localeTag(language: Language = activeLanguage): string {
  return language === "id" ? "id-ID" : "en-US";
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}

function translateFor(
  language: Language,
  key: string,
  fallback: string,
  params?: TranslationParams,
): string {
  const template = language === "id" ? (idDictionary[key] ?? fallback) : fallback;
  return interpolate(template, params);
}

/** Translate outside React, using the active language. */
export function translate(key: string, fallback: string, params?: TranslationParams): string {
  return translateFor(activeLanguage, key, fallback, params);
}

export function hasTranslation(key: string): boolean {
  return key in idDictionary;
}

export function translationKeys(): string[] {
  return Object.keys(idDictionary);
}

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const fallbackContext: I18nContextValue = {
  language: activeLanguage,
  setLanguage: () => undefined,
  t: translate,
};

const I18nContext = createContext<I18nContextValue>(fallbackContext);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(activeLanguage);

  const setLanguage = useCallback((next: Language) => {
    activeLanguage = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A locked-down webview can reject localStorage writes; the UI still
      // switches for the current session.
    }
    document.documentElement.lang = next;
    setLanguageState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, fallback, params) => translateFor(language, key, fallback, params),
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
