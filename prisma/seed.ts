import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { z } from "zod";
import { CurveFile, Product, ProtocolTemplate, Strain } from "../src/modules/reference-data/schema.ts";

// `pnpm db:seed`, under plain Node (hence pg, not the generated Prisma client): reference data from
// prisma/seed/reference, validated by the module's own schemas. Idempotent: run it after any change to those files.
// Removing an entry from a file doesn't delete it. The demo farm arrives in T26.

try {
  process.loadEnvFile();
} catch {}

const dir = new URL("./seed/reference/", import.meta.url);
const read = <T>(schema: z.ZodType<T>, url: URL): T => schema.parse(JSON.parse(readFileSync(url, "utf8")));

const strains = read(z.array(Strain), new URL("strains.json", dir));
const products = read(z.array(Product), new URL("products.json", dir));
const templates = read(z.array(ProtocolTemplate), new URL("protocols.json", dir));
const curvesDir = new URL("curves/", dir);
const curves = readdirSync(curvesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => read(CurveFile, new URL(f, curvesDir)));

// Cross-file references, checked before anything is written.
const vaccines = new Set(products.filter((p) => p.kind === "vaccine").map((p) => p.id));
for (const c of curves) if (!strains.some((s) => s.id === c.strainId)) throw new Error(`curve ${c.strainId}-${c.version}: unknown strain`);
for (const t of templates) for (const i of t.items) if (!vaccines.has(i.productId)) throw new Error(`${t.id}: ${i.productId} is not a vaccine`);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  for (const s of strains) {
    await db.query(`INSERT INTO "Strain" (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, [s.id, s.name]);
  }
  for (const p of products) {
    await db.query(
      `INSERT INTO "Product" (id, kind, "nameFr", "nameAr", "withdrawalDays") VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, "nameFr" = EXCLUDED."nameFr", "nameAr" = EXCLUDED."nameAr",
         "withdrawalDays" = EXCLUDED."withdrawalDays"`,
      [p.id, p.kind, p.nameFr, p.nameAr, p.withdrawalDays],
    );
  }
  for (const t of templates) {
    await db.query(
      `INSERT INTO "ProtocolTemplate" (id, "nameFr", "nameAr", "reviewedByVet", items) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET "nameFr" = EXCLUDED."nameFr", "nameAr" = EXCLUDED."nameAr",
         "reviewedByVet" = EXCLUDED."reviewedByVet", items = EXCLUDED.items`,
      [t.id, t.nameFr, t.nameAr, t.reviewedByVet, JSON.stringify(t.items)],
    );
  }
  for (const c of curves) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO "StandardCurve" ("strainId", source, version) VALUES ($1, $2, $3)
       ON CONFLICT ("strainId", version) DO UPDATE SET source = EXCLUDED.source RETURNING id`,
      [c.strainId, c.source, c.version],
    );
    await db.query(`DELETE FROM "StandardPoint" WHERE "curveId" = $1`, [rows[0].id]);
    await db.query(
      `INSERT INTO "StandardPoint" ("curveId", day, "bodyWeightGrams", "cumulativeFeedGrams")
       SELECT $1, * FROM unnest($2::int[], $3::int[], $4::int[])`,
      [rows[0].id, c.points.map((p) => p.day), c.points.map((p) => p.bodyWeightGrams), c.points.map((p) => p.cumulativeFeedGrams)],
    );
  }
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}

console.log(
  `Reference data: ${strains.length} strains, ${curves.length} curves, ${products.length} products, ${templates.length} protocol templates.`,
);
