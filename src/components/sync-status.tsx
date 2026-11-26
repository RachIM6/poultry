"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { formatDateTime, formatDay } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { Role } from "@/lib/tenant";
import { currentScope, localDb, metaValue, rememberScope, scopeKey, type RejectedEntry, type Scope } from "@/offline/db";
import { payloadSummary, redoHref, refusalContext } from "@/offline/refused";
import { requestSync, startSync } from "@/offline/sync";
import { primary } from "@/components/ui";

/**
 * On the home (online, and its offline twin /today): remembers who is signed in on this phone for the offline pages and
 * the service worker, and keeps the sync loop running. What waits to be sent is the header's chip (app-header-live.tsx).
 */
export function SyncStart({ userId, organizationId, role }: { userId: string; organizationId: string; role: Role }) {
  useEffect(() => {
    const scope = { userId, organizationId, role };
    // After rememberScope: a role change clears local records first, so no pull lands before the clear (T25 S5).
    let stop: (() => void) | undefined;
    let ended = false;
    void rememberScope(scope).then(() => {
      if (!ended) stop = startSync(scope);
    });
    return () => {
      ended = true;
      stop?.();
    };
  }, [userId, organizationId, role]);
  return null;
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
    // The names that say where each refused write belongs and who or what it was about.
    const places = rejected.length > 0 ? await db.records.where("entity").anyOf("batch", "house", "farm", "buyer", "stockItem", "supplier").toArray() : [];
    return { pending, rejected, lastSyncAt, outcome, places };
  }, [userId, organizationId]);

  if (!state) return null;
  const { pending, rejected, lastSyncAt, outcome, places } = state;
  // V6: the server sends the raw laying days to discard first; the phone formats them. Older entries have no values.
  const message = ({ messageKey, messageValues: v }: RejectedEntry) =>
    messageKey === "errors.EGGS_IN_WITHDRAWAL" && typeof v?.days === "string"
      ? t("EggSale.discardFirst", { days: v.days.split(",").map((d) => formatDay(d as FarmDay, locale)).join(", ") })
      : t(messageKey, v);
  const label = (type: string) => (t.has(`Sync.types.${type}`) ? t(`Sync.types.${type}`) : t("Sync.unknownType"));
  const dismiss = (entry: RejectedEntry) => confirm(t("Sync.dismissConfirm")) && localDb({ userId, organizationId }).needsAttention.delete(entry.id);

  return (
    <>
      <p>{t("Sync.savedHere")}</p>
      <div role="status" className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-4">
        <p className="text-lg font-semibold">{pending > 0 ? t("Sync.pending", { count: String(pending) }) : t("Sync.upToDate")}</p>
        <p className="text-sm text-muted">{lastSyncAt ? t("Sync.lastSync", { time: formatDateTime(lastSyncAt, locale) }) : t("Sync.never")}</p>
        {outcome === "offline" && <p>{t("Sync.offline")}</p>}
        {outcome === "wrong-scope" && <p>{t("Sync.wrongScope")}</p>}
        {outcome === "unauthenticated" && (
          <p>
            {t("Sync.unauthenticated")}{" "}
            <Link href="/login" className="underline underline-offset-4">{t("Sync.login")}</Link>
          </p>
        )}
      </div>
      <button type="button" onClick={requestSync} className={primary}>
        {t("Sync.syncNow")}
      </button>
      {rejected.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold text-ink-2">{t("Sync.attention")}</h2>
          <p className="text-sm text-muted">{t("Sync.attentionHint")}</p>
          <ul className="flex flex-col gap-3">
            {rejected.map((entry) => {
              const { place, day } = refusalContext(entry.payload, places);
              const values = payloadSummary(entry.payload, places, (key, v) => t(key, v), locale);
              const href = redoHref(entry.type, entry.payload);
              return (
                <li key={entry.id} className="flex flex-col gap-2 rounded-2xl bg-alert-soft p-3 text-alert-fg">
                  <h3 className="font-semibold">{label(entry.type)}</h3>
                  {(place || day) && <p>{[place, day && formatDay(day as FarmDay, locale)].filter(Boolean).join(" · ")}</p>}
                  <p>{message(entry)}</p>
                  {values.length > 0 && (
                    <div className="text-sm">
                      <p className="font-medium">{t("Sync.values")}</p>
                      <p className="break-words">{values.join(" · ")}</p>
                    </div>
                  )}
                  <p className="text-sm text-muted">{formatDateTime(entry.createdAt, locale)}</p>
                  <div className="flex flex-wrap gap-2">
                    {href && (
                      <Link href={href} className="inline-flex min-h-11 items-center rounded-2xl bg-card px-3 py-2 underline underline-offset-4">
                        {t("Sync.redo")}
                      </Link>
                    )}
                    <button type="button" onClick={() => dismiss(entry)} className="min-h-11 rounded-2xl border border-line bg-card px-3 py-2">
                      {t("Sync.dismiss")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
