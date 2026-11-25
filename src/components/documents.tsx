"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, FileUpload, Shell, of, useOnline, type Screen } from "@/components/local-screen";
import { card, danger, field, primary, secondary } from "@/components/ui";
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

export const DocumentsScreen = () => <Shell action="documents.manage" forbidden="Documents.forbidden" entities={["farm", "document"]} screen={Vault} />;

function Vault({ records, save, db }: Parameters<Screen>[0]) {
  const t = useTranslations("Documents");
  const tr = useTranslations(); // errors come as full keys ("errors.X", "Files.failed")
  const locale = useLocale();
  const online = useOnline();
  const queued = useLiveQuery(() => db.outbox.toArray(), [db]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // the document being edited
  const [error, setError] = useState<string>();
  const today = farmDayOf(new Date());
  const farms = of<FarmDto>(records, "farm").sort((x, y) => x.name.localeCompare(y.name));
  const docs = of<DocumentDto>(records, "document").sort(byExpiry);
  const unsent = new Set((queued ?? []).flatMap((e) => e.recordKeys ?? []));
  const day = (d: string) => formatDay(d as FarmDay, locale);
  // An edit sends only what changed: an edit of other fields on another phone survives (ADR-003 §5).
  const update = async (d: DocumentDto, before: DocumentDto) => {
    const changes = Object.fromEntries(EDITABLE.filter((k) => d[k] !== before[k]).map((k) => [k, d[k]]));
    if (Object.keys(changes).length === 0 || (await save({ type: D.updateDocument, payload: { id: d.id, changes } }, "document", { ...before, ...changes }))) setEditing(null);
  };

  return (
    <>
      {adding ? (
        <DocumentForm
          farms={farms}
          onCancel={() => setAdding(false)}
          onSave={async (d) => {
            // fileId is null here and dropped by the schema: the scan is attached online, later
            if (await save({ type: D.createDocument, payload: d }, "document", d)) setAdding(false);
          }}
        />
      ) : (
        <button type="button" aria-expanded={false} onClick={() => setAdding(true)} className={secondary}>{t("add")}</button>
      )}
      {error && <p role="alert" className={danger}>{tr(error)}</p>}
      {docs.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("list")}>
          {docs.map((d) => {
            const state = documentState(d.expiresOn, today);
            if (editing === d.id) return <li key={d.id}><DocumentForm doc={d} farms={farms} onCancel={() => setEditing(null)} onSave={(changed) => update(changed, d)} /></li>;
            return (
              <li key={d.id} className={card}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="font-semibold">{d.title}</span>
                    <span className="text-sm text-muted">
                      {t(`categories.${d.category}`)} · {farms.find((f) => f.id === d.farmId)?.name ?? t("wholeOrganization")}
                    </span>
                  </span>
                  <span className={`rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap ${STATE_STYLE[state]}`}>{t(`states.${state}`)}</span>
                </div>
                {d.expiresOn && <span>{t("expiresOn", { date: day(d.expiresOn) })}</span>}
                {d.notes && <span className="text-sm text-ink-2">{d.notes}</span>}
                {d.fileId ? (
                  <a href={`/api/files/${d.fileId}`} className="underline underline-offset-4">{t("file")}</a>
                ) : unsent.has(`document:${d.id}`) || !online ? (
                  <span className="text-sm text-muted">{t("fileLater")}</span>
                ) : (
                  <FileUpload url={`/api/files?purpose=document&document=${d.id}`} accept="application/pdf,image/jpeg,image/png,image/webp" label={t("fileAdd")} onError={setError} />
                )}
                <button type="button" aria-expanded={false} onClick={() => setEditing(d.id)} className={`${secondary} self-start`}>{t("edit", { title: d.title })}</button>
              </li>
            );
          })}
        </ul>
      )}
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
    <form onSubmit={submit} className={card} aria-label={doc ? t("edit", { title: doc.title }) : t("add")}>
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
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("cancel")}</button>
      </div>
    </form>
  );
}
