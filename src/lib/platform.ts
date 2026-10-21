import { openUrl } from "@tauri-apps/plugin-opener";

/** True inside the Android WebView (including the Tauri Android shell). */
export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

/** Opens an HTTPS URL in the platform browser, with a browser fallback for dev previews. */
export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
