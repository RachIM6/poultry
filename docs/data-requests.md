# Data requests: export and deletion (law 09-08)

_Status: **decided defaults (2026-11-24), to review** by the product owner and a lawyer. Amends [ADR-007](decisions/ADR-007-data-protection-and-hosting.md) on one point: deleting an organisation keeps its books for their legal retention period. Nothing here is legal advice._

What an operator does when a farm or one of its members asks for their data, or for its deletion. The tools are operator commands (ADR-006: admin tools that cross tenants are separate and logged). Every run is audited, with the operator's name from `OPERATOR` or the system user:

- the `org:*` commands write an `AuditEvent` on the organisation (`entity` = `Organization`, `action` = `export`, `left`, `rejoined` or `delete`);
- the `member:*` commands write an `AuthEvent` (the login log), `action` = `member_export` or `member_delete`, with the masked phone, no user id, and `reason` = `operator:<name>`. A member's request belongs to no single organisation, and it often comes from someone who no longer belongs to any.

| Command | Does |
|---|---|
| `pnpm org:export <organizationId> <out.zip>` | One .zip with every table holding the organisation's rows, as `tables/<Table>.json` and `.csv` (`;`, UTF-8 with BOM, like the books export), every stored file as `files/<id>.<ext>`, and `manifest.json`. It never overwrites a file, and it never includes another organisation's rows. |
| `pnpm org:left <organizationId> [--undo]` | Sets `Organization.leftAt` to now: the organisation has left the platform and is read-only (below). `--undo` clears it and lifts the lock. |
| `pnpm org:delete <organizationId> --confirm "<name>"` | Refused unless the organisation left 30 days ago or more and `<name>` is its exact name. Then it deletes as the retention table below says, in one transaction, and prints what was deleted and what was kept. |
| `pnpm member:export <phone> <out.zip>` | One .zip of a member's own data across organisations, laid out like the organisation export (see "A member asks for their data"). The phone is typed as `06…` or `+2126…`. It never overwrites a file. |
| `pnpm member:delete <phone> --confirm` | Erases a member's personal data across organisations (see "A member asks for deletion"), in one transaction, and prints what was deleted and kept. Refused with `LAST_OWNER` while they are the last owner of an organisation that has not left; it names those organisations. |

The commands run from a checkout of the repository with its dev dependencies installed (esbuild bundles them), with `DATABASE_URL` pointing at the database. The code is in `src/ops/organization-data.ts` and `src/ops/member-data.ts`.

## While an organisation has left (the 30 days)

_Decided default (2026-11-24), to review._ From `pnpm org:left` until `org:delete` (or `--undo`), the organisation is **read-only**:

- **Members can still sign in.** The home screen shows a notice: the organisation left on that day, it is read-only, its data goes 30 days after it left except the books, and the owner asks the platform team for the full export.
- **Reads keep working:** every screen, the sync pull, the books export (`/api/finance/export`) and the files already stored.
- **Every write is refused** with `ORGANIZATION_LEFT` (« Cette exploitation a quitté la plateforme… », in French and Arabic):
  - sync pushes: each mutation is rejected, and the phone lists it with what was typed, like any refused write;
  - server actions (books, closing, treasury, members, settings…) and file uploads.
- **No one new joins:** its pending invitations can't be accepted.
- **Undo:** `pnpm org:left <id> --undo` lifts the lock at once.
- **The owner's export.** There is no full export in the app; the books export covers the ledger only. The owner asks for the full export, and the operator runs `pnpm org:export`, as below.

How it is enforced:

- `getTenantContext` (identity) puts `leftAt` on the tenant context.
- The sync push refuses every mutation of such a context (`src/lib/sync/server.ts`).
- Server actions and the upload route take their context from `getWriteContext`, which refuses it.
- `can()` is not the place: some reads are gated by the same permissions as writes (the members list, the vault, attendance in the pull), and they must keep working.

Not refused: a member's own settings, which are not the organisation's data (language, quiet hours, push subscriptions). The scheduler's own work goes on too (reminders, postings of what was recorded before).

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
- the `Invitation` rows sent to their number;
- in every table, the rows holding their user id: the uuid columns named `userId`, `…UserId`, `…By` or `…ById`. That covers:
  - their `Membership` rows, their `AuthEvent` login log, their `PushSubscription` and `NotificationPreference`, their `Notification` inbox;
  - the `Employee` record linked to them, with their attendance;
  - in each organisation, the records they entered (`recordedBy`, `createdBy`, `updatedBy`, `uploadedBy`, `byUserId`, `doneBy`, `invitedById`…).

Never exported: their sessions, accounts and pending codes (`Session`, `Account`, `Verification`). The farm's other records belong to the organisation. For those, the member asks the owner.

How to answer:

1. **Check the request** (see "Identity checks" below).
2. **Export.** Run `pnpm member:export <phone> <file>.zip`. It prints the number of tables and rows. `NOT_FOUND`: no account signs in with that number.
3. **Hand it over.** Send the file to the member's own phone or address, never as a public link.
4. **Clean up.** Delete the local copy, and record the request in the register.

### A member asks for deletion

1. **Check the request.** If they are the last owner of an organisation that has not left, the organisation must first get another owner, or leave (above). Otherwise `member:delete` refuses with `LAST_OWNER` and names it.
2. **Delete.** Run `pnpm member:delete <phone> --confirm`. In one transaction, it:
   - deletes their memberships in every organisation, the invitations to their number, and their inbox (`Notification`, and its copies in the sync history);
   - deletes the account: the `User` row with its `Session` and `Account` rows, `AuthEvent`, `PushSubscription`, `NotificationPreference`, and `Verification` codes for their number.
3. **What stays.**
   - **The books' records.** As `org:delete` does: the `Employee` record linked to them, or holding their number, keeps the name, and loses the phone and the user link. Its pay figures are supporting documents. Its copies in the sync history are erased too, but a phone that already holds the record (the owner's or a manager's) keeps the number until the record next changes.
   - **The audit log** keeps its events. Where a snapshot copied their number (an employee record), the number is masked (`+2126•••••12`).
   - **The records they entered** keep their user id, which now names nobody.
   - **Numbers the owner typed** into the farm's own records (a farm's vet, a buyer, a supplier) are the owner's to edit in the app.
4. **Report back.** Keep the printed summary with the request, and tell the member what was deleted and what was kept.

## Needs owner

| Item | What is needed |
|---|---|
| **CNDP filing** | The declaration or authorisation (ADR-007), with this retention table, the processors, and a contact for requests. Not done. |
| **Lawyer's review** | The 9-88 reading above: farmers who are not traders, the starting point of the ten years, and which records count as supporting documents. Two more texts to check:<br>- the tax code's own retention rule (CGI art. 211, ten years per secondary sources, not verified here);<br>- whether law 09-08 sets a deadline to answer a request. |
| **Health register** | Arrêté n° 2126-05 art. 9 has the keeper hold the register at least 1 year (meat) or 2 years (layers, breeders) after the birds leave (SPEC-m2-compliance CQ5). The deletion assumes the farmer keeps it from the export or the printed ONSSA register made before leaving. To confirm, or the batches' register rows must be kept for that period. |
| **Backups** | Deleted rows stay in database backups until those rotate. The backup retention must be stated to the owner and in the CNDP file. |
| **Access after leaving** | Decided default, to review: read-only during the 30 days (see "While an organisation has left"). Confirm, and whether its scheduled reminders should stop too. |
| **Identity checks** | How an operator confirms the requester is the owner or the member (a call from the registered number, a signed letter). |
| **Requests register** | Where requests and answers are recorded, and who keeps it. |
