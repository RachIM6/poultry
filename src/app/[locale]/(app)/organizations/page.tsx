import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { JoinCodeForm, OpenFarmForm } from "@/components/join-code-form";
import { NameForm } from "@/components/name-form";
import { PasswordForm } from "@/components/password-form";
import { Page } from "@/components/page";
import { sectionTitle } from "@/components/layout";
import { card, primarySm, secondarySm } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import { redirect } from "@/i18n/navigation";
import { getSession, hasPassword, myOrganizations, profileOf } from "@/modules/identity";
import { acceptAndOpen, openFarm } from "./actions";

// SPEC-m5 PA2: the farms this person can open (a vet or an accountant often serves several) and the invitations
// waiting for them. Each farm's data stays in its own database on the phone. Also the person's own name and password
// (« Informations personnelles », the header's menu links here): an account made before names sets its name here.
export default function Organizations() {
  return (
    <ClientMessages paths={["Account", "Header.save", "Header.nameSaved", "Nav", "Offline", "Sync.refused", "errors"]}>
      <Suspense fallback={<Page width="form" back="/more" />}>
        <Content />
      </Suspense>
    </ClientMessages>
  );
}

async function Content() {
  const h = await headers();
  const [mine, session, lang, t] = await Promise.all([myOrganizations(h), getSession(h), locale(), getTranslations()]);
  if (!mine.ok || !session) return redirect({ href: "/login", locale: lang });
  const [me, withPassword] = await Promise.all([profileOf(session.userId), hasPassword(session.userId)]);
  const { current, memberships, invitations } = mine.value;
  return (
    <Page width="form" back="/more" title={t("Organizations.title")}>
      <p className="text-sm text-muted">{t("Organizations.hint")}</p>
      <ul aria-label={t("Organizations.title")} className="flex flex-col gap-3">
        {memberships.map((m) => (
          <li key={m.organizationId} className={`${card} flex-row items-center justify-between gap-3`}>
            <span>
              <b className="block font-semibold">{m.name}</b>
              <span className="text-sm text-ink-2">{t(`Members.roles.${m.role}`)}</span>
            </span>
            {m.organizationId === current ? (
              <span className="text-sm font-medium text-olive">{t("Organizations.current")}</span>
            ) : (
              <OpenFarmForm action={openFarm}>
                <input type="hidden" name="organizationId" value={m.organizationId} />
                {/* The farm's name is in the accessible name, not in the visible label (tasks/plan-ui-cleanup.md §1.5). */}
                <button type="submit" aria-label={t("Organizations.open", { name: m.name })} className={secondarySm}>{t("Organizations.openShort")}</button>
              </OpenFarmForm>
            )}
          </li>
        ))}
      </ul>
      {invitations.length > 0 && (
        <section aria-label={t("Organizations.invitations")} className="flex flex-col gap-3">
          <h2 className={sectionTitle}>{t("Organizations.invitations")}</h2>
          {invitations.map((i) => (
            <OpenFarmForm key={i.id} action={acceptAndOpen} className={card}>
              <input type="hidden" name="invitationId" value={i.id} />
              <p>{t("Organizations.invitedAs", { name: i.name, role: t(`Members.roles.${i.role}`) })}</p>
              <button type="submit" aria-label={t("Organizations.accept", { name: i.name })} className={primarySm}>{t("Organizations.acceptShort")}</button>
            </OpenFarmForm>
          ))}
        </section>
      )}
      <section id="name" aria-labelledby="name-title" className="flex scroll-mt-4 flex-col gap-3">
        <h2 id="name-title" className={sectionTitle}>{t("Header.personalInfo")}</h2>
        <p className="text-sm text-muted">{t("Header.nameHint")}</p>
        <NameForm firstName={me.firstName} lastName={me.lastName} />
        {withPassword && (
          <section aria-labelledby="password-title" className="mt-3 flex flex-col gap-3">
            <h3 id="password-title" className="font-semibold">{t("Account.passwordTitle")}</h3>
            <p className="text-sm text-muted">{t("Account.passwordIntro")}</p>
            <PasswordForm />
          </section>
        )}
      </section>
      <section aria-labelledby="join-title" className="flex flex-col gap-3">
        <h2 id="join-title" className={sectionTitle}>{t("Account.joinWithCode")}</h2>
        <JoinCodeForm />
      </section>
    </Page>
  );
}
