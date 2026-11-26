import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { v7 as uuidv7 } from "uuid";

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

// A fresh number per run: rate limits persist in the database between runs.
export const randomMobile = () => `06${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

/** Every e2e account's password (ADR-015). */
export const PASSWORD = "e2e long password 2026";

const LABELS = {
  fr: { firstName: "Prénom", lastName: "Nom", identifier: "Téléphone ou e-mail", password: "Mot de passe", signIn: "Se connecter", phone: "Numéro de téléphone", confirm: "Confirmer le mot de passe", create: "Créer le compte", code: "Code", join: "Rejoindre" },
  ar: { firstName: "الاسم الشخصي", lastName: "الاسم العائلي", identifier: "الهاتف أو البريد الإلكتروني", password: "كلمة المرور", signIn: "دخول", phone: "رقم الهاتف", confirm: "تأكيد كلمة المرور", create: "إنشاء الحساب", code: "الرمز", join: "انضمام" },
};

/**
 * Through the real forms (ADR-015): a number with no account signs up (an owner who onboards next, or, with the
 * owner's `inviteCode`, a member who lands on the farm); a number with one signs in with PASSWORD. Returns its E.164.
 * `names`: the first and last name a sign-up types.
 */
export async function login(page: Page, locale: "ar" | "fr", phone = randomMobile(), inviteCode?: string, names = { first: "Nadia", last: "Testeur" }) {
  const l = LABELS[locale];
  const e164 = `+212${phone.replace(/\D/g, "").slice(-9)}`; // any spelling: 06…, +212 6…
  const [{ n }] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM "User" WHERE "phoneNumber" = $1`, [e164]);
  if (n > 0) {
    await page.goto(`/${locale}/login`);
    await page.getByLabel(l.identifier).fill(phone);
    await page.getByLabel(l.password, { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: l.signIn, exact: true }).click();
    return e164;
  }
  await page.goto(`/${locale}/${inviteCode ? "join" : "signup"}`);
  if (inviteCode) await page.getByLabel(l.code, { exact: true }).fill(inviteCode);
  await page.getByLabel(l.firstName, { exact: true }).fill(names.first);
  await page.getByLabel(l.lastName, { exact: true }).fill(names.last);
  await page.getByLabel(l.phone, { exact: true }).fill(phone);
  await page.getByLabel(l.password, { exact: true }).fill(PASSWORD);
  await page.getByLabel(l.confirm, { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: inviteCode ? l.join : l.create, exact: true }).click(); // waits for the captcha
  return e164;
}

/** The invite code the members screen shows the owner once, after "Inviter" (ADR-015). */
export async function inviteCode(owner: Page) {
  const shown = owner.locator("output").filter({ hasText: /^\s*[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}\s*$/ });
  await expect(shown).toBeVisible();
  return (await shown.textContent())!.trim();
}

/** Waits until the signed-in page has stored who is signed in on this phone (src/offline/db.ts, "poultry-device"). */
// expect.poll + evaluate awaits the page's promise; waitForFunction would take the Promise object itself as truthy.
export async function scopeRemembered(page: Page) {
  const stored = () =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open("poultry-device");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("session")) return (db.close(), resolve(false));
            const get = db.transaction("session").objectStore("session").get("current");
            get.onsuccess = () => (db.close(), resolve(Boolean(get.result)));
          };
          req.onerror = () => resolve(false);
        }),
    );
  await expect.poll(stored, { timeout: 15_000 }).toBe(true); // the first signed-in page may be slow under load
}

/** How many writes wait in the signed-in scope's outbox: lets a test know a local save committed before it navigates. */
export async function queuedWrites(page: Page) {
  return await page.evaluate(async () => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const read = <T,>(db: IDBDatabase, store: string, op: (s: IDBObjectStore) => IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(store).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const device = await open("poultry-device");
    const current = await read<{ scope: { userId: string; organizationId: string } }>(device, "session", (s) => s.get("current"));
    device.close();
    const db = await open(`poultry-${current.scope.userId}:${current.scope.organizationId}`);
    const count = await read(db, "outbox", (s) => s.count());
    db.close();
    return count;
  });
}

/**
 * Back online: waits until the outbox is empty, i.e. the server has answered every queued write (an applied one is on
 * the server; a refused one moves to "À vérifier" and the server check that follows shows it). A server check polled
 * right after going online races the push, which takes longer than its timeout under load.
 */
export async function outboxEmpty(page: Page) {
  await expect.poll(() => queuedWrites(page), { timeout: 30_000 }).toBe(0);
}

/**
 * The close run and the year close go through a whole year in one transaction, allowed SYNC_TX (src/lib/db.ts: 15 s,
 * after up to 5 s waiting for a connection). Under load the answer took ~10 s, the default expect timeout: wait past
 * the server's own budget for it.
 */
export const closeRun = { timeout: 30_000 };

/** A new owner with an organisation, signed in on the French dashboard. `names`: as `login`'s. */
export async function ownerWithFarm(page: Page, farmName: string, names?: { first: string; last: string }) {
  const e164 = await login(page, "fr", undefined, undefined, names);
  await page.getByLabel("Nom de l’exploitation ou raison sociale").fill(farmName);
  await page.getByLabel("Exploitant individuel").check();
  await page.getByRole("button", { name: "Créer" }).click();
  await page.waitForURL(/\/fr\/dashboard$/);
  return e164;
}

/**
 * Test setup through the app's own sync push, from inside the signed-in page (its cookie, its scope): faster than
 * clicking through farms, stock and batches when a journey is about something else. Payloads are the mutations'.
 */
export async function pushAs(page: Page, mutations: { type: string; payload: unknown }[]) {
  const results = await page.evaluate(async (ms) => {
    const scope = await new Promise<{ userId: string; organizationId: string }>((resolve) => {
      const req = indexedDB.open("poultry-device");
      req.onsuccess = () => {
        const get = req.result.transaction("session").objectStore("session").get("current");
        get.onsuccess = () => resolve(get.result.scope);
      };
    });
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "poultry", "x-sync-scope": `${scope.userId}:${scope.organizationId}` },
      body: JSON.stringify({ mutations: ms.map((m) => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...m })) }),
    });
    return ((await res.json()) as { results: { status: string }[] }).results.map((r) => r.status);
  }, mutations);
  expect(results).toEqual(mutations.map(() => "applied"));
}

/** A farm with a house, a feed item with 1 000 kg bought, and a batch of 1 000 chicks placed today. */
/** The farm day (Africa/Casablanca) `n` days ago, as YYYY-MM-DD. */
// Calendar days back from today's farm day: n × 24 h from "now" lands on the wrong day near midnight when Morocco's UTC
// offset differs between the two dates (seen at 23:27 UTC: a 42-day batch came out 41 days old).
export const farmDaysAgo = (n: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - n);
  return day.toISOString().slice(0, 10);
};

export async function farmWithBatch(page: Page, strainId = "ross-308", placedOn = farmDaysAgo(0)) {
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), supplier: crypto.randomUUID(), feed: crypto.randomUUID(), batch: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Alf", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: placedOn, quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
    { type: "flock.placeBatch", payload: { id: ids.batch, houseId: ids.house, strainId, placedOn, chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null } },
  ]);
  return ids;
}

/** Waits until the phone holds the reference data (strains, catalogue), downloaded after its first sync. */
export async function referenceCached(page: Page) {
  const stored = () =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open("poultry-device");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("reference")) return (db.close(), resolve(false));
            const get = db.transaction("reference").objectStore("reference").get("current");
            get.onsuccess = () => (db.close(), resolve(Boolean(get.result)));
          };
          req.onerror = () => resolve(false);
        }),
    );
  await expect.poll(stored).toBe(true);
}

/**
 * Waits until the service worker controls the page. `ready` resolves while the worker is still activating, a few ms
 * before its clients.claim(): offline in that gap, a chunk the page loads later (the batch's day, a form) isn't served
 * from the precache, and the screen shows its error instead.
 */
export async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

/**
 * Waits until the phone holds each record pushed with `pushAs` ("<entity>:<id>", src/offline/db.ts `records`): the page
 * pulls them after it opens, and a test that goes offline before then finds a screen without them.
 */
export async function pulled(page: Page, keys: string[]) {
  const missing = () =>
    page.evaluate(async (keys) => {
      const open = (name: string) =>
        new Promise<IDBDatabase | null>((resolve) => {
          const req = indexedDB.open(name);
          req.onupgradeneeded = () => req.transaction?.abort(); // not created by the app yet: don't create it empty
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
      const get = <T,>(db: IDBDatabase, store: string, key: string) =>
        new Promise<T | undefined>((resolve) => {
          if (!db.objectStoreNames.contains(store)) return resolve(undefined);
          const req = db.transaction(store).objectStore(store).get(key);
          req.onsuccess = () => resolve(req.result as T | undefined);
          req.onerror = () => resolve(undefined);
        });
      const device = await open("poultry-device");
      const current = device && (await get<{ scope: { userId: string; organizationId: string } }>(device, "session", "current"));
      device?.close();
      const db = current ? await open(`poultry-${current.scope.userId}:${current.scope.organizationId}`) : null;
      const left: string[] = [];
      for (const key of keys) if (!db || !(await get(db, "records", key))) left.push(key);
      db?.close();
      return left;
    }, keys);
  await expect.poll(missing, { timeout: 30_000 }).toEqual([]); // the first pull of a busy run, as outboxEmpty
}

/** A strain with a made-up curve (40 g on day 0, 200 g on day 7): no breeder table is committed yet (OQ5). Not a real
 * standard. Delete it with `DELETE FROM "Strain"` when the test ends. */
export async function syntheticStrain() {
  const strain = `e2e-${crypto.randomUUID().slice(0, 8)}`;
  await query(
    `WITH s AS (INSERT INTO "Strain" (id, name) VALUES ($1, 'Souche de test') RETURNING id),
          c AS (INSERT INTO "StandardCurve" ("strainId", source, version) SELECT id, 'E2E synthetic', '1' FROM s RETURNING id)
     INSERT INTO "StandardPoint" ("curveId", day, "bodyWeightGrams", "cumulativeFeedGrams") SELECT id, d, g, f FROM c, (VALUES (0, 40, 0), (7, 200, 150)) v(d, g, f)`,
    [strain],
  );
  return strain;
}
