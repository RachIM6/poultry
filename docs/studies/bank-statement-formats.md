# Bank statement formats in Morocco (FC9, T117)

Study of 2026-11-23. Question: which electronic statement files do Moroccan banks give their business customers, and which have a published specification we can build from? Rule from the product owner (2026-11-23): don't wait for the pilot's real files; build only from a published specification, cite it, and record the choice as a decided default, to review. All sources below were read on 2026-11-23.

## 1. What the banks say they offer

| Bank | Formats named on its own pages | Source |
|---|---|---|
| Attijariwafa bank | **MT940** over SWIFT (daily statements); **AMB 120** by e-mail ("Info-Relevé"); "AMB 120" and "MT 940" through Attijari EBICS | Brochure "Plan Cash management et paiements" [1] |
| Crédit du Maroc | Download of statements in **XLS, TXT, AMB120, MT940, CSV and PDF** on CDM e-Corporate; "SWIFT RELEVÉ MT940" listed as a priced service (price not read: the PDF's table layout doesn't extract cleanly) | CDM e-Corporate FAQ [2]; fee schedule [3] |
| Bank of Africa (BMCE) | "Transmission or receipt of bank statements in SWIFT **MT 940** format" (Trans Doc) | Trans Doc page [4] |
| Banque Populaire (BCP) | Business remote banking pages mention statement archives (10 years), no file format | BP Enterprise page [5] |
| CIH Bank, Crédit Agricole du Maroc, Saham Bank (ex-Société Générale Maroc), CFG Bank, BMCI | No page found naming a statement file format | Searches of 2026-11-23 (no result) |

The user guide of Crédit du Maroc's portal [6] shows a "Relevés de compte" page with download "sous différents formats" without listing them. No Moroccan bank page found mentions **camt.053** (ISO 20022) or **CFONB 120**, and none mentions OFX.

## 2. What is published

- **MT940** is a SWIFT standard (Category 9, Customer Statement Message). SWIFT's own User Handbook is behind a login (MyStandards), but banks publish their implementations, field by field, with the SWIFT notation. Built from:
  - ING, "Format Description Structured MT940 & MT942", v6.0 of 1 August 2023 [7]: tags :20: (16x), :25: (35x), :28C: (5n[/5n]), :60F: (1!a6!n3!a15d: D/C mark, YYMMDD, ISO 4217 currency, amount), :61: (value date 6!n, entry date 4!n MMDD, D/C mark, amount 15d, transaction type 1!a3!c, owner's reference 16x, "//" bank reference 16x, supplementary details 34x on the next line), :86: (6*65x: "only first line starts with a tag"), :62F:, :64:, :65:; amounts "formatted with a decimal comma", decimals per currency; the SWIFT FIN envelope ({1:}{2:}{4: … -}); the SWIFT X character set.
  - Citi Handlowy, "SWIFT MT940 Export User Guide", 25 January 2023 [8], pp. 19–23: the optional entry date and funds code (third letter of the currency), the **RC / RD** reversal marks of the standard, the comma "present even if the amount … does not have decimal places", unsigned amounts whose sign is the D/C mark, :60M: / :62M: intermediate balances.
- **AMB 120**: offered by Attijariwafa and Crédit du Maroc, but **no specification was found**, from the banks or from the GPBM. The name suggests a Moroccan variant of France's CFONB 120 (fixed 120-character records, published by the CFONB [9]), but no source says they are the same. Building it from the CFONB text would be a guess.
- **camt.053, CFONB 120, OFX**: published elsewhere, offered by no Moroccan bank found.
- **CSV / XLS exports**: Crédit du Maroc offers them; no bank publishes their columns. They differ by bank and portal version.

## 3. Decision (decided default, to review; SPEC-finance §9)

1. **MT940, built**: the one format both offered by Moroccan banks (Attijariwafa, Crédit du Maroc, Bank of Africa) and published field by field. Parser: `src/modules/finance/domain/bank-import.ts` (`parseMt940`).
2. **No second format.** CFONB 120 and camt.053 aren't offered by the banks found; AMB 120 is, but unpublished. Skipped until a bank gives its AMB 120 specification (or confirms it is CFONB 120 as published).
3. **CSV with the owner's mapping**, for banks that only export spreadsheets: generic, no bank layout assumed. The owner picks the separator (`;`, `,`, tab), header lines to skip, the date column and format, the label column, a signed amount column or a debit and a credit column, and the decimal comma, then sees a preview. XLS isn't read: the owner saves it as CSV.

### Reading choices

- **Years.** SWIFT dates are YYMMDD with no century: read 20YY. The entry date (MMDD) takes the value date's year, or the next / previous one across a new year (value 31 Dec, entry 2 Jan).
- **The line's day** is the entry (booking) date when given, else the value date: the bank's booking is what the books record.
- **Signs.** C and RD (reversal of a debit) are credits for the holder, +; D and RC are debits, −. A D balance is an overdraft, negative. This is the sign of a 5141 line (debit − credit), so the lines compare with the books as they are.
- **Currency.** Only MAD balances are accepted, with at most 2 decimals (ISO 4217): the books are in dirhams.
- **Checks.** Each message must balance: opening + Σ :61: = closing, else the file is refused with the line of its :62a:. Pages of one statement (:62M: then :60M: of the same amount) are joined; a file ending on a :62M: is refused. A file with statements of several accounts (:25:) is refused: one account per import. Unknown tags before the opening balance (:21:, :13D: …) are ignored; anything else between the balances other than :61: / :86: is refused.
- **Label.** The :86: text after the :61: (continuation lines joined), else the :61: supplementary details, else the owner's reference.
- **The statement** is the account's statement of the closing balance's day (T111's key: one per account and end day), created if missing; one already entered by hand with the same closing balance takes the lines. A CSV carries no balance we can trust, so the owner types the end day and the closing balance, as for a statement entered by hand.
- **Idempotency.** Each line is keyed by its statement and a SHA-256 of day, amount, reference and label, plus its rank among identical lines (two equal fees on one day). The same file imported again adds nothing. A file that gives an existing statement another closing balance or other lines is refused as a whole.
- **Matching.** Each imported line is paired with a book line of the same amount: one already ticked on the statement first, else the nearest untickable one up to the end day. The owner ticks it (T111); nothing is ticked automatically (FC9 keeps automatic matching rules out of scope).
- **The file** is untrusted: at most 512 KB (under Next's 1 MB server-action limit), a text-file extension, no NUL byte, decoded as UTF-8 or else Windows-1252, parsed field by field, never executed; only the parsed lines are stored.

### Fixtures

Synthetic, written by hand from [7] and [8] (`src/modules/finance/fixtures/bank/README.md`): no real statement was available. To review with the pilot's first real files: the :86: layout each bank uses, whether the entry date is given, AMB 120.

## Sources

1. Attijariwafa bank, "Plan Cash management et paiements", https://attijarientreprises.com/sites/default/files/2021-06/Cash_management_et_paiements.pdf (accessed 2026-11-23).
2. Crédit du Maroc, CDM e-Corporate FAQ, https://www.creditdumaroc.ma/sites/default/files/ecorpo/FAQ.pdf (accessed 2026-11-23): "Téléchargement des relevés électroniques aux formats : XLS, TXT, AMB120, MT940, CSV et PDF".
3. Crédit du Maroc, fee schedule, https://www.creditdumaroc.ma/sites/default/files/brevaire_cdm.pdf (accessed 2026-11-23): row "SWIFT RELEVÉ MT940".
4. Bank of Africa, Trans Doc, https://www.bankofafrica.ma/en/entreprises/banque-distance/transdoc (accessed 2026-11-23).
5. Banque Populaire, BP Enterprise, https://entreprise.groupebcp.com/en/large-enterprise/remote-banking/bp-enterprise (accessed 2026-11-23).
6. Crédit du Maroc, MyCDM Entreprise user guide, https://www.creditdumaroc.ma/sites/default/files/ecorpo/GuideUtilisateur.pdf (accessed 2026-11-23).
7. ING, "Format Description Structured MT940 & MT942 (Version 4) Strategic", v6.0, 1 August 2023, https://assets.ing.com/m/4dac40a51dd3ec00/original/ING-Format-Description-Structured-MT940-MT942-1.pdf (accessed 2026-11-23).
8. Citi Handlowy, "SWIFT MT940 Export User Guide", 25 January 2023, https://www.citihandlowy.pl/poland/files/SWIFT_MT940_Export_User_Guide_EN.pdf (accessed 2026-11-23).
9. CFONB, "Relevé de compte sur support informatique", July 2004, https://www.cfonb.org/fichiers/20130612113947_7_4_Releve_de_Compte_sur_support_informatique_2004_07.pdf (not read in full: listed for the AMB 120 question only).
