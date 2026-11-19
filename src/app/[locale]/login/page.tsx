import { useTranslations } from "next-intl";
import { LoginForm } from "@/components/login-form";

export default function Login() {
  const t = useTranslations("Login");
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <LoginForm />
    </main>
  );
}
