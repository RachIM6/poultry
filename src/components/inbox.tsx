"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { postJson } from "@/lib/api";
import { formatMomentShort } from "@/lib/format-day";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { NOTIFICATION_MUTATIONS as M, type NotificationDto } from "@/modules/notifications/shared";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { requestSync, startSync } from "@/offline/sync";
import { empty, sectionTitle } from "@/components/layout";
import { Pager } from "@/components/pager";
import { pageOf, pickTab, TABLE_PAGE } from "@/components/paging";
import { Tabs } from "@/components/tabs";
import { card, field, primarySm, secondarySm } from "@/components/ui";

// SPEC N1–N2 on the static /inbox shell: the list comes from the phone's database (synced like the farms);
// push, the test and quiet hours need the network. tasks/plan-ui-cleanup.md §3: « Non lues · Toutes · Réglages » as
// query tabs (?tab=), the lists paged.

const TABS = ["unread", "all", "settings"] as const;


export function InboxScreen() {
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
  return <Inbox key={scopeKey(scope)} {...scope} />;
}

function Inbox({ userId, organizationId, role }: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").equals("notification").toArray(), [userId, organizationId]);
  const search = useSearchParams();
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set()); // read on this visit: they stay under « Non lues » until it is left
  if (!records) return null;
  const tab = pickTab(TABS, search.get("tab"));
  const items = records.map((r) => r.data as NotificationDto).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const unread = items.filter((n) => !n.readAt);
  const list = tab === "unread" ? items.filter((n) => !n.readAt || readHere.has(n.id)) : items;
  const page = pageOf(search.get("page") ?? undefined, list.length, TABLE_PAGE);
  const today = farmDayOf(new Date()); // "26 novembre à 01:25": the year only for last year's

  const markRead = (n: NotificationDto) => {
    if (n.readAt) return;
    setReadHere((s) => new Set(s).add(n.id));
    void writeLocal(db, { type: M.markRead, payload: { id: n.id } }, { entity: "notification", id: n.id, data: { ...n, readAt: new Date().toISOString() } });
  };
  const href = (key: string) => ({ pathname: "/inbox", query: { tab: key } });

  return (
    <>
      <Tabs
        label={t("Inbox.title")}
        current={tab}
        tabs={[
          { key: "unread", label: t("Inbox.tabUnread"), count: unread.length, href: href("unread") },
          { key: "all", label: t("Inbox.tabAll"), href: href("all") },
          { key: "settings", label: t("Inbox.tabSettings"), href: href("settings") },
        ]}
      />
      {tab === "settings" ? (
        <div className="flex flex-col gap-5 lg:max-w-xl">
          <PushControls />
          <QuietHours />
        </div>
      ) : list.length === 0 ? (
        <p className={empty}>{t(items.length === 0 ? "Inbox.empty" : "Inbox.noUnread")}</p>
      ) : (
        <>
          {/* One dense row per notification; a tap marks it read. */}
          <ul aria-label={t(tab === "unread" ? "Inbox.tabUnread" : "Inbox.tabAll")} className={`${card} gap-0 p-0`}>
            {list.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE).map((n) => (
              <li key={n.id} className="border-t border-line first:border-t-0">
                <button type="button" onClick={() => markRead(n)} className="flex min-h-11 w-full flex-col gap-0.5 px-4 py-2.5 text-start hover:bg-shell lg:flex-row lg:items-baseline lg:gap-6">
                  <span className="flex min-w-0 flex-col lg:flex-1">
                    <span className={n.readAt ? "" : "font-semibold"}>
                      {!n.readAt && <span className="sr-only">{t("Inbox.unread")} : </span>}
                      {t(`Notifications.templates.${n.templateKey}.title`, n.params)}
                    </span>
                    <span className="text-sm text-ink-2">{t(`Notifications.templates.${n.templateKey}.body`, n.params)}</span>
                  </span>
                  <span className="text-sm whitespace-nowrap text-muted">{formatMomentShort(n.createdAt, locale, today)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Pager page={page} size={TABLE_PAGE} total={list.length} href={(n) => ({ pathname: "/inbox", query: { tab, page: n } })} />
        </>
      )}
    </>
  );
}

// From the Next.js PWA guide: the VAPID public key as the Uint8Array pushManager.subscribe expects.
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(padded), (c) => c.charCodeAt(0));
}

type PushState = "unknown" | "unsupported" | "off" | "denied" | "available" | "on";

function PushControls() {
  const t = useTranslations("Inbox");
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [state, setState] = useState<PushState>("unknown");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported"); // iPhone outside the Home Screen
      if (!vapidKey) return setState("off");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "available");
    })();
  }, [vapidKey]);

  const enable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey!) });
      const res = await postJson("/api/push/subscribe", sub.toJSON());
      setState(res.status === 201 ? "on" : "available");
      if (res.status !== 201) setMessage(res.messageKey);
    } catch {
      setState(Notification.permission === "denied" ? "denied" : "available");
    }
    setBusy(false);
  };

  const sendTest = async () => {
    setBusy(true);
    const res = await postJson("/api/notifications/test");
    setMessage(res.status === 201 ? "Inbox.testSent" : (res.messageKey ?? "Inbox.needsNetwork"));
    if (res.status === 201) requestSync(); // the new notification arrives on the next pull
    setBusy(false);
  };

  // Push not set up on this server ("off"): a plain fact for the farmer, not the operator's to-do (the inbox works)
  const status: Partial<Record<PushState, string>> = { unsupported: "pushUnsupported", off: "pushInboxOnly", denied: "pushDenied", on: "pushOn" };
  return (
    <section className={`${card} gap-3`}>
      <h2 className={sectionTitle}>{t("push")}</h2>
      {status[state] && <p>{t(status[state])}</p>}
      <div className="flex flex-wrap gap-2">
        {state === "available" && (
          <button type="button" onClick={enable} disabled={busy} className={primarySm}>{t("enablePush")}</button>
        )}
        <button type="button" onClick={sendTest} disabled={busy} className={secondarySm}>{t("sendTest")}</button>
      </div>
      {message && <Message messageKey={message} />}
    </section>
  );
}

function Message({ messageKey }: { messageKey: string }) {
  const t = useTranslations();
  return <p role="status">{t(messageKey)}</p>;
}

function QuietHours() {
  const t = useTranslations("Inbox");
  const ids = { start: useId(), end: useId() };
  const [hours, setHours] = useState<{ start: string; end: string } | null>(null);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void fetch("/api/notifications/quiet-hours")
      .then((res) => (res.ok ? res.json() : null))
      .then(setHours)
      .catch(() => setMessage("Inbox.needsNetwork"));
  }, []);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await postJson("/api/notifications/quiet-hours", { start: form.get("start"), end: form.get("end") });
    setMessage(res.status === 200 ? "Inbox.saved" : (res.messageKey ?? "Inbox.needsNetwork"));
  };

  return (
    <section className={`${card} gap-3`}>
      <h2 className={sectionTitle}>{t("quietHours")}</h2>
      <p className="text-sm text-muted">{t("quietHint")}</p>
      {hours && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={ids.start}>{t("from")}</label>
              <input id={ids.start} name="start" type="time" defaultValue={hours.start} required dir="ltr" className={field} />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={ids.end}>{t("to")}</label>
              <input id={ids.end} name="end" type="time" defaultValue={hours.end} required dir="ltr" className={field} />
            </div>
          </div>
          <button type="submit" className={secondarySm}>{t("save")}</button>
        </form>
      )}
      {message && <Message messageKey={message} />}
    </section>
  );
}
