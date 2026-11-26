import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { getTenantContext, listMembers, PARTNER_ROLES, ROLES } from "@/modules/identity";
import { formatDay } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { CancelInvitationButton, InviteForm, MemberRow } from "./forms";
import { row, rowHead, rowTable, splitAside, splitNarrow } from "@/components/layout";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Members", "Nav", "Offline", "Sync.refused", "errors"];

// Wide screens: the members as a table and the pending invitations, with the invite form beside them.
export default function Members() {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <Content />
      </Suspense>
    </ClientMessages>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations("Members")]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const list = await listMembers(ctx.value);
  if (!list.ok) return redirect({ href: "/dashboard", locale: lang }); // not an owner; every action re-checks can()
  const { members, invitations } = list.value;

  return (
    <Page width="wide" back="/more" title={t("title")}>
      <div className={splitNarrow}>
        <div className="flex flex-col gap-5">
          <ul className={`${rowTable} lg:grid-cols-[auto_minmax(0,1fr)]`} aria-label={t("title")}>
            <li aria-hidden="true" className={rowHead}>
              <span>{t("phoneLabel")}</span>
              <span>{t("roleLabel")}</span>
            </li>
            {members.map((m) =>
              m.userId === ctx.value.userId ? (
                <li key={m.membershipId} className={row}>
                  <p className="lg:col-span-full"><bdi dir="ltr" className="font-semibold">{m.phone ?? m.email}</bdi> · {t(`roles.${m.role}`)} ({t("you")})</p>
                </li>
              ) : (
                <MemberRow key={m.membershipId} membershipId={m.membershipId} phone={m.phone ?? m.email ?? ""} role={m.role} roles={ROLES} until={m.accessUntil && formatDay(m.accessUntil as FarmDay, lang)} />
              ),
            )}
          </ul>
          {invitations.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[17px] font-semibold text-ink-2">{t("pending")}</h2>
              <ul className="flex flex-col gap-3">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-line p-3">
                    <span>
                      <bdi dir="ltr">{i.phone}</bdi> · {t(`roles.${i.role}`)}
                      {i.accessUntil && ` · ${t("accessUntil", { date: formatDay(i.accessUntil as FarmDay, lang) })}`}
                    </span>
                    <CancelInvitationButton invitationId={i.id} phone={i.phone} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <section className={`flex flex-col gap-3 ${splitAside}`}>
          <h2 className="text-[17px] font-semibold text-ink-2">{t("inviteTitle")}</h2>
          <p className="text-sm text-muted">{t("inviteHint")}</p>
          <InviteForm roles={ROLES} partners={PARTNER_ROLES} />
        </section>
      </div>
    </Page>
  );
}
