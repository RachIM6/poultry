"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { parseCentimes } from "@/lib/kernel/money";
import { createFixedAsset, disposeFixedAsset, payFixedAsset, updateFixedAsset } from "@/modules/finance";
import { getWriteContext } from "@/modules/identity";

export type AssetState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2). The invoice goes up
// afterwards through /api/files, never in these bodies.
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
/** A typed amount in centimes, "0" when left empty; null when it isn't an amount. */
const centimes = (form: FormData, key: string) => {
  const v = text(form, key);
  const c = v === null ? 0n : parseCentimes(v);
  return c === null ? null : String(c);
};
const months = (form: FormData) => {
  const v = text(form, "lifeMonths");
  return v === null ? null : Number(v); // not a whole number: INVALID_INPUT
};

async function run(write: (ctx: Parameters<typeof createFixedAsset>[0]) => Promise<{ ok: boolean; error?: string }>, done: string): Promise<AssetState> {
  const ctx = await getWriteContext(await headers());
  if (!ctx.ok) return { messageKey: `errors.${ctx.error}` };
  const result = await write(ctx.value);
  if (!result.ok) return { messageKey: `errors.${result.error}` };
  refresh();
  return { ok: true, messageKey: done };
}

export async function createAssetAction(form: FormData): Promise<AssetState> {
  const [amount, vat, residual, accumulated] = ["amount", "vat", "residual", "accumulated"].map((k) => centimes(form, k));
  if ([amount, vat, residual, accumulated].includes(null)) return { messageKey: "errors.INVALID_INPUT" };
  const opening = form.get("opening") === "on";
  const place = text(form, "place"); // "farm:<id>" or "house:<id>"
  return run(
    (ctx) =>
      createFixedAsset(ctx, {
        id: form.get("id"),
        label: form.get("label"),
        category: form.get("category"),
        farmId: place?.startsWith("farm:") ? place.slice(5) : null,
        houseId: place?.startsWith("house:") ? place.slice(6) : null,
        acquiredOn: form.get("acquiredOn"),
        inServiceOn: form.get("inServiceOn"),
        amountCentimes: amount,
        vatCentimes: vat,
        residualCentimes: residual,
        lifeMonths: months(form),
        paidWith: opening ? null : text(form, "paidWith"),
        treasuryId: opening ? null : text(form, "treasuryId"),
        opening: opening ? { on: form.get("openingOn"), accumulatedCentimes: accumulated } : null,
      }),
    "Assets.created",
  );
}

export async function updateAssetAction(_: AssetState, form: FormData): Promise<AssetState> {
  const residual = centimes(form, "residual");
  if (residual === null) return { messageKey: "errors.INVALID_INPUT" };
  return run((ctx) => updateFixedAsset(ctx, { assetId: form.get("assetId"), lifeMonths: months(form), residualCentimes: residual }), "Assets.updated");
}

export async function payAssetAction(_: AssetState, form: FormData): Promise<AssetState> {
  const amount = centimes(form, "amount");
  if (amount === null) return { messageKey: "errors.INVALID_INPUT" };
  const payment = { id: form.get("id"), assetId: form.get("assetId"), day: form.get("day"), amountCentimes: amount, paidWith: form.get("paidWith"), treasuryId: text(form, "treasuryId") };
  return run((ctx) => payFixedAsset(ctx, payment), "Assets.paidSaved");
}

export async function disposeAssetAction(_: AssetState, form: FormData): Promise<AssetState> {
  const price = centimes(form, "price");
  if (price === null) return { messageKey: "errors.INVALID_INPUT" };
  const disposal = { assetId: form.get("assetId"), day: form.get("day"), priceCentimes: price, receivedIn: form.get("receivedIn"), treasuryId: text(form, "treasuryId") };
  return run((ctx) => disposeFixedAsset(ctx, disposal), "Assets.disposedSaved");
}
