import { getTranslations } from "next-intl/server";
import { SignupForm } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";

// ADR-015: a new owner creates an account, then onboards their organisation.
export default async function Signup() {
  const t = await getTranslations("Account");
  return (
    <AuthPage title={t("signupTitle")} intro={t("signupIntro")}>
      <SignupForm />
    </AuthPage>
  );
}
