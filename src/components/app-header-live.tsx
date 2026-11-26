"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { initials } from "@/components/initials";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/logout-button";
import { useOnline } from "@/components/online";
import { Link } from "@/i18n/navigation";
import { rememberSignedIn } from "@/lib/api";
import { formatMomentShort } from "@/lib/format-day";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { NOTIFICATION_MUTATIONS as M, type NotificationDto } from "@/modules/notifications/shared";
import { currentScope, localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// The header's parts read from the phone's database (app-header.tsx): the sync chip, the bell with the latest unread
// notifications, and the profile with the account menu. The bell's panel and the menu are disclosures (a button showing
// a panel of links and buttons, in the tab order right after it): Enter or Space opens one, Escape closes it with the
// focus back on the button, so does a click outside or tabbing out.
const item = "flex min-h-11 w-full items-center rounded-xl px-3 text-start hover:bg-shell";
const popover = "flex flex-col gap-1 rounded-2xl border border-line bg-card p-2 shadow-[0_6px_24px_rgba(36,33,28,.16)]";
const chipBox = "h-11 w-40"; // the same box as the chip's slot in app-header.tsx
const icon = (d: string) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function HeaderLive() {
  const t = useTranslations();
  // null: nobody signed in on this phone (a first offline load); undefined: still reading.
  const scope = useLiveQuery(async () => (await currentScope()) ?? null, []);
  // A phone signed in before names were kept: ask the server once for the name.
  const missing = scope && scope.name === undefined;
  useEffect(() => {
    if (missing && navigator.onLine) void rememberSignedIn();
  }, [missing]);

  if (!scope) {
    return (
      <>
        <span className={chipBox} />
        <span className="size-11" />
        <span className="size-11 lg:w-60" />
      </>
    );
  }
  return (
    <>
      <SyncChip {...scope} />
      <Bell {...scope} />
      <Profile name={scope.name} role={t(`Members.roles.${scope.role}`)} />
    </>
  );
}

/** Opens and closes a header panel (the bell's, the account menu): Escape, a click outside, tabbing out. */
function useDisclosure() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };
  // A link in the panel opens another page (or the same, another language): the panel closes.
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest("a")) setOpen(false);
  };
  return { open, setOpen, box, button, onBlur, onClick };
}

/**
 * tasks/plan-ui-cleanup.md §3: what waits to be sent, on every screen (it was the home's badge), linking to /sync. A
 * refused write first, it waits on the user (ADR-003 §7); then no network; then the writes waiting. A fixed box, the
 * size of its slot: neither its arrival nor a change of state moves anything.
 */
function SyncChip({ userId, organizationId }: Scope) {
  const t = useTranslations("Header");
  const online = useOnline();
  const counts = useLiveQuery(() => {
    const db = localDb({ userId, organizationId });
    return Promise.all([db.outbox.count(), db.needsAttention.count()]);
  }, [userId, organizationId]);
  if (!counts) return <span className={chipBox} />;
  const [pending, refused] = counts;
  const [text, tone] =
    refused > 0
      ? [t("syncRefused", { count: refused, n: String(refused) }), "bg-alert text-white"]
      : !online
        ? [t("syncOffline"), "bg-shell text-ink-2"]
        : pending > 0
          ? [t("syncPending", { n: String(pending) }), "bg-brick-soft text-brick-fg"]
          : [t("syncDone"), "bg-olive-soft text-olive"];
  return (
    // aria-live, not a role="status" child: a status region would drop out of the link's accessible name.
    <Link href="/sync" aria-live="polite" title={text} className={`grid place-items-center ${chipBox}`}>
      <span className={`flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-sm font-medium ${tone}`}>
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
        <span className="sr-only">{t("syncLabel")} : </span>
        <span className="truncate">{text}</span>
      </span>
    </Link>
  );
}

/** The bell: the unread count, and a panel with the 5 latest unread notifications, from the phone's database. */
function Bell({ userId, organizationId }: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const { open, setOpen, box, button, onBlur, onClick } = useDisclosure();
  const all = useRef<HTMLAnchorElement>(null);
  const db = localDb({ userId, organizationId });
  const unread = useLiveQuery(
    async () =>
      (await db.records.where("entity").equals("notification").toArray())
        .map((r) => r.data as NotificationDto)
        .filter((n) => !n.readAt)
        .sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
    [userId, organizationId],
    [],
  );
  // The notifications' one mutation, as /inbox sends it: one queued write per notification.
  const markRead = async (notes: NotificationDto[]) => {
    const readAt = new Date().toISOString();
    for (const n of notes) await writeLocal(db, { type: M.markRead, payload: { id: n.id } }, { entity: "notification", id: n.id, data: { ...n, readAt } });
  };
  const today = farmDayOf(new Date());
  return (
    // The panel hangs from the bar on the phone (inside its 16 px gutters), from the bell from lg.
    <div ref={box} onBlur={onBlur} className="lg:relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("Header.notifications", { count: unread.length })}
        onClick={() => setOpen(!open)}
        className="relative grid size-11 place-items-center rounded-full hover:bg-shell aria-expanded:bg-shell"
      >
        {icon("M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0")}
        {unread.length > 0 && (
          <span aria-hidden="true" className="absolute end-0.5 top-0.5 min-w-5 rounded-full bg-alert px-1 text-center text-xs font-semibold leading-5 text-white">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>
      <div id={id} hidden={!open} onClick={onClick} className={`absolute inset-x-4 top-full mt-2 lg:start-auto lg:end-0 lg:w-96 ${popover}`}>
        <div className="flex min-h-11 items-center justify-between gap-2 ps-3">
          <h2 className="font-semibold">{t("Header.panelTitle")}</h2>
          {unread.length > 0 && (
            <button
              type="button"
              // The button goes with the last unread one: the focus moves on to « Toutes les notifications ».
              onClick={() => void markRead(unread).then(() => all.current?.focus())}
              className="min-h-11 rounded-xl px-3 text-sm font-medium text-ink-2 hover:bg-shell hover:text-ink"
            >
              {t("Header.markAllRead")}
            </button>
          )}
        </div>
        {unread.length === 0 ? (
          <p className="px-3 pb-2 text-sm text-ink-2">{t("Header.noUnread")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {unread.slice(0, 5).map((n) => (
              <li key={n.id}>
                {/* Opening one reads it, on /inbox, where a push opens it too. */}
                <Link href="/inbox" onClick={() => void markRead([n])} className="flex flex-col gap-0.5 rounded-xl px-3 py-2 hover:bg-shell">
                  <span className="font-semibold">{t(`Notifications.templates.${n.templateKey}.title`, n.params)}</span>
                  <span className="line-clamp-2 text-sm text-ink-2">{t(`Notifications.templates.${n.templateKey}.body`, n.params)}</span>
                  <span className="text-xs text-muted">{formatMomentShort(n.createdAt, locale, today)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line pt-1">
          <Link ref={all} href="/inbox" className={`${item} font-medium`}>
            {t("Header.allNotifications")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Profile({ name = "", role }: { name?: string; role: string }) {
  const t = useTranslations();
  const { open, setOpen, box, button, onBlur, onClick } = useDisclosure();
  const id = useId(); // not a fixed id: the page left behind in another language stays in the DOM, hidden (cacheComponents)
  const letters = initials(name);
  const who = (
    <>
      <bdi className="block truncate font-semibold">{name}</bdi>
      <span className="block truncate text-sm text-ink-2">{role}</span>
    </>
  );
  return (
    <div ref={box} className="relative" onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex size-11 items-center gap-2.5 rounded-full text-start hover:bg-shell lg:h-12 lg:w-60 lg:rounded-2xl lg:pe-2"
      >
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-ink font-semibold text-shell lg:size-10">
          {letters || icon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0")}
        </span>
        {/* The name and role: shown beside the avatar on wide screens, the button's name everywhere. */}
        <span className="sr-only lg:not-sr-only lg:min-w-0 lg:flex-1 lg:leading-tight">{who}</span>
        <span className="hidden shrink-0 text-muted lg:block">{icon("M6 9l6 6 6-6")}</span>
      </button>
      <div id={id} hidden={!open} onClick={onClick} className={`absolute end-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] ${popover}`}>
        <p className="px-3 pb-1 pt-2 lg:hidden">{who}</p>
        <Link href="/organizations#name" className={item}>{t("Header.yourName")}</Link>
        <Link href="/organizations" className={item}>{t("Organizations.title")}</Link>
        <div className="border-t border-line px-3 pt-1">
          <LocaleSwitcher />
        </div>
        <div className="flex flex-col gap-1 border-t border-line pt-1">
          <LogoutButton className={item} />
          <LogoutButton everywhere className={item} />
        </div>
      </div>
    </div>
  );
}
