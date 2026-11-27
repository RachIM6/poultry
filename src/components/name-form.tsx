"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveMyName } from "@/app/[locale]/(app)/organizations/actions";
import { danger, field, secondary } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import { rememberSignedIn } from "@/lib/api";

/** A person's first and last name (identity/schema.ts Names checks them again): at sign-up, and on « Mes exploitations ». */
export function NameFields({ firstName, lastName }: { firstName?: string | null; lastName?: string | null }) {
  const t = useTranslations("Account");
  // maxLength: identity/schema.ts NAME_MAX, not imported (it would bring Zod into the form).
  const props = { type: "text", required: true, maxLength: 50, autoCapitalize: "words", spellCheck: false, dir: "auto", className: field } as const;
  return (
    <>
      <label htmlFor="firstName" className="font-semibold">{t("firstNameLabel")}</label>
      <input id="firstName" name="firstName" autoComplete="given-name" defaultValue={firstName ?? undefined} {...props} />
      <label htmlFor="lastName" className="font-semibold">{t("lastNameLabel")}</label>
      <input id="lastName" name="lastName" autoComplete="family-name" defaultValue={lastName ?? undefined} {...props} />
    </>
  );
}

/** « Informations personnelles »: an account made before names sets one; the header shows it once the phone has it (rememberSignedIn). */
export function NameForm({ firstName, lastName }: { firstName: string | null; lastName: string | null }) {
  const t = useTranslations();
  const router = useRouter();
  const [state, action, pending] = useActionState(async (_: { messageKey?: string; saved?: true }, form: FormData): Promise<{ messageKey?: string; saved?: true }> => {
    const result = await saveMyName(form);
    if (result.saved) {
      await rememberSignedIn();
      router.refresh();
    }
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <NameFields firstName={firstName} lastName={lastName} />
      {state.messageKey && (
        <p role={state.saved ? "status" : "alert"} className={state.saved ? "text-olive" : danger}>
          {t(state.messageKey)}
        </p>
      )}
      <button type="submit" disabled={pending} className={secondary}>{t("Header.save")}</button>
    </form>
  );
}
