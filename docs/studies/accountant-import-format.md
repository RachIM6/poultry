# Accountant import format (FQ10, FC10, T118)

Study of 2026-11-23. Question: which file can a Moroccan expert-comptable or fiduciaire import straight into their accounting software, with a specification the vendor or a standard publishes? Rule from the product owner: build no format whose specification is not published.

## 1. What the firms use

There is no published market-share survey for Moroccan firms. The sources found name the same vendors:

| Software | Cited as used in Morocco by | Journal-entry import with a public specification? |
|---|---|---|
| Sage 100 Comptabilité (and Sage 50) | Upsilon Consulting, a Moroccan firm: "Sage, KHABIR, CEGID et EBP" are the most used [1]; Sage Maroc sells Sage 100 and Sage 50 [2] | Its own "format paramétrable" is defined by each user in the software; no public field-by-field description of a Sage import file was found [3]. Sage 100 ships an import template for the **FEC**, `Modèles d'importation\FEC\Import FEC.ema` [3]. |
| EBP Compta (Maroc edition) | [1]; EBP sells a Morocco edition [4] | The Morocco product sheet lists "Import / Export du FEC avec pièces jointes" and "Import texte des écritures et des comptes au format EBP" [4]. No public description of the "format EBP" was found. |
| Cegid | [1] | Cegid documents its FEC export in a public technical note, restating article A47 A-1 [5]. |
| KHABIR (local) | [1] | No public import specification found. |
| Odoo, Experio, Dolibarr | Compared by a Moroccan vendor [6] | Not checked further: the firms' software above comes first. |

## 2. The official ledger files

- **Morocco, CNC avis n° 24 (14 June 2023)** "relatif à la tenue de la comptabilité sous format électronique" [7], issued at the DGI's request under article 145 of the CGI as changed by the 2018 finance law. Article 2: every computerised accounting system produces a "Fichier des Ecritures Comptables (FEC)" for each fiscal year, with at least the information of point 3 of the annex. Point 3 lists 18 fields by name and type: `Code_Journal`, `Libelle_Journal`, `Num_Ecriture`, `Date_Ecriture`, `Num_Compte`, `Libelle_Compte`, `Num_Compte_Aux`, `Libelle_Compte_Aux`, `Ref_Piece`, `Date_Piece`, `Libelle_Ecriture`, `Montant_Debit`, `Montant_Credit`, `Lettrage_Ecriture`, `Date_Lettrage`, `Date_Validation`, `Montant_Devise`, `Id_devise`. **It gives no technical format**: no separator, encoding, date or amount format, no file name. No DGI notice filling that gap was found. Building it would mean guessing the technical part, so it is not built.
- **France, article A47 A-1 of the Livre des procédures fiscales** (arrêté of 29 July 2013, as amended; text read on 2026-11-23 from codes.droit.org's edition of 2026-10-30, built from the Légifrance API [8]; legifrance.gouv.fr refused automated access). A complete public specification: VI 1° (flat file, records ended by CR and/or LF, fields "obligatoirement séparées par une tabulation ou le caractère « | »"), VII 1° (the 18 fields in order, extra fields allowed after them, entries in the order they were validated), VII 4° (field names on the first line), IX (file name `SirenFECAAAAMMJJ`), XII (ASCII, ISO 8859-15 or UTF-8; decimal comma, no thousands separator, sign as first or last character; dates `AAAAMMJJ`). The BOFiP commentary BOI-CF-IOR-60-40-20-20170607 adds: an unused field is left empty, the unused side of Debit / Credit is 0 [9].
- The two lists match: avis n° 24's 18 fields are A47 A-1 VII 1°'s 18 fields, in the same order, under other names (`Code_Journal` = `JournalCode` … `Id_devise` = `Idevise`).

## 3. Decision (decided default, to review)

Build **one format: the FEC of article A47 A-1 LPF** (VII 1° variant, flat file), with its own field names. Why:

- it is the only journal-entry file found whose full specification is published (by a State, in a legal text);
- Sage 100 and EBP, the two vendors most cited for Morocco, import it: EBP's Morocco edition lists "Import / Export du FEC" [4]; Sage 100 ships an "Import FEC" template [3] (seen in the French product; not checked in the Morocco edition). Cegid documents it [5];
- its 18 fields are those the CNC requires of a Moroccan FEC, so the content already meets avis n° 24; only the names and the technical layer differ, and avis n° 24 does not fix the latter.

Not built: the vendor-specific formats (no public specification) and the Moroccan FEC's own field names (no technical format). Revisit when the pilot's firm names its software and confirms its import, or when the DGI publishes a technical notice for the Moroccan FEC.

### Choices inside the specification

| Rule | Our file |
|---|---|
| Separator (VI 1° c) | Tab. A tab, CR or LF inside a label becomes a space. |
| Records (VI 1° a) | CRLF. |
| Encoding (XII 1°) | UTF-8 without BOM (party names may be in Arabic, which ISO 8859-15 can't hold). |
| Header (VII 4°) | The 18 field names, then FN18's analytic tags as extra fields: `Tiers`, `Ferme`, `Batiment`, `Lot`. |
| JournalCode / JournalLib | Our codes, kept: AC Achats, VT Ventes, CA Caisse, BQ Banque, EF Effets et chèques, OD Opérations diverses. |
| EcritureNum | 1, 2, 3… over the file, one number per entry, in the order entries were posted. |
| EcritureDate, PieceDate | The entry's day, `AAAAMMJJ`. |
| CompteNum / CompteLib | The account of the entity's chart (CGNC, PCA overlay) and its label. |
| CompAuxNum / CompAuxLib, EcritureLet / DateLet, Montantdevise / Idevise | Empty: no sub-ledger accounts, lettering or foreign currency yet. |
| PieceRef | FN18's "Pièce": a manual entry's piece, else the entry's id (which also names its receipt in the zip). |
| Debit / Credit | Both filled, decimal comma, two decimals, no thousands separator. |
| ValidDate | The farm day the entry was posted. |
| File name (IX) | `FECAAAAMMJJ.txt`, the month's last day; no Siren (French register number). |

### Differences from the tax-audit FEC, to review with the firm

- A file per month (the export screen's period), not per fiscal year: EcritureNum restarts at 1 each month, and the year's à-nouveaux entry is only in the opening month's file.
- No description file (A47 A-1 XI): the import doesn't need it.
- Sage asks every account at the dossier's fixed length [3]: the firm sets its import template, or pads, on its side.

## Sources (accessed 2026-11-23)

1. Upsilon Consulting, "Logiciel de comptabilité - Lequel choisir ?", https://upsilon-consulting.com/logiciel-de-comptabilite-que-choisir/
2. Sage Maroc, logiciels comptabilité, https://www.sage.com/fr-ma/logiciels-comptabilite/
3. Sage Community Hub, "import fichier FEC dans Sage 100", https://communityhub.sage.com/fr/sage-100/f/discussion-generale/270834/import-fichier-fec-dans-sage-100 (template path and account-length error, from Sage's forum, not a vendor manual)
4. EBP, fiche produit EBP Compta Elite, édition Maroc (06/2025), https://infos.ebp.com/hubfs/Fiches%20produits/Fiche%20Produits%20Maroc/FP-Compta-ELITE-MA-0625.pdf
5. Cegid PMI, note technique "Export légal FEC", version 16.18 du 30/01/2026, https://cegid-pmi-help.cegid.com/CegidPMIOnlineHelp/Prod/PMI/assets/docs/NT_FEC.pdf
6. AY Automate, meilleurs logiciels comptabilité Maroc, https://www.ayautomate.com/fr/blog/meilleurs-logiciels-comptabilite-maroc (a vendor's view)
7. CNC, Avis n° 24 relatif à la tenue de la comptabilité sous format électronique (signed 14 June 2023), https://www.finances.gov.ma/Publication/depp/2023/Avis%20n%C2%B0%2024%20comptabilit%C3%A9%20sous%20format%20%C3%A9l%C3%A9ctronique.pdf (scanned; annex point 3 is on page 5); listed on https://www.finances.gov.ma/fr/Nos-metiers/Pages/cnc-normes.aspx
8. Livre des procédures fiscales, article A47 A-1, https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027804775/ ; text read in https://codes.droit.org/PDF/Livre%20des%20proc%C3%A9dures%20fiscales.pdf (edition 2026-10-30)
9. BOFiP, BOI-CF-IOR-60-40-20-20170607, https://bofip.impots.gouv.fr/bofip/9028-PGP.html/identifiant=BOI-CF-IOR-60-40-20-20170607
