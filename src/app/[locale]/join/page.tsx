import { getTranslations } from "next-intl/server";
import { SignupForm } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";

// ADR-015: an invited member or partner creates their account with the owner's invite code. Someone who already has an
// account signs in and enters the code there (onboarding, "Changer d'exploitation").
export default async function Join() {
  const t = await getTranslations("Account");
  return (
    <AuthPage title={t("joinTitle")} intro={t("joinIntro")}>
      <SignupForm invite />
    </AuthPage>
  );
}
