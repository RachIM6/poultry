"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, type FormEvent } from "react";
import { cancel, invite, remove, resetPassword, updateRole, type ActionState } from "./actions";
import { OfflineHint, useOnline } from "@/components/online";
import { cell, formActions, row } from "@/components/layout";
import { danger, done, field, ghost, primary, secondarySm } from "@/components/ui";


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
      <div className={formActions}><button type="submit" disabled={pending || !online} className={primary}>{t("invite")}</button></div>
    </form>
  );
}

/** Confirmed, a « ⋯ » action folds its menu: the message or code it brings shows under the row. */
const closeMenu = (e: FormEvent<HTMLFormElement>) => e.currentTarget.closest("details")?.removeAttribute("open");

export function MemberRow({ membershipId, name, phone, role, roles, until }: { membershipId: string; name: string | null; phone: string; role: string; roles: readonly string[]; until: string | null }) {
  const t = useTranslations("Members");
  const [roleState, roleAction, rolePending] = useActionState(updateRole, {});
  const [removeState, removeAction, removePending] = useActionState(remove, {});
  const [resetState, resetAction, resetPending] = useActionState(resetPassword, {});
  const [chosen, setChosen] = useState(role);
  const online = useOnline();
  return (
    // Wide screens, one row of the members' table (settings/members/page.tsx): the number, the role under "Rôle" (its
    // « Enregistrer » once another role is chosen), then « ⋯ » with the rarer actions; a message or a code takes the
    // whole row below.
    <li className={row}>
      <span className={cell}>
        {name && <span className="font-semibold">{name}</span>}
        <bdi dir="ltr" className={name ? "text-sm text-ink-2" : "font-semibold"}>{phone}</bdi>
        {until && <span className="text-sm text-ink-2">{t("accessUntil", { date: until })}</span>}
      </span>
      {/* The select keeps a width of its own (it collapsed to 34 px beside three buttons, the audit's P1). */}
      <form action={roleAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="membershipId" value={membershipId} />
        <select name="role" value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label={t("roleOf", { phone })} className={`${field} min-w-40 py-2 text-base lg:w-48`}>
          {roles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
        {chosen !== role && <button type="submit" disabled={rolePending || !online} aria-label={t("saveRoleOf", { phone })} className={secondarySm}>{t("saveRole")}</button>}
      </form>
      <details className="relative lg:justify-self-end">
        <summary aria-label={t("moreOf", { phone })} className={`${secondarySm} min-w-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
          <span aria-hidden="true">⋯</span>
        </summary>
        <div className="absolute end-0 top-full z-10 mt-1 flex min-w-60 flex-col rounded-xl border border-line bg-card p-1 shadow-[0_6px_18px_rgba(36,33,28,.12)]">
          <form action={removeAction} onSubmit={(e) => (confirm(t("removeConfirm", { phone })) ? closeMenu(e) : e.preventDefault())}>
            <input type="hidden" name="membershipId" value={membershipId} />
            <button type="submit" disabled={removePending || !online} aria-label={t("removeOf", { phone })} className={`${ghost} w-full justify-start text-alert-fg! lg:w-full`}>{t("remove")}</button>
          </form>
          {role !== "owner" && ( // an owner's password: the operator's pnpm user:reset (ADR-015)
            <form action={resetAction} onSubmit={(e) => (confirm(t("resetConfirm", { phone })) ? closeMenu(e) : e.preventDefault())}>
              <input type="hidden" name="membershipId" value={membershipId} />
              <button type="submit" disabled={resetPending || !online} aria-label={t("resetOf", { phone })} className={`${ghost} w-full justify-start text-ink! lg:w-full`}>{t("reset")}</button>
            </form>
          )}
        </div>
      </details>
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
      <button type="submit" disabled={pending || !online} aria-label={t("cancelOf", { phone })} className={secondarySm}>{t("cancel")}</button>
      <ErrorText state={state} />
    </form>
  );
}
