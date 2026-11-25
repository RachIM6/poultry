// The install page's logic (src/components/install-guide.tsx), kept free of React so it is unit-tested.

/** Chrome, Edge and Samsung Internet's install offer (not in TypeScript's DOM types). */
export type InstallPromptEvent = Event & { prompt(): Promise<unknown>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type Platform = "ios" | "android" | "desktop" | "firefox";
export type Outcome = "accepted" | "dismissed" | "failed";

declare global {
  interface Window {
    installPrompt?: InstallPromptEvent | null; // set by CAPTURE_SCRIPT
  }
}

/**
 * Inlined in the root layout's <head>: the browser can fire beforeinstallprompt once per page load, before the install
 * page hydrates or on another page the user then leaves by a client-side link. Kept on window for the install page.
 * preventDefault() so Chrome holds its offer for our button; its own menu entry stays.
 */
export const CAPTURE_SCRIPT =
  'addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.installPrompt=e});' +
  'addEventListener("appinstalled",function(){window.installPrompt=null})';

export function detectPlatform(ua: string, maxTouchPoints: number): Platform {
  // iPadOS reports itself as a Mac; touch points tell them apart.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  // Firefox on a computer can't install a web app (Firefox on Android can, from its menu).
  return /Firefox\//.test(ua) ? "firefox" : "desktop";
}

/** The steps to show, the user's platform first; Firefox gets the computer steps for Chrome or Edge. */
export function stepsOrder(platform: Platform): ("ios" | "android" | "desktop")[] {
  const first = platform === "firefox" ? "desktop" : platform;
  return [first, ...(["ios", "android", "desktop"] as const).filter((p) => p !== first)];
}

export function installView(state: { installed: boolean; prompt: boolean; outcome?: Outcome }): "installed" | "prompt" | "steps" {
  if (state.installed || state.outcome === "accepted") return "installed";
  return state.prompt ? "prompt" : "steps";
}

/** Opens the browser's install dialog; an event can prompt only once, so the caller drops it whatever the outcome. */
export async function runPrompt(event: InstallPromptEvent): Promise<Outcome> {
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "failed"; // already used, or no user gesture: the steps remain
  }
}
