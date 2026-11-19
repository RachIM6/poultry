"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { cancel, invite, remove, updateRole, type ActionState } from "./actions";

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white disabled:opacity-60";
const secondary = "rounded-lg border border-current/30 px-3 py-2 disabled:opacity-60";

const ErrorText = ({ state }: { state: ActionState }) => {
  const t = useTranslations();
  return state.messageKey ? <p role="alert">{t(state.messageKey)}</p> : null;
};

export function InviteForm({ roles }: { roles: readonly string[] }) {
  const t = useTranslations("Members");
  const [state, action, pending] = useActionState(invite, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="phone">{t("phoneLabel")}</label>
      <input id="phone" name="phone" type="tel" inputMode="tel" dir="ltr" required placeholder="06 12 34 56 78" className={field} />
      <label htmlFor="role">{t("roleLabel")}</label>
      <select id="role" name="role" defaultValue="worker" className={field}>
        {roles.map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}
      </select>
      {state.ok && <p role="status">{t("invited")}</p>}
      <ErrorText state={state} />
      <button type="submit" disabled={pending} className={primary}>{t("invite")}</button>
    </form>
  );
}

export function MemberRow({ membershipId, phone, role, roles }: { membershipId: string; phone: string; role: string; roles: readonly string[] }) {
  const t = useTranslations("Members");
  const [roleState, roleAction, rolePending] = useActionState(updateRole, {});
  const [removeState, removeAction, removePending] = useActionState(remove, {});
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-current/30 p-3">
      <bdi dir="ltr" className="font-semibold">{phone}</bdi>
      <form action={roleAction} className="flex gap-2">
        <input type="hidden" name="membershipId" value={membershipId} />
        <select name="role" defaultValue={role} aria-label={t("roleOf", { phone })} className={`${field} flex-1 py-2 text-base`}>
          {roles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
        <button type="submit" disabled={rolePending} className={secondary}>{t("saveRole")}</button>
      </form>
      <ErrorText state={roleState} />
      <form action={removeAction} onSubmit={(e) => !confirm(t("removeConfirm", { phone })) && e.preventDefault()}>
        <input type="hidden" name="membershipId" value={membershipId} />
        <button type="submit" disabled={removePending} className={`${secondary} text-red-700`}>{t("remove")}</button>
      </form>
      <ErrorText state={removeState} />
    </li>
  );
}

export function CancelInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("Members");
  const [state, action, pending] = useActionState(cancel, {});
  return (
    <form action={action}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <button type="submit" disabled={pending} className={secondary}>{t("cancel")}</button>
      <ErrorText state={state} />
    </form>
  );
}
