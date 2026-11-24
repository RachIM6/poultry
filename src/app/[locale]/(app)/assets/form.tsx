"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { OfflineHint, unsent, useOnline } from "@/components/online";
import { danger, field, primary, secondary } from "@/components/ui";
import { createAssetAction, disposeAssetAction, payAssetAction, updateAssetAction, type AssetState } from "./actions";

type Farm = { id: string; name: string; houses: { id: string; name: string }[] };
type Treasury = { id: string; kind: "cash" | "bank"; name: string };

const row = "flex min-w-0 flex-col gap-1";
const wide = `${field} w-full min-w-0`; // a long option or a date never widens the form past the phone

/** A cash box or bank account, optional (FN3), as for an expense. Shared by the server-rendered forms. */
export function TreasurySelect({ treasury, label }: { treasury: Treasury[]; label: string }) {
  return (
    <label className={row}>
      {label}
      <select name="treasuryId" defaultValue="" className={wide}>
        <option value="">—</option>
        {treasury.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}

/**
 * SPEC-finance FC1: the owner registers an asset, acquired or in the opening balance. No life is prefilled, and land
 * has none. The id is made once per asset, so sending the form again registers and posts once; the invoice goes up
 * afterwards through the upload route (ADR-011).
 */
export function AssetForm(props: { today: string; openingDay: string; groups: { group: string; categories: string[] }[]; farms: Farm[]; treasury: Treasury[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [id, setId] = useState(() => uuidv7());
  const [land, setLand] = useState(false);
  const [opening, setOpening] = useState(false);
  const [state, setState] = useState<AssetState>({});
  const [pending, startTransition] = useTransition();
  const online = useOnline();
  const landCategories = props.groups.find((g) => g.group === "land")?.categories ?? [];

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const receipt = data.get("receipt");
    data.delete("receipt");
    startTransition(async () => {
      const created = await unsent(createAssetAction(data));
      if (created.ok && receipt instanceof File && receipt.size > 0) {
        const res = await fetch(`/api/files?purpose=receipt&fixedAsset=${id}`, { method: "POST", body: receipt, headers: { "x-requested-with": "poultry" } }).catch(() => null);
        if (!res?.ok) {
          // The form stays: sending it again registers nothing twice and retries the file.
          const body = (await res?.json().catch(() => null)) as { messageKey?: string } | null;
          return setState({ messageKey: body?.messageKey ?? "Files.failed" });
        }
        router.refresh();
      }
      setState(created);
      if (!created.ok) return;
      form.reset();
      setId(uuidv7());
      setLand(false);
      setOpening(false);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <fieldset className="flex min-w-0 flex-col gap-3">
        <label className={row}>
          {t("Assets.label")}
          <input name="label" maxLength={120} required className={wide} />
        </label>
        <label className={row}>
          {t("Assets.category")}
          <select name="category" required defaultValue="" onChange={(e) => setLand(landCategories.includes(e.target.value))} className={wide}>
            <option value="" disabled>—</option>
            {props.groups.map((g) => (
              <optgroup key={g.group} label={t(`Assets.groups.${g.group}`)}>
                {g.categories.map((c) => <option key={c} value={c}>{t(`Assets.categories.${c}`)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className={row}>
          {t("Assets.place")}
          <select name="place" defaultValue="" className={wide}>
            <option value="">—</option>
            {props.farms.map((f) => (
              <optgroup key={f.id} label={f.name}>
                <option value={`farm:${f.id}`}>{t("Assets.wholeFarm", { farm: f.name })}</option>
                {f.houses.map((h) => <option key={h.id} value={`house:${h.id}`}>{h.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={row}>
            {t("Assets.acquiredOn")}
            <input type="date" name="acquiredOn" max={props.today} required className={wide} />
          </label>
          <label className={row}>
            {t("Assets.inServiceOn")}
            <input type="date" name="inServiceOn" required className={wide} />
          </label>
          <label className={row}>
            {t("Assets.amount")}
            <input name="amount" inputMode="decimal" required dir="ltr" className={wide} />
          </label>
          <label className={row}>
            {t("Assets.vat")}
            <input name="vat" inputMode="decimal" dir="ltr" className={wide} />
          </label>
          {!land && (
            <>
              <label className={row}>
                {t("Assets.life")}
                <input type="number" name="lifeMonths" min={1} max={1200} step={1} required dir="ltr" className={wide} />
              </label>
              <label className={row}>
                {t("Assets.residual")}
                <input name="residual" inputMode="decimal" dir="ltr" className={wide} />
              </label>
            </>
          )}
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="size-5 shrink-0" />
          {t("Assets.opening")}
        </label>
        {opening ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={row}>
              {t("Assets.openingOn")}
              <input type="date" name="openingOn" defaultValue={props.openingDay} max={props.today} required className={wide} />
            </label>
            {!land && (
              <label className={row}>
                {t("Assets.accumulated")}
                <input name="accumulated" inputMode="decimal" dir="ltr" className={wide} />
              </label>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={row}>
              {t("Assets.paidWith")}
              <select name="paidWith" required defaultValue="" className={wide}>
                <option value="" disabled>—</option>
                {(["cash", "transfer", "cheque", "credit"] as const).map((m) => <option key={m} value={m}>{t(`Assets.methods.${m}`)}</option>)}
              </select>
            </label>
            <TreasurySelect treasury={props.treasury} label={t("Assets.treasury")} />
          </div>
        )}
        <label className={row}>
          {t("Assets.receipt")}
          <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf" />
        </label>
        {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
        <OfflineHint online={online} />
        <button type="submit" disabled={pending || !online} className={primary}>{t("Assets.save")}</button>
      </fieldset>
    </form>
  );
}

const ACTIONS = { update: updateAssetAction, pay: payAssetAction, dispose: disposeAssetAction };

/** One asset's change, payment or disposal: the server-rendered fields, sent to the owner's server action. */
export function AssetActionForm({ kind, submit, children }: { kind: keyof typeof ACTIONS; submit: string; children: ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(ACTIONS[kind], {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
      <OfflineHint online={online} />
      <button type="submit" disabled={pending || !online} className={secondary}>{submit}</button>
    </form>
  );
}
