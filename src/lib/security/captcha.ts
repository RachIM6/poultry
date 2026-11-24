import { createHash } from "node:crypto";
import { createChallenge, randomInt, verifySolution, type Challenge, type Payload } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { db } from "@/lib/db";

// Self-hosted ALTCHA proof of work (poultry-auth references/captcha.md). The only code that knows the provider.
// Algorithm and cost are ALTCHA's "wide compatibility" recommendation (native Web Crypto in every browser).
// The counter (attempts the phone must make) is our knob: ALTCHA suggests 5 000–10 000, but one attempt took 3.3 ms
// on a desktop (2026-11-20), so that would be ~25 s. The default 50 (~0.15 s on that desktop) is sized for about
// 1 s on a low-end Android, still to be timed on a real one. Raise CAPTCHA_MAX_NUMBER (restart) during an attack.
const ALGORITHM = "PBKDF2/SHA-256";
const COST = 5_000;
const TTL_MS = 5 * 60_000;

const disabled = () => process.env.CAPTCHA_DISABLED === "true";
const hmacKey = () => process.env.CAPTCHA_HMAC_KEY ?? "";

/** A signed challenge for GET /api/captcha/challenge, valid 5 minutes. The phone tries counters from 0 upwards. */
export async function createCaptchaChallenge(): Promise<Challenge> {
  const max = Math.max(1, Math.floor(Number(process.env.CAPTCHA_MAX_NUMBER)) || 50);
  return createChallenge({
    algorithm: ALGORITHM,
    cost: COST,
    counter: randomInt(max, Math.ceil(max / 2)),
    deriveKey,
    hmacSignatureSecret: hmacKey(), // altcha-lib throws on an empty key
    expiresAt: new Date(Date.now() + TTL_MS),
  });
}

/**
 * True once per solved challenge of ours: signature, expiry and solution checked by altcha-lib, then the challenge is
 * recorded as used until it expires. Never logs the payload. CAPTCHA_DISABLED=true accepts anything outside production.
 */
export async function verifyCaptcha(payload: unknown): Promise<boolean> {
  if (disabled() && process.env.NODE_ENV !== "production") return true;
  const key = hmacKey();
  if (!key) throw new Error("CAPTCHA_HMAC_KEY is not set."); // a server error, not a refusal blamed on the user
  const { challenge, solution } = (payload ?? {}) as Partial<Payload>;
  const result = await verifySolution({ challenge: challenge!, solution: solution!, deriveKey, hmacSignatureSecret: key }).catch(
    () => null, // malformed payload
  );
  if (!result?.verified || !challenge?.parameters.expiresAt) return false;

  const id = createHash("sha256").update(challenge.signature!).digest("hex");
  const { count } = await db.captchaUse.createMany({
    data: [{ id, expiresAt: new Date(challenge.parameters.expiresAt * 1000) }],
    skipDuplicates: true, // ON CONFLICT DO NOTHING: of two concurrent replays, exactly one inserts
  });
  await db.captchaUse.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count === 1;
}
