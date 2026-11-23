"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { formatDateTime, formatDay } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { Role } from "@/lib/tenant";
import { currentScope, localDb, metaValue, rememberScope, scopeKey, type RejectedEntry, type Scope } from "@/offline/db";
import { requestSync, startSync } from "@/offline/sync";
import { primary } from "@/components/ui";

/**
 * On signed-in (online) pages: remembers who is signed in on this phone for the offline pages and the service worker,
 * keeps the sync loop running, and shows what is waiting to be sent.
 */
export function SyncBadge({ userId, organizationId, role }: { userId: string; organizationId: string; role: Role }) {
  const t = useTranslations("Sync");
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
  const pending = useLiveQuery(() => localDb({ userId, organizationId }).outbox.count(), [userId, organizationId], 0);
  return (
    // aria-live, not a role="status" child: a status region would drop out of the link's accessible name.
    <Link href="/sync" aria-live="polite" className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-3 text-sm font-medium ${pending > 0 ? "bg-brick-soft text-brick-fg" : "bg-olive-soft text-olive"}`}>
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
  // V6: the server sends the raw laying days to discard first; the phone formats them. Older entries have no values.
  const message = ({ messageKey, messageValues: v }: RejectedEntry) =>
    messageKey === "errors.EGGS_IN_WITHDRAWAL" && typeof v?.days === "string"
      ? t("EggSale.discardFirst", { days: v.days.split(",").map((d) => formatDay(d as FarmDay, locale)).join(", ") })
      : t(messageKey, v);

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
            {rejected.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-2 rounded-2xl bg-alert-soft p-3 text-alert-fg">
                <p>{message(entry)}</p>
                <p className="text-sm text-muted">{formatDateTime(entry.createdAt, locale)}</p>
                <button
                  type="button"
                  onClick={() => localDb({ userId, organizationId }).needsAttention.delete(entry.id)}
                  className="self-start rounded-2xl border border-line bg-card px-3 py-2"
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
