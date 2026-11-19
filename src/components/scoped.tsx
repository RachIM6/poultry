"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { currentScope, scopeKey, type Scope } from "@/offline/db";
import { startSync } from "@/offline/sync";

/**
 * Static offline shells (SPEC-m4 §7): who is signed in on this phone, remembered by the last online visit, like /batches.
 * Renders nothing while reading the phone's storage, a login link when nobody is, and syncs while open.
 */
export function Scoped({ children }: { children: (scope: Scope) => ReactNode }) {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null;
  if (scope === null) {
    return (
      <p>
        {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <Syncing key={scopeKey(scope)} scope={scope}>{children(scope)}</Syncing>;
}

function Syncing({ scope, children }: { scope: Scope; children: ReactNode }) {
  const { userId, organizationId, role } = scope;
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  return children;
}
