"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { moreGroups } from "@/components/more-groups";
import { Link } from "@/i18n/navigation";
import { can, type Action } from "@/lib/permissions";
import { currentScope, localDb } from "@/offline/db";

// The parts of the nav read from the phone's database, in their own chunk (app-nav.tsx): the online-only pages (books,
// treasury, closing…) then load Dexie after the page, not with it.

// WebOverview.dc.html: on wide screens the owner's sidebar also lists the screens it uses most, by role. The role comes
// from the phone's database (who signed in last), so the shell stays static; the server still checks every page.
const WIDE: { href: string; key: string; action: Action; icon: string }[] = [
  { href: "/receivables", key: "sales", action: "sales.manage", icon: "M3 7h18v10H3zM7 12h4" },
  { href: "/books", key: "finance", action: "money.read", icon: "M4 20V4M4 20h16M8 16l4-5 3 3 5-7" },
  { href: "/settings/members", key: "members", action: "members.manage", icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6" },
];

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

export function WideLinks({ isIn }: { isIn: (href: string) => boolean }) {
  const t = useTranslations("Nav");
  const scope = useLiveQuery(() => currentScope(), []);
  const wide = scope ? WIDE.filter((w) => can(scope, w.action)) : [];
  if (wide.length === 0) return null;
  return (
    <ul className="mt-4 hidden flex-col gap-1 border-t border-shell/15 pt-4 lg:flex">
      {wide.map((w) => (
        <li key={w.key}>
          <Link
            href={w.href}
            aria-current={isIn(w.href) ? "page" : undefined}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] text-shell hover:bg-shell/10 aria-[current=page]:bg-chick aria-[current=page]:font-semibold aria-[current=page]:text-ink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={w.icon} />
            </svg>
            {t(w.key)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Owner feedback: on wide screens "Plus" opens its screens in the sidebar, like a collapsible section, instead of
// leading to /more; the phone keeps its tab. One section, its groups as headed lists: the button takes the link's place
// with the same label, icon and count, and every screen is one click away. The sidebar scrolls when it is open.
const OPEN = "nav-more-open"; // remembered on this browser; storage may be refused (private mode)
const remembered = () => {
  try {
    return localStorage.getItem(OPEN) === "1";
  } catch {
    return false;
  }
};

export function WideMore({ icon, isIn }: { icon: string; isIn: (href: string) => boolean }) {
  const t = useTranslations();
  const scope = useLiveQuery(() => currentScope(), []);
  // No role yet (first offline load): nothing, and the "Plus" link to /more stays.
  const groups = (scope ? moreGroups(scope) : []).map((g) =>
    g.title === "More.account" ? { ...g, links: [...g.links, { href: "/more", label: "More.settings" }] } : g, // /more's language and sign-out
  );
  // The deepest match only: /closing/count, not /closing too.
  const here = groups.flatMap((g) => g.links.map((l) => l.href)).filter(isIn).sort((a, b) => b.length - a.length)[0];
  const [open, setOpen] = useState(() => here !== undefined || remembered());
  // Reaching a page of the section (a full load, a shortcut, the back button) opens it.
  const [seen, setSeen] = useState(here);
  if (seen !== here) {
    setSeen(here);
    if (here) setOpen(true);
  }
  if (groups.length === 0) return null;
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN, open ? "0" : "1");
    } catch {}
  };
  return (
    <div data-wide-more className="hidden lg:block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="nav-more"
        onClick={toggle}
        className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] text-shell hover:bg-shell/10"
      >
        <span className="relative grid h-[30px] place-items-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={icon} />
          </svg>
          <Refused />
        </span>
        {t("Nav.more")}
        <Refused spoken />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ms-auto transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div id="nav-more" hidden={!open} className="pb-2">
        {groups.map((g) => {
          const id = `nav-${g.title.split(".")[1]}`;
          return (
            <div key={g.title}>
              <h2 id={id} className="pb-1 pe-3 ps-[46px] pt-3 text-xs font-semibold text-shell/70">
                {t(g.title)}
              </h2>
              <ul aria-labelledby={id}>
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={l.href === here ? "page" : undefined}
                      className="flex min-h-11 items-center rounded-xl pe-3 ps-[46px] text-sm text-shell hover:bg-shell/10 aria-[current=page]:bg-chick aria-[current=page]:font-semibold aria-[current=page]:text-ink"
                    >
                      {t(l.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
