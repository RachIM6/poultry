import { describe, expect, it } from "vitest";
import { toXlsx } from "@/lib/xlsx";
import { unzip } from "@/test/unzip";

// SPEC-finance FN18 (T38). Checked by hand once in Excel 16: opens without repair, amounts are numbers, days are dates.
describe("toXlsx", () => {
  it("writes one worksheet per sheet, with numbers, dates and escaped text", () => {
    const files = unzip(toXlsx([
      { name: "Écritures", header: ["Date", "Libellé", "Débit"], rows: [[{ day: "2026-03-20" }, "Électricité <mars> & eau", 123_456n]] },
      { name: "Balance", header: ["Compte"], rows: [] },
    ]));
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    ]);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Écritures" sheetId="1" r:id="rId1"/><sheet name="Balance" sheetId="2" r:id="rId2"/>');
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A2" s="2"><v>46101</v></c>'); // 2026-03-20 as an Excel date
    expect(sheet).toContain('<t xml:space="preserve">Électricité &#60;mars&#62; &#38; eau</t>');
    expect(sheet).toContain('<c r="C2" s="1"><v>1234.56</v></c>');
  });
});
