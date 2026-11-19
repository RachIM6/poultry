import { useTranslations } from "next-intl";
import { BrandLockup } from "@/components/brand";
import { LoginForm } from "@/components/login-form";

export default function Login() {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-4">
      <div className="flex flex-col items-start gap-3">
        <BrandLockup large />
        <p className="opacity-75">{t("App.tagline")}</p>
      </div>
      <h1 className="text-2xl font-semibold">{t("Login.title")}</h1>
      <LoginForm />
    </main>
  );
}
