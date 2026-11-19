"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { done, secondary } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { can, type Action } from "@/lib/permissions";
import { currentScope, localDb, scopeKey, type LocalDb, type LocalRecord, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { requestSync, startSync } from "@/offline/sync";

// What the M2 compliance screens share (biosecurity logs, the document vault): a static shell reading the phone's
// records, a save that queues a mutation, and the online upload of a file attached to a record (ADR-011).

export type Save = (mutation: { type: string; payload: unknown }, entity: string, data: { id: string }) => Promise<boolean>;
export type Screen = (props: Scope & { db: LocalDb; records: LocalRecord[]; save: Save }) => ReactNode;
type ShellProps = { entities: string[]; action: Action; forbidden: string; screen: Screen };

/** Signed-in scope, sync, the local records of `entities`, and a save that queues a mutation. */
export function Shell(props: ShellProps) {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null;
  if (scope === null) {
    return (
      <p>
        {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <Records key={scopeKey(scope)} scope={scope} {...props} />;
}

function Records({ scope, entities, action, forbidden, screen: Inner }: ShellProps & { scope: Scope }) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf(entities).toArray(), [userId, organizationId]);
  const [message, setMessage] = useState<string>();
  if (!can(scope, action)) return <p>{t(forbidden)}</p>;
  if (!records) return null;
  const save: Save = async (mutation, entity, data) => {
    try {
      await writeLocal(db, mutation, [{ entity, id: data.id, data }]);
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };
  return (
    <>
      {message && <p role="status" className={done}>{t(message)}</p>}
      <Inner {...scope} db={db} records={records} save={save} />
    </>
  );
}

export const of = <T,>(records: LocalRecord[], entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);

export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

const onOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => (window.removeEventListener("online", notify), window.removeEventListener("offline", notify));
};
export const useOnline = () => useSyncExternalStore(onOnline, () => navigator.onLine, () => true);

/**
 * ADR-011: sends one file to POST /api/files, which attaches it to its record; the record then comes back by sync.
 * Shown only once the record is on the server and the phone is online.
 */
export function FileUpload({ url, accept, label, camera = false, onError }: { url: string; accept: string; label: string; camera?: boolean; onError: (messageKey: string | undefined) => void }) {
  const t = useTranslations();
  const [sending, setSending] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setSending(true);
    onError(undefined);
    try {
      const res = await fetch(url, { method: "POST", body: file, headers: { "x-requested-with": "poultry" } });
      if (!res.ok) onError(((await res.json().catch(() => null)) as { messageKey?: string } | null)?.messageKey ?? "Files.failed");
      else requestSync();
    } catch {
      onError("Files.failed");
    } finally {
      setSending(false);
    }
  };
  return (
    <label className={secondary}>
      {sending ? t("Files.sending") : label}
      <input type="file" accept={accept} capture={camera ? "environment" : undefined} className="sr-only" disabled={sending} onChange={(e) => upload(e.target.files?.[0])} />
    </label>
  );
}
