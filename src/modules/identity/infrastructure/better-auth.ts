import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { parseCookies } from "better-auth/cookies";
import { phoneNumber } from "better-auth/plugins";
import { db } from "@/lib/db";
import { PASSWORD } from "@/modules/identity/domain/identifier";
import { sendCode } from "./sms";

const DAY = 24 * 60 * 60;

// ADR-005 / SPEC I1–I2. Changing any of these logs people out or changes the OTP rules: ask first (poultry-auth §0.11).
export const AUTH_CONFIG = {
  otp: { length: 6, expiresInSec: 5 * 60, allowedAttempts: 5 },
  session: { expiresInSec: 30 * DAY, updateAgeSec: DAY, absoluteMaxSec: 90 * DAY },
  invitation: { expiresInSec: 7 * DAY }, // not Better Auth's: ours (application/members.ts); the invite code's life too
  reset: { expiresInSec: 7 * DAY }, // ADR-015: a password reset code, as an invite code
};

/** Better Auth needs an email on every user: a phone-only account gets this placeholder (never shown, never typed). */
export const phoneEmail = (e164: string) => `${e164.slice(1)}@phone.invalid`;

// Better Auth is the engine only: nothing mounts its HTTP handler. Our route handlers (src/app/api/auth/*) run rate
// limits, CSRF and uniform responses first, then call auth.api.* on the server.
export const auth = betterAuth({
  baseURL: process.env.APP_ORIGIN,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  session: { expiresIn: AUTH_CONFIG.session.expiresInSec, updateAge: AUTH_CONFIG.session.updateAgeSec },
  user: { additionalFields: { locale: { type: "string", defaultValue: "ar", input: false } } },
  rateLimit: { enabled: false }, // ours runs in front (src/lib/security/rate-limit.ts)
  // ADR-015: sign-in checks the password through signInEmail (it hashes for an unknown account too: uniform timing).
  // Accounts are created by our sign-up (application/password.ts), never by Better Auth's. Hash: its default scrypt.
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: PASSWORD.min, maxPasswordLength: PASSWORD.max },
  advanced: {
    database: { generateId: false }, // ids from the uuidv7() column default
    useSecureCookies: true, // Secure on http://localhost too (browsers allow it); cookie name becomes __Secure-sid
    cookies: { session_token: { name: "sid" } },
  },
  plugins: [
    phoneNumber({
      otpLength: AUTH_CONFIG.otp.length,
      expiresIn: AUTH_CONFIG.otp.expiresInSec,
      allowedAttempts: AUTH_CONFIG.otp.allowedAttempts,
      sendOTP: ({ phoneNumber, code }) => sendCode(phoneNumber, code),
      // First verified login creates the user (owners sign up freely; access still needs a membership, T6/T7).
      signUpOnVerification: {
        getTempEmail: phoneEmail,
        getTempName: (phone) => phone,
      },
    }),
  ],
});

/** The session dimension's rate-limit key (rate-limiting.md §2 "sid:<hash>"): the session cookie's hash, never the token. */
export async function sessionKey(headers: Headers): Promise<string | undefined> {
  const token = parseCookies(headers.get("cookie") ?? "").get((await auth.$context).authCookies.sessionToken.name);
  return token ? createHash("sha256").update(token).digest("base64url") : undefined;
}
