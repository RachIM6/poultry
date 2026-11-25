"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
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
