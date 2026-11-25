import { getTranslations } from "next-intl/server";
import { ResetForm } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";

// ADR-015: a new password with the reset code the owner (settings → members) or the operator gave.
export default async function Reset() {
  const t = await getTranslations("Account");
  return (
    <AuthPage title={t("resetTitle")} intro={t("resetIntro")}>
      <ResetForm />
    </AuthPage>
  );
}
