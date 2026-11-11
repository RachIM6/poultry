import { expect, type Page } from "@playwright/test";
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
  await expect.poll(stored).toBe(true);
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

/** A new owner with an organisation, signed in on the French dashboard. */
export async function ownerWithFarm(page: Page, farmName: string) {
  const e164 = await login(page, "fr");
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
export const farmDaysAgo = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date(Date.now() - n * 86_400_000));

export async function farmWithBatch(page: Page, strainId = "ross-308", placedOn = farmDaysAgo(0)) {
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), supplier: crypto.randomUUID(), feed: crypto.randomUUID(), batch: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Alf", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: crypto.randomUUID(), supplierId: ids.supplier, stockItemId: ids.feed, day: placedOn, quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
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
