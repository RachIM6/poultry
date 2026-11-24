import type { Instrumentation } from "next";

// Runs once when the server starts (Next.js instrumentation): refuse to start on an unsafe production configuration.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  for (const warning of (await import("@/lib/env")).checkProductionEnv()) console.warn(`[env] ${warning}`);
}

// One JSON line per server error, for the host's log. Never the body, cookies, headers or query: they hold phone numbers,
// names and session ids. The digest links the line to the one the user's error screen shows.
export const onRequestError: Instrumentation.onRequestError = (err, request) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      path: request.path.split("?")[0],
      method: request.method,
      error: err instanceof Error ? err.name : typeof err,
      digest,
    }),
  );
};
