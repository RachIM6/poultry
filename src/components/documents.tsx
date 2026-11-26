"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { v7 as uuidv7 } from "uuid";
import { Field, FileUpload, Shell, of, useOnline, type Screen } from "@/components/local-screen";
import { useInline } from "@/components/focus";
import { empty, formActions, row, rowHead, rowTable } from "@/components/layout";
import { Sheet } from "@/components/sheet";
import { danger, field, ghost, primary, primarySm, secondarySm } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { DOCUMENT_CATEGORIES, DOCUMENT_MUTATIONS as D, byExpiry, documentState, type DocumentDto, type DocumentState } from "@/modules/documents/shared";
import type { FarmDto } from "@/modules/farm-registry/schema";

// SPEC-m2-compliance DC1–DC3 on a static shell: the vault, recorded offline; a scan is attached online (ADR-011).
// Owners and managers only.

// DC1: what an edit may change; the scan (fileId) is attached online, not edited here.
const EDITABLE = ["title", "category", "farmId", "issuedOn", "expiresOn", "notes"] as const;

const STATE_STYLE: Record<DocumentState, string> = {
  expired: "bg-alert-soft text-alert-fg",
  soon: "bg-chick-soft text-chick-fg",
  valid: "bg-olive-soft text-olive",
  none: "bg-line text-ink-2",
};

/** Into the page header's actions (the shell's `<span id="actions">`, as stock.tsx): the opener needs the screen's state. */
function HeaderActions({ children }: { children: ReactNode }) {
  const slot = document.getElementById("actions");
  return slot && createPortal(children, slot);
}

export const DocumentsScreen = () => <Shell action="documents.manage" forbidden="Documents.forbidden" entities={["farm", "document"]} screen={Vault} />;

function Vault({ records, save, db }: Parameters<Screen>[0]) {
  const t = useTranslations("Documents");
  const tr = useTranslations(); // errors come as full keys ("errors.X", "Files.failed")
  const locale = useLocale();
  const online = useOnline();
  const queued = useLiveQuery(() => db.outbox.toArray(), [db]);
  const { open, opener, close } = useInline<string>(); // "new", or the id of the document being edited
  const [error, setError] = useState<string>();
  const today = farmDayOf(new Date());
  const farms = of<FarmDto>(records, "farm").sort((x, y) => x.name.localeCompare(y.name));
  const docs = of<DocumentDto>(records, "document").sort(byExpiry);
  const editing = docs.find((d) => d.id === open) ?? null;
  const unsent = new Set((queued ?? []).flatMap((e) => e.recordKeys ?? []));
  const day = (d: string) => formatDay(d as FarmDay, locale);
  // An edit sends only what changed: an edit of other fields on another phone survives (ADR-003 §5).
  const update = async (d: DocumentDto, before: DocumentDto) => {
    const changes = Object.fromEntries(EDITABLE.filter((k) => d[k] !== before[k]).map((k) => [k, d[k]]));
    if (Object.keys(changes).length === 0 || (await save({ type: D.updateDocument, payload: { id: d.id, changes } }, "document", { ...before, ...changes }))) close();
  };

  // What the table's header already says is for screen readers only from lg (`<l>` in the message).
  const label = (chunks: ReactNode) => <span className="lg:sr-only">{chunks}</span>;
  // tasks/plan-ui-cleanup.md §4: the vault full width, a table from lg (cards on the phone); « Ajouter un document » is
  // the page header's action; adding and editing open a sheet.
  return (
    <>
      <HeaderActions>
        <button type="button" aria-haspopup="dialog" {...opener("new")} className={primarySm}>{t("add")}</button>
      </HeaderActions>
      {error && <p role="alert" className={danger}>{tr(error)}</p>}
      {docs.length === 0 ? (
        <p className={empty}>{t("none")}</p>
      ) : (
        <ul className={`${rowTable} lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]`} aria-label={t("list")}>
          <li aria-hidden="true" className={rowHead}>
            <span>{t("colDocument")}</span>
            <span>{t("category")}</span>
            <span>{t("farm")}</span>
            <span>{t("colExpires")}</span>
            <span>{t("colFile")}</span>
          </li>
          {docs.map((d) => {
            const state = documentState(d.expiresOn, today);
            // The phone's card, its parts in the table's columns from lg (`lg:contents`); the state sits under the expiry day.
            return (
              <li key={d.id} className={row}>
                <span className="flex flex-col">
                  <span className="font-semibold">{d.title}</span>
                  {d.notes && <span className="text-sm text-ink-2">{d.notes}</span>}
                </span>
                <span className="text-sm text-muted lg:contents">
                  <span className="lg:text-base lg:text-ink">{t(`categories.${d.category}`)}</span>
                  <span className="lg:hidden"> · </span>
                  <span className="lg:text-base lg:text-ink">{farms.find((f) => f.id === d.farmId)?.name ?? t("wholeOrganization")}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-start lg:gap-1">
                  {d.expiresOn && <span className="lg:whitespace-nowrap">{t.rich("expiresOn", { date: day(d.expiresOn), l: label })}</span>}
                  <span className={`rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap ${STATE_STYLE[state]}`}>{t(`states.${state}`)}</span>
                </span>
                <div className="flex flex-wrap items-center justify-between gap-2 lg:contents">
                  <span>
                    {d.fileId ? (
                      <a href={`/api/files/${d.fileId}`} className="underline underline-offset-4">{t("file")}</a>
                    ) : unsent.has(`document:${d.id}`) || !online ? (
                      <span className="block text-sm text-muted lg:max-w-52">{t("fileLater")}</span>
                    ) : (
                      <FileUpload url={`/api/files?purpose=document&document=${d.id}`} accept="application/pdf,image/jpeg,image/png,image/webp" label={t("fileAdd")} look={`${secondarySm} lg:whitespace-nowrap`} onError={setError} />
                    )}
                  </span>
                  {/* The record's name is in the accessible name, not in the visible label (§1.5). */}
                  <button type="button" aria-haspopup="dialog" aria-label={t("edit", { title: d.title })} {...opener(d.id)} className={secondarySm}>{t("editShort")}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={open !== undefined} onClose={close} title={editing ? t("edit", { title: editing.title }) : t("add")}>
        <DocumentForm
          key={open}
          doc={editing}
          farms={farms}
          onCancel={close}
          onSave={async (d) => {
            if (editing) return update(d, editing);
            // fileId is null here and dropped by the schema: the scan is attached online, later
            if (await save({ type: D.createDocument, payload: d }, "document", d)) close();
          }}
        />
      </Sheet>
    </>
  );
}

/** A new document, or an edit of `doc` (the same form, prefilled). */
function DocumentForm({ doc = null, farms, onSave, onCancel }: { doc?: DocumentDto | null; farms: FarmDto[]; onSave: (d: DocumentDto) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations("Documents");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim() || null;
    await onSave({
      id: doc?.id ?? uuidv7(),
      title: get("title") ?? "",
      category: get("category") as DocumentDto["category"],
      farmId: get("farm"),
      issuedOn: get("issuedOn"),
      expiresOn: get("expiresOn"),
      notes: get("notes"),
      fileId: doc?.fileId ?? null,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={doc ? t("edit", { title: doc.title }) : t("add")}>
      <Field label={t("title")}>{(id) => <input id={id} name="title" required maxLength={120} defaultValue={doc?.title} className={field} />}</Field>
      <Field label={t("category")}>
        {(id) => (
          <select id={id} name="category" defaultValue={doc?.category} className={field}>
            {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("farm")}>
        {(id) => (
          <select id={id} name="farm" defaultValue={doc ? (doc.farmId ?? "") : undefined} className={field}>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="">{t("wholeOrganization")}</option>
          </select>
        )}
      </Field>
      <Field label={t("issuedOn")}>{(id) => <input id={id} name="issuedOn" type="date" defaultValue={doc?.issuedOn ?? ""} className={field} />}</Field>
      <Field label={t("expiresOnField")}>{(id) => <input id={id} name="expiresOn" type="date" defaultValue={doc?.expiresOn ?? ""} className={field} />}</Field>
      <Field label={t("notes")}>{(id) => <input id={id} name="notes" maxLength={500} defaultValue={doc?.notes ?? ""} className={field} />}</Field>
      <div className={formActions}>
        <button type="submit" className={primary}>{t("save")}</button>
        <button type="button" onClick={onCancel} className={ghost}>{t("cancel")}</button>
      </div>
    </form>
  );
}
