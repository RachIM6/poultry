import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { getTenantContext, listMembers, PARTNER_ROLES, ROLES } from "@/modules/identity";
import { formatDay } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { CancelInvitationButton, InviteForm, MemberRow } from "./forms";
import { BackLink } from "@/components/app-nav";
import { card } from "@/components/ui";

export default function Members() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations("Members")]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const list = await listMembers(ctx.value);
  if (!list.ok) return redirect({ href: "/dashboard", locale: lang }); // not an owner; every action re-checks can()
  const { members, invitations } = list.value;

  return (
    <>
      <BackLink href="/more" />
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <ul className="flex flex-col gap-3">
        {members.map((m) =>
          m.userId === ctx.value.userId ? (
            <li key={m.membershipId} className={card}>
              <bdi dir="ltr" className="font-semibold">{m.phone}</bdi> · {t(`roles.${m.role}`)} ({t("you")})
            </li>
          ) : (
            <MemberRow key={m.membershipId} membershipId={m.membershipId} phone={m.phone ?? ""} role={m.role} roles={ROLES} until={m.accessUntil && formatDay(m.accessUntil as FarmDay, lang)} />
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
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold text-ink-2">{t("inviteTitle")}</h2>
        <p className="text-sm text-muted">{t("inviteHint")}</p>
        <InviteForm roles={ROLES} partners={PARTNER_ROLES} />
      </section>
    </>
  );
}
