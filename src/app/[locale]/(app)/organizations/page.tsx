import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { JoinCodeForm, OpenFarmForm } from "@/components/join-code-form";
import { Page } from "@/components/page";
import { card, primary, secondary } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import { redirect } from "@/i18n/navigation";
import { myOrganizations } from "@/modules/identity";
import { acceptAndOpen, openFarm } from "./actions";

// SPEC-m5 PA2: the farms this person can open (a vet or an accountant often serves several) and the invitations
// waiting for them. Each farm's data stays in its own database on the phone.
export default function Organizations() {
  return (
    <ClientMessages paths={["Account", "Nav", "Offline", "Sync.refused", "errors"]}>
      <Suspense fallback={<Page width="form" back="/more" />}>
        <Content />
      </Suspense>
    </ClientMessages>
  );
}

async function Content() {
  const [mine, lang, t] = await Promise.all([myOrganizations(await headers()), locale(), getTranslations()]);
  if (!mine.ok) return redirect({ href: "/login", locale: lang });
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
                <button type="submit" className={secondary}>{t("Organizations.open", { name: m.name })}</button>
              </OpenFarmForm>
            )}
          </li>
        ))}
      </ul>
      {invitations.length > 0 && (
        <section aria-label={t("Organizations.invitations")} className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold text-ink-2">{t("Organizations.invitations")}</h2>
          {invitations.map((i) => (
            <OpenFarmForm key={i.id} action={acceptAndOpen} className={card}>
              <input type="hidden" name="invitationId" value={i.id} />
              <p>{t("Organizations.invitedAs", { name: i.name, role: t(`Members.roles.${i.role}`) })}</p>
              <button type="submit" className={primary}>{t("Organizations.accept", { name: i.name })}</button>
            </OpenFarmForm>
          ))}
        </section>
      )}
      <section aria-labelledby="join-title" className="flex flex-col gap-3">
        <h2 id="join-title" className="text-[17px] font-semibold text-ink-2">{t("Account.joinWithCode")}</h2>
        <JoinCodeForm />
      </section>
    </Page>
  );
}
