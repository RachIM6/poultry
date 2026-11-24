import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import { storeFile } from "@/modules/documents";
import { attachExpenseReceipt, exportBooks } from "@/modules/finance";
import { MAX_EXPORT_RECEIPT_BYTES } from "@/modules/finance/application/export";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";
import { unzip } from "@/test/unzip";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

// Security audit: the books export reads and deflates receipts in memory, so past a cap it lists them instead (FN18).
describe("the books export's receipt cap", () => {
  it("leaves the month's receipts out past the cap, and lists them in French; the books are still there", async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    const a = await tenant("+212690000001");
    const box = uuidv7();
    const expense = { id: uuidv7(), day: "2026-03-12", category: "water", amountCentimes: "30000", paidFrom: "cash", treasuryId: box, note: null };
    const results = await push(a, [m("finance.createTreasuryAccount", { id: box, kind: "cash", name: "Caisse" }), m("finance.recordExpense", expense)], registry);
    expect(results.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    const file = await storeFile(a, "receipt", png, (tx, fileId) => attachExpenseReceipt(a, expense.id, fileId, tx));
    if (!file.ok) throw new Error(file.error);
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceId: expense.id } });

    const files = async () => {
      const exported = await exportBooks(a, "2026-03");
      if (!exported.ok) throw new Error(exported.error);
      return unzip(exported.value.zip);
    };
    expect([...(await files()).keys()]).toContain(`pieces/2026-03-12_${entry.id}.png`);

    // Only the recorded size is read before the cap: no need for 50 MB of bytes here.
    await db.storedFile.update({ where: { id: file.value.id }, data: { sizeBytes: MAX_EXPORT_RECEIPT_BYTES + 1 } });
    const capped = await files();
    expect([...capped.keys()].filter((k) => k.startsWith("pieces/"))).toEqual(["pieces/pieces-non-incluses.txt"]);
    expect(capped.get("pieces/pieces-non-incluses.txt")).toContain(`2026-03-12  ${entry.id}`);
    expect(capped.get("pieces/pieces-non-incluses.txt")).toMatch(/^Les pièces justificatives de ce mois pèsent 51 Mo, plus que les 50 Mo d'un export\./);
    expect([...capped.keys()]).toContain("livres-2026-03.xlsx");
  });
});
