"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { moreGroups } from "@/components/more-groups";
import { NAV_KEY } from "@/components/nav-mode";
import { Link } from "@/i18n/navigation";
import { currentScope, localDb } from "@/offline/db";

// The parts of the nav read from the phone's database, in their own chunk (app-nav.tsx): the online-only pages (books,
// treasury, closing…) then load Dexie after the page, not with it.

/** ADR-003 §7: refused writes wait on the user; "Plus" leads to /sync, where they are listed. The count, or its spoken text. */
export function Refused({ spoken = false }: { spoken?: boolean }) {
  const ts = useTranslations("Sync");
  const refused = useLiveQuery(async () => {
    const s = await currentScope();
    return s ? localDb(s).needsAttention.count() : 0;
  }, [], 0);
  if (refused === 0) return null;
  if (spoken) return <span className="sr-only">, {ts("refused", { count: refused, n: String(refused) })}</span>;
  return (
    <span aria-hidden="true" className="absolute -top-1 end-1 min-w-5 rounded-full bg-alert px-1 text-center text-xs font-semibold leading-5 text-white lg:-end-3">
      {refused}
    </span>
  );
}

// tasks/plan-ui.md U19 (Menu4.dc.html, Menu4b.dc.html): on wide screens the role's « Plus » groups are in the sidebar
// itself; the phone keeps its tab and /more. Unfolded, each group is a heading that opens its links underneath (several
// at once; the current page's group opens, a closed one holding it shows a dot). Folded to the rail, each group is an
// icon opening its links in a 256 px side panel (one at a time; the same icon, « Fermer le panneau » or Escape closes it).
// The fold is remembered on this browser and set on <html> before the first paint (nav-mode.ts), which sizes the sidebar.
type Group = ReturnType<typeof moreGroups>[number];
const idOf = (title: string) => `nav-${title.split(".")[1]}`;
const icon = (d: string, size: number, className = "shrink-0") => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d={d} />
  </svg>
);
// When the panel closes with the focus in it, the focus goes back to its group's icon rather than to the page's top.
const refocus = (id: string) => {
  if (document.getElementById(id)?.contains(document.activeElement)) document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus();
};
const railButton = "relative grid size-12 shrink-0 place-items-center rounded-[14px]";
const item = "flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-xl text-sm text-shell hover:bg-shell/10";
const current = "aria-[current=page]:bg-chick aria-[current=page]:font-semibold aria-[current=page]:text-ink";

export function WideGroups({ isIn }: { isIn: (href: string) => boolean }) {
  const t = useTranslations();
  // null: no one signed in on this phone (the screen itself offers to sign in): the tabs alone, never a link to /more,
  // which nothing on wide screens leads to (owner feedback); undefined: still reading.
  const scope = useLiveQuery(async () => (await currentScope()) ?? null, []);
  // The language and the sign-out are in the header's menu (U20); the notifications and the sync, the header's bell and chip.
  const groups = (scope ? moreGroups(scope) : []).map((g) => ({ ...g, links: g.links.filter((l) => !l.phone) })).filter((g) => g.links.length > 0);
  // A merged entry is current on all its routes (tasks/plan-ui-cleanup.md §3); the deepest match wins: /closing/count is
  // « Clôture de l'exercice », however another entry's routes are laid out.
  const here = groups
    .flatMap((g) => g.links.flatMap((l) => [l.href, ...(l.routes ?? [])].filter(isIn).map((route) => ({ route, href: l.href }))))
    .sort((a, b) => b.route.length - a.route.length)[0]?.href;
  const holder = groups.find((g) => g.links.some((l) => l.href === here))?.title;
  const [rail, setRail] = useState(() => document.documentElement.dataset.nav === "rail");
  const [panel, setPanel] = useState<string>();
  const [open, setOpen] = useState<string[]>([]);
  // Reaching a page of a group (a full load, a link in a page, the back button) opens that group.
  const [seen, setSeen] = useState<string>();
  if (seen !== here) {
    setSeen(here);
    if (holder && !open.includes(holder)) setOpen([...open, holder]);
  }
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      refocus(idOf(panel));
      setPanel(undefined);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);
  if (scope === undefined) return null;

  const fold = () => {
    setRail(!rail);
    setPanel(undefined);
    if (rail) delete document.documentElement.dataset.nav;
    else document.documentElement.dataset.nav = "rail";
    try {
      localStorage.setItem(NAV_KEY, rail ? "0" : "1");
    } catch {}
  };
  const link = (l: Group["links"][number], className: string) => (
    <li key={l.href}>
      <Link href={l.href} aria-current={l.href === here ? "page" : undefined} className={`${item} ${current} ${className}`}>
        {l.icon && !rail && icon(l.icon, 20)}
        {t(l.label)}
      </Link>
    </li>
  );
  const group = (g: Group) => {
    const id = idOf(g.title);
    const shown = rail ? panel === g.title : open.includes(g.title);
    const button = (
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={id}
        aria-current={g.title === holder || undefined} // the group holding the current page: marked on the rail, a dot when closed
        onClick={() => (rail ? setPanel(shown ? undefined : g.title) : setOpen(shown ? open.filter((o) => o !== g.title) : [...open, g.title]))}
        className={
          rail
            ? `${railButton} ${g.title === holder ? "bg-chick text-ink" : shown ? "bg-shell/15" : "hover:bg-shell/10"}`
            : "flex min-h-11 w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-2 text-start text-sm font-semibold hover:bg-shell/10"
        }
      >
        {icon(g.icon, rail ? 22 : 20)}
        <span data-tip className="flex-1">
          {t(g.title)}
        </span>
        {!rail && g.title === holder && !shown && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-chick" />}
        {!rail && icon("M6 9l6 6 6-6", 16, `shrink-0 transition-transform motion-reduce:transition-none${shown ? " rotate-180" : ""}`)}
      </button>
    );
    return (
      <>
        {rail ? button : <h2 id={`${id}-t`}>{button}</h2>}
        <div
          id={id}
          hidden={!shown}
          data-panel={rail || undefined}
          className={rail ? "absolute inset-y-0 start-[72px] z-10 flex w-64 flex-col overflow-y-auto overscroll-contain border-s border-shell/10 bg-ink-raised px-2 py-4" : "pb-1.5"}
        >
          {rail && (
            <div className="flex min-h-14 items-center justify-between gap-2 pb-2 pe-1 ps-3">
              {/* The one label that may wrap: « Comptabilité de l’exercice » is wider than the panel's heading. */}
              <h2 id={`${id}-t`} className="min-w-0 font-semibold leading-snug">
                {t(g.title)}
              </h2>
              <button
                type="button"
                aria-label={t("Nav.closePanel")}
                title={t("Nav.closePanel")}
                onClick={() => {
                  refocus(id);
                  setPanel(undefined);
                }}
                className="grid size-11 shrink-0 place-items-center rounded-[14px] hover:bg-shell/10"
              >
                {icon("M15 6l-6 6 6 6", 20, "shrink-0 rtl:-scale-x-100")}
              </button>
            </div>
          )}
          <ul aria-labelledby={`${id}-t`} className="flex flex-col gap-0.5">
            {g.links.map((l) => link(l, rail ? "px-3" : "pe-2 ps-[38px]"))}
          </ul>
        </div>
      </>
    );
  };
  const account = groups.find((g) => g.title === "More.account");
  const others = groups.filter((g) => g !== account);
  const rule = <div aria-hidden="true" className={`h-px shrink-0 bg-shell/15 ${rail ? "my-1 w-8" : "mx-2 my-2"}`} />;
  return (
    <div className={`hidden w-full flex-1 flex-col lg:flex ${rail ? "items-center gap-1.5" : "gap-0.5"}`}>
      {rule}
      {rail ? (
        <ul className="flex flex-col items-center gap-1.5">
          {others.map((g) => (
            <li key={g.title}>{group(g)}</li>
          ))}
        </ul>
      ) : (
        others.map((g) => <div key={g.title}>{group(g)}</div>)
      )}
      <div className={`mt-auto flex w-full flex-col pt-4 ${rail ? "items-center gap-1.5" : "gap-0.5"}`}>
        {account &&
          (rail ? (
            <>
              {group(account)}
              {rule}
            </>
          ) : (
            <>
              {rule}
              <h2 id="nav-account-t" className="px-2 py-1 text-xs font-semibold text-shell/70">
                {t(account.title)}
              </h2>
              <ul aria-labelledby="nav-account-t" className="flex flex-col gap-0.5">
                {account.links.map((l) => link(l, "px-2"))}
              </ul>
            </>
          ))}
      </div>
      {/* Pinned at the sidebar's foot while it scrolls (the nav's scroll-padding keeps a focused link above it); a child
          of this column, which spans the whole list, so it can stay in view. A sticky box stops at the scroller's padding
          (the nav's 16 px py-4): -bottom-4 takes it down to the edge, so scrolled to the end it sits where it belongs,
          under the last link (U20: « bottom-0 » left it 16 px up, over half of that link). */}
      <div className="sticky -bottom-4 z-10 -mb-4 w-full bg-ink pb-4 pt-2">
        <button
          type="button"
          aria-expanded={!rail}
          onClick={fold}
          className={rail ? `${railButton} hover:bg-shell/10` : "flex min-h-11 w-full items-center gap-2.5 whitespace-nowrap rounded-xl border border-shell/20 px-2 text-sm hover:bg-shell/10"}
        >
          {icon(rail ? "M6 6l6 6-6 6M13 6l6 6-6 6" : "M18 6l-6 6 6 6M11 6l-6 6 6 6", rail ? 22 : 20, "shrink-0 rtl:-scale-x-100")}
          <span data-tip>{t(rail ? "Nav.unfold" : "Nav.fold")}</span>
        </button>
      </div>
    </div>
  );
}
