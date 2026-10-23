import { useEffect, useState } from "react";

export type Page =
  | "dashboard"
  | "storyboards"
  | "voiceover"
  | "accounts"
  | "workflows"
  | "runs"
  | "logs"
  | "prompts"
  | "tools"
  | "plugins"
  | "settings";

export type Route = { page: Page } | { page: "workflow"; id: string };

export function parseHash(hash: string): Route {
  const clean = hash
    .replace(/^#\/?/, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "");
  if (!clean) return { page: "dashboard" };
  const [segment, id] = clean.split("/");
  switch (segment) {
    case "storyboards":
      return { page: "storyboards" };
    case "voiceover":
      return { page: "voiceover" };
    case "accounts":
      return { page: "accounts" };
    case "workflows":
      return id ? { page: "workflow", id } : { page: "workflows" };
    case "runs":
      return { page: "runs" };
    case "logs":
      return { page: "logs" };
    case "prompts":
      return { page: "prompts" };
    case "tools":
      return { page: "tools" };
    case "plugins":
      return { page: "plugins" };
    case "settings":
      return { page: "settings" };
    default:
      return { page: "dashboard" };
  }
}

export function navigate(path: string): void {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (window.location.hash === `#${normalized}`) return;
  if (beforeNavigate && !beforeNavigate()) return;
  allowNextHashChange = true;
  window.location.hash = normalized;
}

let beforeNavigate: (() => boolean) | null = null;
let allowNextHashChange = false;

/** Registers a guard used by in-app navigation (for example, unsaved editor changes). */
export function setBeforeNavigate(guard: (() => boolean) | null): void {
  beforeNavigate = guard;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    let currentHash = window.location.hash;
    const onChange = () => {
      const nextHash = window.location.hash;
      if (allowNextHashChange) {
        allowNextHashChange = false;
      } else if (beforeNavigate && !beforeNavigate()) {
        // Back/forward or a manual hash edit bypassed navigate(). Restore the
        // previous URL without adding another history entry.
        window.history.replaceState(null, "", currentHash || "#/");
        return;
      }
      currentHash = nextHash;
      setRoute(parseHash(nextHash));
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
