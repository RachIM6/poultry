"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { postJson } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { NOTIFICATION_MUTATIONS as M, type NotificationDto } from "@/modules/notifications/schema";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { requestSync, startSync } from "@/offline/sync";

// SPEC N1–N2 on the static /inbox shell: the list comes from the phone's database (synced like the farms);
// push, the test and quiet hours need the network.

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white disabled:opacity-60";
const secondary = "rounded-lg border border-current/30 px-4 py-3 disabled:opacity-60";

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
  if (!records) return null;
  const items = records.map((r) => r.data as NotificationDto).sort((x, y) => y.createdAt.localeCompare(x.createdAt));

  const markRead = (n: NotificationDto) =>
    n.readAt
      ? undefined
      : writeLocal(db, { type: M.markRead, payload: { id: n.id } }, { entity: "notification", id: n.id, data: { ...n, readAt: new Date().toISOString() } });

  return (
    <>
      {items.length === 0 ? (
        <p>{t("Inbox.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => void markRead(n)} className="flex w-full flex-col gap-1 rounded-lg border border-current/30 p-3 text-start">
                <span className={n.readAt ? "" : "font-semibold"}>
                  {!n.readAt && <span className="sr-only">{t("Inbox.unread")} : </span>}
                  {t(`Notifications.templates.${n.templateKey}.title`, n.params)}
                </span>
                <span>{t(`Notifications.templates.${n.templateKey}.body`, n.params)}</span>
                <span className="text-sm opacity-75">{formatDateTime(n.createdAt, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PushControls />
      <QuietHours />
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

  const status: Partial<Record<PushState, string>> = { unsupported: "pushUnsupported", off: "pushOff", denied: "pushDenied", on: "pushOn" };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("push")}</h2>
      {status[state] && <p>{t(status[state])}</p>}
      {state === "available" && (
        <button type="button" onClick={enable} disabled={busy} className={primary}>{t("enablePush")}</button>
      )}
      <button type="button" onClick={sendTest} disabled={busy} className={secondary}>{t("sendTest")}</button>
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
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("quietHours")}</h2>
      <p className="text-sm opacity-75">{t("quietHint")}</p>
      {hours && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={ids.start}>{t("from")}</label>
              <input id={ids.start} name="start" type="time" defaultValue={hours.start} required dir="ltr" className={field} />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={ids.end}>{t("to")}</label>
              <input id={ids.end} name="end" type="time" defaultValue={hours.end} required dir="ltr" className={field} />
            </div>
          </div>
          <button type="submit" className={secondary}>{t("save")}</button>
        </form>
      )}
      {message && <Message messageKey={message} />}
    </section>
  );
}
