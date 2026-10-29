"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/format";
import type { Role } from "@/lib/tenant";
import { currentScope, localDb, metaValue, rememberScope, scopeKey, type Scope } from "@/offline/db";
import { requestSync, startSync } from "@/offline/sync";

/**
 * On signed-in (online) pages: remembers who is signed in on this phone for the offline pages and the service worker,
 * keeps the sync loop running, and shows what is waiting to be sent.
 */
export function SyncBadge({ userId, organizationId, role }: { userId: string; organizationId: string; role: Role }) {
  const t = useTranslations("Sync");
  useEffect(() => {
    const scope = { userId, organizationId, role };
    void rememberScope(scope);
    return startSync(scope);
  }, [userId, organizationId, role]);
  const pending = useLiveQuery(() => localDb({ userId, organizationId }).outbox.count(), [userId, organizationId], 0);
  return (
    // aria-live, not a role="status" child: a status region would drop out of the link's accessible name.
    <Link href="/sync" aria-live="polite" className="rounded-lg border border-current/30 px-3 py-2 text-sm">
      {pending > 0 ? t("pending", { count: String(pending) }) : t("upToDate")}
    </Link>
  );
}

/** The /sync shell: works offline from IndexedDB alone (poultry-pwa §0.12). */
export function SyncPanel() {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null; // reading the phone's storage
  if (scope === null) {
    return (
      <p>
        {t("signedOut")}{" "}
        <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <ScopedPanel key={scopeKey(scope)} {...scope} />;
}

function ScopedPanel({ userId, organizationId, role }: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);

  const state = useLiveQuery(async () => {
    const db = localDb({ userId, organizationId });
    const [pending, rejected, lastSyncAt, outcome] = await Promise.all([
      db.outbox.count(),
      db.needsAttention.toArray(),
      metaValue(db, "lastSyncAt"),
      metaValue(db, "lastOutcome"),
    ]);
    return { pending, rejected, lastSyncAt, outcome };
  }, [userId, organizationId]);

  if (!state) return null;
  const { pending, rejected, lastSyncAt, outcome } = state;

  return (
    <>
      <p>{t("Sync.savedHere")}</p>
      <div role="status" className="flex flex-col gap-1 rounded-lg border border-current/30 p-4">
        <p className="text-lg font-semibold">{pending > 0 ? t("Sync.pending", { count: String(pending) }) : t("Sync.upToDate")}</p>
        <p className="text-sm opacity-75">{lastSyncAt ? t("Sync.lastSync", { time: formatDateTime(lastSyncAt, locale) }) : t("Sync.never")}</p>
        {outcome === "offline" && <p>{t("Sync.offline")}</p>}
        {outcome === "wrong-scope" && <p>{t("Sync.wrongScope")}</p>}
        {outcome === "unauthenticated" && (
          <p>
            {t("Sync.unauthenticated")}{" "}
            <Link href="/login" className="underline underline-offset-4">{t("Sync.login")}</Link>
          </p>
        )}
      </div>
      <button type="button" onClick={requestSync} className="rounded-lg bg-green-700 px-4 py-3 font-semibold text-white">
        {t("Sync.syncNow")}
      </button>
      {rejected.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("Sync.attention")}</h2>
          <p className="text-sm opacity-75">{t("Sync.attentionHint")}</p>
          <ul className="flex flex-col gap-3">
            {rejected.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-2 rounded-lg border border-red-700/50 p-3">
                <p>{t(entry.messageKey)}</p>
                <p className="text-sm opacity-75">{formatDateTime(entry.createdAt, locale)}</p>
                <button
                  type="button"
                  onClick={() => localDb({ userId, organizationId }).needsAttention.delete(entry.id)}
                  className="self-start rounded-lg border border-current/30 px-3 py-2"
                >
                  {t("Sync.dismiss")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
