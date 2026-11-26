"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { initials } from "@/components/initials";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/logout-button";
import { Link } from "@/i18n/navigation";
import { rememberSignedIn } from "@/lib/api";
import { currentScope, localDb } from "@/offline/db";

// The header's parts read from the phone's database (app-header.tsx): the bell's unread count, and the profile with
// the account menu. The menu is a disclosure (a button showing a panel of links and buttons, in the tab order right
// after it): Enter or Space opens it, Escape closes it with the focus back on the button, so does a click outside.
const item = "flex min-h-11 w-full items-center rounded-xl px-3 text-start hover:bg-shell";
const icon = (d: string) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function HeaderLive() {
  const t = useTranslations();
  // null: nobody signed in on this phone (a first offline load); undefined: still reading.
  const scope = useLiveQuery(async () => (await currentScope()) ?? null, []);
  const unread = useLiveQuery(async () => {
    const s = await currentScope();
    return s ? localDb(s).records.where("entity").equals("notification").filter((r) => !(r.data as { readAt?: string | null }).readAt).count() : 0;
  }, [], 0);
  // A phone signed in before names were kept: ask the server once for the name.
  const missing = scope && scope.name === undefined;
  useEffect(() => {
    if (missing && navigator.onLine) void rememberSignedIn();
  }, [missing]);

  return (
    <>
      <Link href="/inbox" aria-label={t("Header.notifications", { count: unread })} className="relative grid size-11 place-items-center rounded-full hover:bg-shell">
        {icon("M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0")}
        {unread > 0 && (
          <span aria-hidden="true" className="absolute end-0.5 top-0.5 min-w-5 rounded-full bg-alert px-1 text-center text-xs font-semibold leading-5 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
      {scope ? <Profile name={scope.name} role={t(`Members.roles.${scope.role}`)} /> : <span className="size-11 lg:w-60" />}
    </>
  );
}

function Profile({ name = "", role }: { name?: string; role: string }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const id = useId(); // not a fixed id: the page left behind in another language stays in the DOM, hidden (cacheComponents)
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
  const letters = initials(name);
  const who = (
    <>
      <bdi className="block truncate font-semibold">{name}</bdi>
      <span className="block truncate text-sm text-ink-2">{role}</span>
    </>
  );
  return (
    // Tabbing out of the open menu closes it, as a click outside does.
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
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
      <div
        id={id}
        hidden={!open}
        onClick={(e) => {
          if ((e.target as Element).closest("a")) setOpen(false); // a link opens another page (or the same, another language)
        }}
        className="absolute end-0 top-full mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-2xl border border-line bg-card p-2 shadow-[0_6px_24px_rgba(36,33,28,.16)]"
      >
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
