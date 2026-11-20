// Runs once when the server starts (Next.js instrumentation): refuse to start with an unsafe captcha setup.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("@/lib/security/captcha")).assertCaptchaConfig();
}
