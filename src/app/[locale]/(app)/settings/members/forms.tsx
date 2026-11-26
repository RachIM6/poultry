"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { cancel, invite, remove, resetPassword, updateRole, type ActionState } from "./actions";
import { OfflineHint, useOnline } from "@/components/online";
import { cell, row } from "@/components/layout";
import { danger, done, field, primary, secondary } from "@/components/ui";


const ErrorText = ({ state }: { state: ActionState }) => {
  const t = useTranslations();
  return state.messageKey ? <p role="alert" className={danger}>{t(state.messageKey)}</p> : null;
};

/** ADR-015: an invite or reset code, shown this once. The owner reads it out or sends it by WhatsApp. */
const CodeShown = ({ code, label, hint }: { code: string; label: string; hint: string }) => (
  <div className={`${done} flex flex-col gap-2`}>
    <p>{hint}</p>
    <output dir="ltr" aria-label={label} className="block text-center text-2xl font-semibold tracking-widest">{code}</output>
  </div>
);

export function InviteForm({ roles, partners }: { roles: readonly string[]; partners: readonly string[] }) {
  const t = useTranslations("Members");
  const [state, action, pending] = useActionState(invite, {});
  const [role, setRole] = useState("worker");
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="phone">{t("phoneLabel")}</label>
      <input id="phone" name="phone" type="tel" inputMode="tel" dir="ltr" required placeholder="06 12 34 56 78" className={field} />
      <label htmlFor="role">{t("roleLabel")}</label>
      <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
        {roles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
      </select>
      {partners.includes(role) && (
        <>
          <label htmlFor="accessUntil">{t("accessUntilLabel")}</label>
          <input id="accessUntil" name="accessUntil" type="date" className={field} />
          <p className="text-sm text-muted">{t("accessUntilHint")}</p>
        </>
      )}
      {state.ok && <p role="status">{t("invited")}</p>}
      {state.code && <CodeShown code={state.code} label={t("inviteCode")} hint={t("inviteCodeHint")} />}
      <ErrorText state={state} />
      <OfflineHint online={online} />
      <button type="submit" disabled={pending || !online} className={primary}>{t("invite")}</button>
    </form>
  );
}

export function MemberRow({ membershipId, name, phone, role, roles, until }: { membershipId: string; name: string | null; phone: string; role: string; roles: readonly string[]; until: string | null }) {
  const t = useTranslations("Members");
  const [roleState, roleAction, rolePending] = useActionState(updateRole, {});
  const [removeState, removeAction, removePending] = useActionState(remove, {});
  const [resetState, resetAction, resetPending] = useActionState(resetPassword, {});
  const online = useOnline();
  return (
    // Wide screens, one row of the members' table (settings/members/page.tsx): the number, the role under "Rôle", then
    // the other actions; a message or a code takes the whole row below.
    <li className={row}>
      <span className={cell}>
        {name && <span className="font-semibold">{name}</span>}
        <bdi dir="ltr" className={name ? "text-sm text-ink-2" : "font-semibold"}>{phone}</bdi>
        {until && <span className="text-sm text-ink-2">{t("accessUntil", { date: until })}</span>}
      </span>
      <form action={roleAction} className="flex gap-2">
        <input type="hidden" name="membershipId" value={membershipId} />
        <select name="role" defaultValue={role} aria-label={t("roleOf", { phone })} className={`${field} min-w-0 flex-1 py-2 text-base`}>
          {roles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
        <button type="submit" disabled={rolePending || !online} aria-label={t("saveRoleOf", { phone })} className={secondary}>{t("saveRole")}</button>
      </form>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <form action={removeAction} onSubmit={(e) => !confirm(t("removeConfirm", { phone })) && e.preventDefault()}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <button type="submit" disabled={removePending || !online} aria-label={t("removeOf", { phone })} className={`${secondary} text-alert`}>{t("remove")}</button>
        </form>
        {role !== "owner" && ( // an owner's password: the operator's pnpm user:reset (ADR-015)
          <form action={resetAction} onSubmit={(e) => !confirm(t("resetConfirm", { phone })) && e.preventDefault()}>
            <input type="hidden" name="membershipId" value={membershipId} />
            <button type="submit" disabled={resetPending || !online} aria-label={t("resetOf", { phone })} className={secondary}>{t("reset")}</button>
          </form>
        )}
      </div>
      <div className="contents empty:hidden lg:col-span-full lg:flex lg:flex-col lg:gap-2">
        <ErrorText state={roleState} />
        <ErrorText state={removeState} />
        {resetState.code && <CodeShown code={resetState.code} label={t("resetCode")} hint={t("resetCodeHint")} />}
        <ErrorText state={resetState} />
      </div>
    </li>
  );
}

export function CancelInvitationButton({ invitationId, phone }: { invitationId: string; phone: string }) {
  const t = useTranslations("Members");
  const [state, action, pending] = useActionState(cancel, {});
  const online = useOnline();
  return (
    <form action={action}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <button type="submit" disabled={pending || !online} aria-label={t("cancelOf", { phone })} className={secondary}>{t("cancel")}</button>
      <ErrorText state={state} />
    </form>
  );
}
