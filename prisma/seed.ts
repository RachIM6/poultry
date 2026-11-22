import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { z } from "zod";
import { AccountsFile } from "../src/modules/finance/schema.ts";
import { CurveFile, EggGrade, LayingFile, Product, ProtocolTemplate, Strain } from "../src/modules/reference-data/schema.ts";

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
const eggGrades = read(z.array(EggGrade), new URL("egg-grades.json", dir)); // SPEC-m3 R8
const curvesDir = new URL("curves/", dir);
const curves = readdirSync(curvesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => read(CurveFile, new URL(f, curvesDir)));
const layingDir = new URL("laying/", dir); // SPEC-m3 R7
const layingCurves = readdirSync(layingDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => read(LayingFile, new URL(f, layingDir)));

// Cross-file references, checked before anything is written.
const vaccines = new Set(products.filter((p) => p.kind === "vaccine").map((p) => p.id));
for (const c of [...curves, ...layingCurves]) if (!strains.some((s) => s.id === c.strainId)) throw new Error(`curve ${c.strainId}-${c.version}: unknown strain`);
for (const t of templates) for (const i of t.items) if (!vaccines.has(i.productId)) throw new Error(`${t.id}: ${i.productId} is not a vaccine`);

// Charts of accounts (T28): every parent and fallback must exist, checked before anything is written.
const { accounts } = AccountsFile.parse(JSON.parse(readFileSync(new URL("./seed/finance/accounts.json", import.meta.url), "utf8")));
const numbers = new Set(accounts.map((a) => a.number));
for (const a of accounts) for (const n of [a.parent, a.fallback]) if (n && !numbers.has(n)) throw new Error(`account ${a.number}: unknown ${n}`);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  for (const s of strains) {
    await db.query(`INSERT INTO "Strain" (id, name, "productionTypes") VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "productionTypes" = EXCLUDED."productionTypes"`,
      [s.id, s.name, s.productionTypes],);
  }
  for (const p of products) {
    await db.query(
      `INSERT INTO "Product" (id, kind, "nameFr", "nameAr", "withdrawalDays", "eggWithdrawalDays") VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, "nameFr" = EXCLUDED."nameFr", "nameAr" = EXCLUDED."nameAr",
         "withdrawalDays" = EXCLUDED."withdrawalDays", "eggWithdrawalDays" = EXCLUDED."eggWithdrawalDays"`,
      [p.id, p.kind, p.nameFr, p.nameAr, p.withdrawalDays, p.eggWithdrawalDays],
    );
  }
  for (const t of templates) {
    await db.query(
      `INSERT INTO "ProtocolTemplate" (id, "nameFr", "nameAr", "reviewedByVet", "productionType", items) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET "nameFr" = EXCLUDED."nameFr", "nameAr" = EXCLUDED."nameAr",
         "reviewedByVet" = EXCLUDED."reviewedByVet", "productionType" = EXCLUDED."productionType", items = EXCLUDED.items`,
      [t.id, t.nameFr, t.nameAr, t.reviewedByVet, t.productionType, JSON.stringify(t.items)],
    );
  }
  for (const g of eggGrades) {
    await db.query(
      `INSERT INTO "EggGrade" (id, label, "sortOrder", "minGrams", "maxGrams") VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, "sortOrder" = EXCLUDED."sortOrder", "minGrams" = EXCLUDED."minGrams",
         "maxGrams" = EXCLUDED."maxGrams"`,
      [g.id, g.label, g.sortOrder, g.minGrams, g.maxGrams],
    );
  }
  for (const c of curves) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO "StandardCurve" ("strainId", source, version, sex) VALUES ($1, $2, $3, $4)
       ON CONFLICT ("strainId", version, sex) DO UPDATE SET source = EXCLUDED.source RETURNING id`,
      [c.strainId, c.source, c.version, c.sex],
    );
    await db.query(`DELETE FROM "StandardPoint" WHERE "curveId" = $1`, [rows[0].id]);
    await db.query(
      `INSERT INTO "StandardPoint" ("curveId", day, "bodyWeightGrams", "cumulativeFeedGrams")
       SELECT $1, * FROM unnest($2::int[], $3::int[], $4::int[])`,
      [rows[0].id, c.points.map((p) => p.day), c.points.map((p) => p.bodyWeightGrams), c.points.map((p) => p.cumulativeFeedGrams)],
    );
  }
  for (const c of layingCurves) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO "LayingCurve" ("strainId", source, version) VALUES ($1, $2, $3)
       ON CONFLICT ("strainId", version) DO UPDATE SET source = EXCLUDED.source RETURNING id`,
      [c.strainId, c.source, c.version],
    );
    await db.query(`DELETE FROM "LayingPoint" WHERE "curveId" = $1`, [rows[0].id]);
    const col = (k: keyof (typeof c.points)[number]) => c.points.map((p) => p[k]);
    await db.query(
      `INSERT INTO "LayingPoint" ("curveId", week, "layingRatePermille", "eggsPerHenHousedTenths", "eggWeightDg", "feedGramsPerHenDay", "bodyWeightGrams")
       SELECT $1, * FROM unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[])`,
      [rows[0].id, col("week"), col("layingRatePermille"), col("eggsPerHenHousedTenths"), col("eggWeightDg"), col("feedGramsPerHenDay"), col("bodyWeightGrams")],
    );
  }
  // An account retagged in the file (cgnc → pca, SPEC-finance §9) leaves its old chart; no table references these rows.
  await db.query(`DELETE FROM "LedgerAccount" WHERE (chart, number) NOT IN (SELECT * FROM unnest($1::text[], $2::text[]))`, [accounts.map((a) => a.chart), accounts.map((a) => a.number)]);
  for (const a of accounts) {
    await db.query(
      `INSERT INTO "LedgerAccount" (chart, number, label, "parentNumber", fallback) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chart, number) DO UPDATE SET label = EXCLUDED.label, "parentNumber" = EXCLUDED."parentNumber", fallback = EXCLUDED.fallback`,
      [a.chart, a.number, a.label, a.parent, a.fallback],
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
  `Reference data: ${strains.length} strains, ${curves.length} growth curves, ${layingCurves.length} laying curves, ${products.length} products, ${templates.length} protocol templates, ${eggGrades.length} egg grades, ${accounts.length} ledger accounts.`,
);
