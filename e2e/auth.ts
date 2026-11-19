import type { Page } from "@playwright/test";
import { Client } from "pg";

// The app's own database (the production build under test reads DATABASE_URL too).
export async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

// Better Auth stores the pending code as "<code>:<attempts>".
export const codeFor = async (e164: string) =>
  (await query<{ value: string }>(`SELECT value FROM "Verification" WHERE identifier = $1 ORDER BY "createdAt" DESC LIMIT 1`, [e164]))[0]
    .value.split(":")[0];

// A fresh number per run: rate limits persist in the database between runs.
export const randomMobile = () => `06${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

const LABELS = {
  fr: { phone: "Numéro de téléphone", send: "Recevoir un code", code: "Code reçu", verify: "Se connecter" },
  ar: { phone: "رقم الهاتف", send: "استلام الرمز", code: "الرمز المستلم", verify: "دخول" },
};

/** Logs a new number in through the real form. Returns its E.164 form. */
export async function login(page: Page, locale: "ar" | "fr", phone = randomMobile()) {
  const l = LABELS[locale];
  const e164 = `+212${phone.slice(1)}`;
  await page.goto(`/${locale}/login`);
  await page.getByLabel(l.phone).fill(phone);
  await page.getByRole("button", { name: l.send }).click();
  await page.getByRole("status").waitFor();
  await page.getByLabel(l.code).fill(await codeFor(e164));
  await page.getByRole("button", { name: l.verify }).click();
  return e164;
}

/** A new owner with an organisation, signed in on the French dashboard. */
export async function ownerWithFarm(page: Page, farmName: string) {
  const e164 = await login(page, "fr");
  await page.getByLabel("Nom de l’exploitation ou raison sociale").fill(farmName);
  await page.getByLabel("Exploitant individuel").check();
  await page.getByRole("button", { name: "Créer" }).click();
  await page.waitForURL(/\/fr\/dashboard$/);
  return e164;
}
