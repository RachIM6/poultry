# Data requests: export and deletion (law 09-08)

_Status: **decided defaults (2026-11-24), to review** by the product owner and a lawyer. Amends [ADR-007](decisions/ADR-007-data-protection-and-hosting.md) on one point: deleting an organisation keeps its books for their legal retention period. Nothing here is legal advice._

What an operator does when a farm or one of its members asks for their data, or for its deletion. The tools are operator commands (ADR-006: admin tools that cross tenants are separate and logged). Each run writes an `AuditEvent` on the organisation (`entity` = `Organization`, `action` = `export`, `left`, `rejoined` or `delete`, with the operator's name from `OPERATOR` or the system user).

| Command | Does |
|---|---|
| `pnpm org:export <organizationId> <out.zip>` | One .zip with every table holding the organisation's rows, as `tables/<Table>.json` and `.csv` (`;`, UTF-8 with BOM, like the books export), every stored file as `files/<id>.<ext>`, and `manifest.json`. It never overwrites a file, and it never includes another organisation's rows. |
| `pnpm org:left <organizationId> [--undo]` | Sets `Organization.leftAt` to now: the organisation has left the platform. `--undo` clears it. |
| `pnpm org:delete <organizationId> --confirm "<name>"` | Refused unless the organisation left 30 days ago or more and `<name>` is its exact name. Then it deletes as the retention table below says, in one transaction, and prints what was deleted and what was kept. |

The commands run from a checkout of the repository with its dev dependencies installed (esbuild bundles them), with `DATABASE_URL` pointing at the database. The code is in `src/ops/organization-data.ts`.

## Retention: the decided default

### The text

Law n° 9-88 on the accounting obligations of traders (_loi n° 9-88 relative aux obligations comptables des commerçants_), art. 22, second paragraph:

> « Les documents comptables et les pièces justificatives sont conservés pendant dix ans. »

- **Promulgation:** dahir n° 1-92-138 of 30 joumada II 1413 (25 December 1992), B.O. n° 4183 bis of 30 December 1992.
- **Amendment:** law n° 44-03 (dahir n° 1-05-211 of 14 February 2006, B.O. n° 5404 of 16 March 2006) changed other articles; the consolidated text still gives art. 22 as quoted.
- **Where it was read:** the consolidated text published on the Rabat eRegulations portal: <https://rabat.eregulations.org/media/Maroc%20-%20Obligations%20comptables%20commercants.pdf>, a copy of the cabinetbassamat.com text.
- **Not done:** it was not compared with the scanned B.O. itself. Several secondary sources agree on art. 22 and its ten years.

### Reading it conservatively

- **Who it applies to.** The law applies to traders (_commerçants_) within the meaning of the Code de commerce. A farmer is not always one. The platform still applies it to every organisation, whatever its legal form.
- **When the ten years start.** The law gives no starting point. The ten years run from the end of the fiscal year a record belongs to. That is later than the record's own date.
- **What is kept.** Not only the ledger: also the supporting documents (_pièces justificatives_). In Dawra, those are the records the entries were posted from, plus the receipts attached to them.

### After `org:delete`

**Kept, read-only, for 10 years after the end of their fiscal year:** the books and their supporting documents.

| Group | Tables |
|---|---|
| The organisation row and the books' entity | `Organization` (left as a shell: id, name, dates; its farms and members are gone), `LegalEntity` (name, form, ICE, IF, RC, CNSS: the books' heading) |
| Ledger | `JournalEntry`, `JournalLine`, `PostingOverride`, `LockedPeriod`, `FiscalYearClose`. Their immutability triggers stay on: deletion never updates or deletes them. |
| Treasury and bank | `TreasuryAccount`, `TreasuryTransfer`, `BankStatement`, `BankStatementLine`, `BankMatch` |
| Statements' sources | `ManualEntry`, `Expense`, `FixedAsset`, `Loan`, `LoanInstallment`, `Subsidy`, `SubsidyAsset`, `YearEndCount`, `YearEndValue`, `HensSchedule` |
| Purchases (supporting documents) | `Supplier` (phone erased), `Purchase`, `StockItem` (what was bought), `SupplierPayment`, `IssuedDebit`, `Batch` (the chick placement it posts) |
| Sales (supporting documents) | `Buyer` (phone erased), `Sale`, `SaleLine`, `BuyerPayment`, `InstrumentStatus` |
| Pay (supporting documents) | `Employee` (phone and member link erased), `SalaryAdvance`, `LabourRules`, `PayMonth`, `PayPayment` |
| Receipts | `StoredFile` rows with purpose `receipt`: the pieces attached to expenses, manual entries and fixed assets |
| Audit | Only the operator's own events (`export`, `left`, `rejoined`, `delete`): the record that the request was handled |

**Deleted 30 days after the organisation left:** everything else the organisation has, personal or not (ADR-007: "deleting an organisation removes all its data").

| Group | Tables |
|---|---|
| Members and access | `Membership`, `Invitation` (phone numbers), `Notification`; the members (below) |
| Farms | `Farm` (holder, vet and technician names and phones), `House`, `RegisterKeeper` (names) |
| Sync and audit | `Mutation`, `SyncVersion`, `Change` (a copy of every record), `AuditEvent` (all but the operator's events) |
| Files and documents | `StoredFile` (all but receipts: proof photos, the vault's scans), `Document`, `DocumentReminder` |
| Flock, health, eggs | `DailyEntry`, `Weighing`, `SoldBirds`, `BatchCost`, `StockMovement`, `Vaccination`, `VaccinationProtocol`, `Treatment`, `VetVisit` (vet names), `EggCollection`, `EggGrading`, `EggDiscard`, `EggDraw` |
| Biosecurity | `Visit` (visitor names, plates), `Disposal`, `ManureRemoval`, `Cleanout` and its `CleanoutStep`, `RodentCheck` |
| Workforce and climate | `Routine`, `OneOffTask`, `TaskDone`, `TaskAssignment`, `Attendance`, `StaffRecord` (accidents), `ClimateTargetSet`, `ClimateReading`, `PowerCut` |
| Planning, prices, management figures | `PlannedBatch`, `DowntimeRule`, `PriceObservation`, `Budget`, `FrozenAllocation`, `FrozenBatch`, `PostingCursor`, `ThresholdAlert` |
| Members of no other organisation | `User` (phone, name) with its `Session` and `Account` rows, `PushSubscription`, `NotificationPreference`, `AuthEvent` (login log), `Verification` (pending codes). A member of another organisation keeps their account; only their membership here goes. |

**Phones erased in kept tables:** `Buyer.phone`, `Supplier.phone`, `Employee.phone`, and `Employee.userId`. The names stay, because the documents need them to say who was paid or who paid.

**Not linked to anyone, so it stays:** login-log rows recorded before a user was known. Their phone is masked (`+2126•••••12`), and they have no `userId`.

**Every table is classified.** The export and the deletion refuse to run while a table is missing from these lists. So a new table must be added to `src/ops/organization-data.ts` and to this page first. The export finds the organisation's tables at runtime (every table with an `organizationId` column). It reaches a few tables without that column through their parent: `Organization`, `User` through `Membership`, and `CleanoutStep` through `Cleanout`.

**The end of the ten years is not built.** The ledger's triggers refuse deletes, so the final purge of the books needs its own decision and tool. The first organisation that can reach it would be in 2036. Add the purge before then.

## Step by step

### An organisation asks for its data (export)

1. **Check the request.** It must come from the organisation's owner: the phone number of an `owner` membership. A member who is not the owner gets their own data only (see below).
2. **Export.** Run `pnpm org:export <organizationId> <file>.zip`. The command prints the number of tables, rows and files.
3. **Hand it over.** Send the file over a channel the owner controls, never as a public link. It holds personal data: members' phones, workers' wages, visitors' names.
4. **Clean up.** Delete the local copy.
5. **Record the request.** Note it in the requests register: date, who asked, what was sent. The audit event records the run.

### An organisation leaves, or asks for deletion

1. **Check the request.** It must come from the owner. Give them the export first (above).
2. **Mark it as left.** Run `pnpm org:left <organizationId>`. Tell the owner two things:
   - the data will be deleted 30 days later, and they can change their mind until then (`--undo`);
   - the books stay, read-only, for ten years after each fiscal year (law 9-88 art. 22).
3. **Delete after 30 days.** Run `pnpm org:delete <organizationId> --confirm "<exact name>"`.
   - If it refuses with `TOO_SOON`, the 30 days aren't over yet.
   - If it refuses with `NOT_LEFT`, step 2 was not done.
   - If it refuses with `WRONG_NAME`, the name doesn't match the organisation's exact name.
4. **Report back.** Keep the printed summary with the request, and tell the owner what was deleted and what was kept.

### A member asks for their data (access)

The member's own data is:

- their `User` row;
- their `Membership` rows;
- their `AuthEvent` rows (`userId`);
- their `PushSubscription` and `NotificationPreference`;
- in each organisation, the records holding their user id: the columns named `userId`, `…By` or `…ById` (`recordedBy`, `createdBy`, `updatedBy`, `uploadedBy`, `byUserId`, `doneBy`, `invitedById`…).

The farm records themselves belong to the organisation. For those, the member asks the owner.

How to answer:

1. Find the user by phone: `SELECT id FROM "User" WHERE "phoneNumber" = '+212…'`.
2. Export the rows listed above as CSV.
3. Send them to the member's own phone or address. Record the request in the register.

### A member asks for deletion

1. **Remove the member.** The owner removes them in the app (Members screen, `removeMember`), or the operator does it on the owner's word.
2. **Delete the account, if they belong to no other organisation.** Delete, for that user id:
   - `PushSubscription`, `NotificationPreference` and `AuthEvent` rows;
   - `Verification` rows for their phone;
   - the `User` row (its `Session` and `Account` rows cascade).
3. **What stays.** Records they entered keep their user id, which now points at nobody. The organisation's `Employee` record about them is the owner's to edit or delete in the app. Its pay figures are supporting documents and stay with the books.

## Needs owner

| Item | What is needed |
|---|---|
| **CNDP filing** | The declaration or authorisation (ADR-007), with this retention table, the processors, and a contact for requests. Not done. |
| **Lawyer's review** | The 9-88 reading above: farmers who are not traders, the starting point of the ten years, and which records count as supporting documents. Two more texts to check:<br>- the tax code's own retention rule (CGI art. 211, ten years per secondary sources, not verified here);<br>- whether law 09-08 sets a deadline to answer a request. |
| **Health register** | Arrêté n° 2126-05 art. 9 has the keeper hold the register at least 1 year (meat) or 2 years (layers, breeders) after the birds leave (SPEC-m2-compliance CQ5). The deletion assumes the farmer keeps it from the export or the printed ONSSA register made before leaving. To confirm, or the batches' register rows must be kept for that period. |
| **Backups** | Deleted rows stay in database backups until those rotate. The backup retention must be stated to the owner and in the CNDP file. |
| **Access after leaving** | Marking an organisation as left does not lock it: members keep using it during the 30 days. Decide whether `leftAt` should make it read-only. |
| **Identity checks** | How an operator confirms the requester is the owner or the member (a call from the registered number, a signed letter). |
| **Requests register** | Where requests and answers are recorded, and who keeps it. |
