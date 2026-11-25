import { describe, expect, it, vi } from "vitest";
import { detectPlatform, installView, runPrompt, stepsOrder, type InstallPromptEvent } from "@/components/install-prompt";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const WINDOWS_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0";

const promptEvent = (outcome: "accepted" | "dismissed") =>
  Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  }) as InstallPromptEvent & { prompt: ReturnType<typeof vi.fn> };

describe("installView", () => {
  it("offers the button when the browser kept an install prompt", () => {
    expect(installView({ installed: false, prompt: true })).toBe("prompt");
  });

  it("says the app is installed, whether it runs installed or was just accepted", () => {
    expect(installView({ installed: true, prompt: false })).toBe("installed");
    expect(installView({ installed: true, prompt: true })).toBe("installed");
    expect(installView({ installed: false, prompt: false, outcome: "accepted" })).toBe("installed");
  });

  it("falls back to the steps without a prompt, or after one was dismissed", () => {
    expect(installView({ installed: false, prompt: false })).toBe("steps");
    expect(installView({ installed: false, prompt: false, outcome: "dismissed" })).toBe("steps");
    expect(installView({ installed: false, prompt: false, outcome: "failed" })).toBe("steps");
  });
});

describe("runPrompt", () => {
  it("opens the browser's dialog and returns the user's choice", async () => {
    const accepted = promptEvent("accepted");
    expect(await runPrompt(accepted)).toBe("accepted");
    expect(accepted.prompt).toHaveBeenCalledOnce();
    expect(await runPrompt(promptEvent("dismissed"))).toBe("dismissed");
  });

  it("is a failure, not a crash, when the browser refuses (prompt already used)", async () => {
    const used = promptEvent("accepted");
    used.prompt.mockRejectedValueOnce(new DOMException("The prompt() method can only be called once.", "InvalidStateError"));
    expect(await runPrompt(used)).toBe("failed");
  });
});

describe("the steps for this device come first", () => {
  it("iPhone and iPad (iPadOS says Macintosh, with touch) get Safari's steps", () => {
    expect(detectPlatform(IPHONE, 5)).toBe("ios");
    expect(detectPlatform(IPAD, 5)).toBe("ios");
    expect(stepsOrder(detectPlatform(IPHONE, 5))).toEqual(["ios", "android", "desktop"]);
  });

  it("Android, then the others", () => {
    expect(detectPlatform(ANDROID, 5)).toBe("android");
    expect(detectPlatform(ANDROID_FIREFOX, 5)).toBe("android");
    expect(stepsOrder("android")).toEqual(["android", "ios", "desktop"]);
  });

  it("a computer gets the Chrome or Edge steps; Firefox too, with its own note", () => {
    expect(detectPlatform(WINDOWS_CHROME, 0)).toBe("desktop");
    expect(detectPlatform(IPAD, 0)).toBe("desktop"); // a real Mac
    expect(detectPlatform(WINDOWS_FIREFOX, 0)).toBe("firefox");
    expect(stepsOrder("desktop")).toEqual(["desktop", "ios", "android"]);
    expect(stepsOrder("firefox")).toEqual(["desktop", "ios", "android"]);
  });
});
