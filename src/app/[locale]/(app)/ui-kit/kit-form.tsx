"use client";

import { useCloseSheet } from "@/components/sheet";
import { formActions } from "@/components/layout";
import { field, ghost, primary } from "@/components/ui";

// e2e/ui-kit.spec.ts: a sheet's form that closes it once "saved".
export function KitForm() {
  const close = useCloseSheet();
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), close())}>
      <label className="flex flex-col gap-1">
        Libellé
        <input name="label" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        Montant
        <input name="amount" inputMode="decimal" className={field} />
      </label>
      <div className={formActions}>
        <button type="submit" className={primary}>Enregistrer</button>
        <button type="button" onClick={close} className={ghost}>Annuler</button>
      </div>
    </form>
  );
}
