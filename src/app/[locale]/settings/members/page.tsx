import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Link, redirect } from "@/i18n/navigation";
import { getTenantContext, listMembers, ROLES } from "@/modules/identity";
import { CancelInvitationButton, InviteForm, MemberRow } from "./forms";

export default function Members() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
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
      <Link href="/dashboard" className="underline underline-offset-4">{t("back")}</Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <ul className="flex flex-col gap-3">
        {members.map((m) =>
          m.userId === ctx.value.userId ? (
            <li key={m.membershipId} className="rounded-lg border border-current/30 p-3">
              <bdi dir="ltr" className="font-semibold">{m.phone}</bdi> · {t(`roles.${m.role}`)} ({t("you")})
            </li>
          ) : (
            <MemberRow key={m.membershipId} membershipId={m.membershipId} phone={m.phone ?? ""} role={m.role} roles={ROLES} />
          ),
        )}
      </ul>
      {invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("pending")}</h2>
          <ul className="flex flex-col gap-3">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-current/30 p-3">
                <span>
                  <bdi dir="ltr">{i.phone}</bdi> · {t(`roles.${i.role}`)}
                </span>
                <CancelInvitationButton invitationId={i.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("inviteTitle")}</h2>
        <p className="text-sm opacity-75">{t("inviteHint")}</p>
        <InviteForm roles={ROLES} />
      </section>
    </>
  );
}
