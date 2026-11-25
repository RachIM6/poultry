import { typedCentimes } from "@/lib/kernel/money";
import type { Cell, Sheet } from "@/lib/kernel/sheet";
import { zip } from "@/lib/zip";

// The smallest .xlsx (ECMA-376 SpreadsheetML) Excel and LibreOffice open without repair: one worksheet per sheet,
// text inline, money as numbers shown "#,##0.00" (French Excel shows 1 234,50), days as dates (Excel's short date).

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EPOCH = Date.UTC(1899, 11, 30); // Excel's day 0 (1900 system)

// ponytail: columns A–Z only; a sheet wider than 26 columns needs two-letter references.
function cell(c: Cell, ref: string): string {
  if (typeof c === "bigint") return `<c r="${ref}" s="1"><v>${typedCentimes(c, ".")}</v></c>`; // written from the bigint, no float
  if (typeof c === "string") return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
  return `<c r="${ref}" s="2"><v>${(Date.parse(`${c.day}T00:00:00Z`) - EPOCH) / 86_400_000}</v></c>`;
}

function worksheet(sheet: Sheet): string {
  const rows = [sheet.header, ...sheet.rows].map(
    (r, i) => `<row r="${i + 1}">${r.map((c, j) => cell(c, `${String.fromCharCode(65 + j)}${i + 1}`)).join("")}</row>`,
  );
  const cols = `<cols><col min="1" max="${sheet.header.length}" width="16" customWidth="1"/></cols>`; // dates and amounts fit
  return `${XML}<worksheet xmlns="${MAIN}">${cols}<sheetData>${rows.join("")}</sheetData></worksheet>`;
}

const STYLES = `${XML}<styleSheet xmlns="${MAIN}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`;

/** Sheet names: at most 31 characters, none of []:*?/\ (Excel refuses the file otherwise). */
export function toXlsx(sheets: Sheet[]): Buffer {
  const n = sheets.map((_, i) => i + 1);
  return zip([
    {
      name: "[Content_Types].xml",
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${n.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${n.map((i) => `<Relationship Id="rId${i}" Type="${REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: worksheet(s) })),
  ]);
}
