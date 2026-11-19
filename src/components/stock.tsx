"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import type { FarmDto } from "@/modules/farm-registry/schema";
import {
  CreateStockItem,
  ITEM_KINDS,
  INVENTORY_MUTATIONS as M,
  UNITS,
  parseQuantity,
  purchaseAmount,
  stockOnHand,
  supplierBalances,
  type ItemKind,
  type Unit,
  type MovementDto,
  type PurchaseDto,
  type StockItemDto,
  type SupplierDto,
} from "@/modules/inventory/schema";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC S1–S3 on the static /stock shell: everything from and to the phone's database (ADR-003). Workers get no money
// from the server at all (I5), so the money parts only render for those allowed to manage stock.

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
const card = "flex flex-col gap-1 rounded-lg border border-current/30 p-3";
const DEFAULT_UNIT: Record<ItemKind, Unit> = { feed: "kg", vaccine: "dose", medicine: "ml", litter: "kg", gas: "unit", other: "unit" };

export function StockScreen() {
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
  return <Stock key={scopeKey(scope)} {...scope} />;
}

type Write = (mutation: { type: string; payload: unknown }, records: { entity: string; id: string; data: unknown }[]) => Promise<boolean>;

function Stock(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(
    () => db.records.where("entity").anyOf("farm", "stockItem", "movement", "purchase", "supplier").toArray(),
    [userId, organizationId],
  );
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [farmId, setFarmId] = useState<string>();
  const [open, setOpen] = useState<"item" | "purchase" | "adjust" | null>(null);
  const [message, setMessage] = useState<string>();
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = of<FarmDto>("farm").sort((x, y) => x.name.localeCompare(y.name));
  if (farms.length === 0) {
    return (
      <p>
        {t("Stock.noFarm")} <Link href="/farms" className="underline underline-offset-4">{t("Farms.title")}</Link>
      </p>
    );
  }
  const farm = farms.find((f) => f.id === farmId) ?? farms[0];
  const items = of<StockItemDto>("stockItem").filter((i) => i.farmId === farm.id).sort((x, y) => x.name.localeCompare(y.name));
  const onHand = stockOnHand(of<MovementDto>("movement"));
  const suppliers = of<SupplierDto>("supplier").sort((x, y) => x.name.localeCompare(y.name));
  const manage = can(scope, "stock.manage");

  const write: Write = async (mutation, recs) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
      setOpen(null);
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };

  return (
    <>
      {farms.length > 1 && (
        <Select label={t("Stock.farm")} value={farm.id} onChange={setFarmId}>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      )}
      {message && <p role="status" className="rounded-lg bg-green-700/10 p-3">{t(message)}</p>}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("Stock.items")}</h2>
        {items.length === 0 ? <p>{t("Stock.noItems")}</p> : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => <ItemRow key={item.id} item={item} quantity={onHand.get(item.id) ?? 0} />)}
          </ul>
        )}
      </section>
      {manage && (
        <section className="flex flex-col gap-3">
          {open === "item" ? (
            <ItemForm farmId={farm.id} products={reference?.data.products ?? []} write={write} onCancel={() => setOpen(null)} />
          ) : open === "purchase" ? (
            <PurchaseForm items={items} suppliers={suppliers} write={write} onCancel={() => setOpen(null)} />
          ) : open === "adjust" ? (
            <AdjustForm items={items} write={write} onCancel={() => setOpen(null)} />
          ) : (
            <>
              <button type="button" onClick={() => setOpen("item")} className={secondary}>{t("Stock.addItem")}</button>
              {items.length > 0 && <button type="button" onClick={() => setOpen("purchase")} className={primary}>{t("Stock.purchase")}</button>}
              {items.length > 0 && <button type="button" onClick={() => setOpen("adjust")} className={secondary}>{t("Stock.adjust")}</button>}
            </>
          )}
          <Suppliers suppliers={suppliers} purchases={of<PurchaseDto>("purchase")} />
        </section>
      )}
    </>
  );
}

function useQuantityText() {
  const t = useTranslations("Stock");
  return (quantity: number, unit: Unit) => (unit === "kg" ? formatKg(quantity) : `${formatCount(quantity)} ${t(`units.${unit}`)}`);
}

function ItemRow({ item, quantity }: { item: StockItemDto; quantity: number }) {
  const t = useTranslations("Stock");
  const locale = useLocale();
  const show = useQuantityText();
  return (
    <li className={card}>
      <span className="font-semibold">{item.name}</span>
      <span>{t("onHand", { quantity: show(quantity, item.unit) })}</span>
      {item.lot && item.expiresOn && (
        <span className="text-sm opacity-75">{t("lotUntil", { lot: item.lot, date: formatDay(item.expiresOn as FarmDay, locale) })}</span>
      )}
    </li>
  );
}

function Suppliers({ suppliers, purchases }: { suppliers: SupplierDto[]; purchases: PurchaseDto[] }) {
  const t = useTranslations("Stock");
  if (suppliers.length === 0) return null;
  const balances = supplierBalances(
    purchases.map((p) => ({ supplierId: p.supplierId, amountCentimes: BigInt(p.amountCentimes ?? 0), paidCentimes: BigInt(p.paidCentimes ?? 0) })),
  );
  return (
    <>
      <h2 className="text-lg font-semibold">{t("suppliers")}</h2>
      <ul className="flex flex-col gap-2">
        {suppliers.map((s) => (
          <li key={s.id} className={card}>
            <span className="font-semibold">{s.name}</span>
            <span>{t("owed", { amount: formatMoney(balances.get(s.id) ?? 0n) })}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={field} {...input} />
    </div>
  );
}

function Select({ label, children, value, defaultValue, onChange, name }: { label: string; children: ReactNode; value?: string; defaultValue?: string; onChange?: (v: string) => void; name?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} value={value} defaultValue={defaultValue} onChange={onChange && ((e) => onChange(e.target.value))} className={field}>
        {children}
      </select>
    </div>
  );
}

function Buttons({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("Stock");
  return (
    <div className="flex gap-3">
      <button type="submit" className={primary}>{t("save")}</button>
      <button type="button" onClick={onCancel} className={secondary}>{t("cancel")}</button>
    </div>
  );
}

const read = (form: HTMLFormElement) => {
  const data = new FormData(form);
  return (k: string) => String(data.get(k) ?? "").trim();
};
const today = () => farmDayOf(new Date());

function ItemForm({ farmId, products, write, onCancel }: { farmId: string; products: { id: string; kind: string; nameFr: string; nameAr: string }[]; write: Write; onCancel: () => void }) {
  const t = useTranslations("Stock");
  const locale = useLocale();
  const [kind, setKind] = useState<ItemKind>("feed");
  const [invalid, setInvalid] = useState(false);
  const catalogue = products.filter((p) => p.kind === kind);
  const tracked = kind === "vaccine" || kind === "medicine";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const get = read(e.currentTarget);
    const product = catalogue.find((p) => p.id === get("productId"));
    const item = CreateStockItem.safeParse({
      id: uuidv7(),
      farmId,
      productId: product?.id ?? null,
      kind,
      name: get("name") || (product ? (locale === "ar" ? product.nameAr : product.nameFr) : ""),
      unit: get("unit"),
      lot: tracked ? get("lot") : null,
      expiresOn: tracked ? get("expiresOn") || null : null,
    });
    setInvalid(!item.success);
    if (item.success) await write({ type: M.createStockItem, payload: item.data }, [{ entity: "stockItem", id: item.data.id, data: item.data }]);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-current/30 p-3">
      <Select label={t("kind")} value={kind} onChange={(v) => setKind(v as ItemKind)}>
        {ITEM_KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
      </Select>
      {catalogue.length > 0 && (
        <Select label={t("product")} name="productId">
          <option value="">{t("none")}</option>
          {catalogue.map((p) => <option key={p.id} value={p.id}>{locale === "ar" ? p.nameAr : p.nameFr}</option>)}
        </Select>
      )}
      <Field name="name" label={t("name")} maxLength={120} />
      <Select key={kind} label={t("unit")} name="unit" defaultValue={DEFAULT_UNIT[kind]}>
        {UNITS.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
      </Select>
      {tracked && (
        <>
          <Field name="lot" label={t("lot")} required maxLength={60} dir="ltr" />
          <Field name="expiresOn" label={t("expiresOn")} type="date" required />
        </>
      )}
      {invalid && <p role="alert">{t("invalid")}</p>}
      <Buttons onCancel={onCancel} />
    </form>
  );
}

function PurchaseForm({ items, suppliers, write, onCancel }: { items: StockItemDto[]; suppliers: SupplierDto[]; write: Write; onCancel: () => void }) {
  const t = useTranslations();
  const [itemId, setItemId] = useState(items[0].id);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "new");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [invalid, setInvalid] = useState(false);
  const item = items.find((i) => i.id === itemId)!;
  const unitName = t(`Stock.units.${item.unit}`);
  const parsed = { quantity: parseQuantity(quantity, item.unit), price: parseCentimes(price) };
  const amount = parsed.quantity !== null && parsed.price !== null ? purchaseAmount(parsed.quantity, item.unit, parsed.price) : null;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const get = read(e.currentTarget);
    const paid = parseCentimes(get("paid") || "0");
    const newName = get("newSupplier");
    if (parsed.quantity === null || parsed.price === null || paid === null || amount === null || paid > amount || (supplierId === "new" && !newName)) {
      return setInvalid(true);
    }
    setInvalid(false);
    let sid = supplierId;
    if (supplierId === "new") {
      const supplier: SupplierDto = { id: uuidv7(), name: newName, phone: null };
      if (!(await write({ type: M.createSupplier, payload: supplier }, [{ entity: "supplier", id: supplier.id, data: supplier }]))) return;
      sid = supplier.id;
    }
    const purchase = {
      id: uuidv7(),
      supplierId: sid,
      stockItemId: item.id,
      day: get("day") || today(),
      quantity: parsed.quantity,
      unitPriceCentimes: String(parsed.price),
      paidCentimes: String(paid),
      dueOn: get("dueOn") || null,
    };
    const movementId = uuidv7();
    const movement: MovementDto = { id: movementId, farmId: item.farmId, stockItemId: item.id, kind: "purchase", quantity: purchase.quantity, day: purchase.day, reason: null, purchaseId: purchase.id };
    const local: PurchaseDto = { ...purchase, farmId: item.farmId, amountCentimes: String(amount) };
    await write({ type: M.recordPurchase, payload: { ...purchase, movementId } }, [
      { entity: "purchase", id: purchase.id, data: local },
      { entity: "movement", id: movementId, data: movement },
    ]);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-current/30 p-3">
      <Select label={t("Stock.supplier")} value={supplierId} onChange={setSupplierId}>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value="new">{t("Stock.newSupplier")}</option>
      </Select>
      {supplierId === "new" && <Field name="newSupplier" label={t("Stock.newSupplierName")} required maxLength={120} />}
      <Select label={t("Stock.item")} value={itemId} onChange={setItemId}>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>
      <Field name="day" label={t("Stock.day")} type="date" defaultValue={today()} required />
      <Field name="quantity" label={t("Stock.quantity", { unit: unitName })} value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" required dir="ltr" />
      <Field name="price" label={t("Stock.unitPrice", { unit: unitName })} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required dir="ltr" />
      {amount !== null && <p>{t("Stock.amount", { amount: formatMoney(amount) })}</p>}
      <Field name="paid" label={t("Stock.paid")} defaultValue="0" inputMode="decimal" dir="ltr" />
      <Field name="dueOn" label={t("Stock.dueOn")} type="date" />
      {invalid && <p role="alert">{t("Stock.invalid")}</p>}
      <Buttons onCancel={onCancel} />
    </form>
  );
}

function AdjustForm({ items, write, onCancel }: { items: StockItemDto[]; write: Write; onCancel: () => void }) {
  const t = useTranslations();
  const [itemId, setItemId] = useState(items[0].id);
  const [invalid, setInvalid] = useState(false);
  const item = items.find((i) => i.id === itemId)!;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const get = read(e.currentTarget);
    const text = get("quantity");
    const negative = text.startsWith("-");
    const size = parseQuantity(negative ? text.slice(1) : text, item.unit);
    const reason = get("reason");
    if (size === null || !reason) return setInvalid(true);
    setInvalid(false);
    const movement: MovementDto = { id: uuidv7(), farmId: item.farmId, stockItemId: item.id, kind: "adjustment", quantity: negative ? -size : size, day: get("day") || today(), reason, purchaseId: null };
    await write(
      { type: M.adjustStock, payload: { id: movement.id, stockItemId: item.id, day: movement.day, quantity: movement.quantity, reason } },
      [{ entity: "movement", id: movement.id, data: movement }],
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-current/30 p-3">
      <Select label={t("Stock.item")} value={itemId} onChange={setItemId}>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>
      <Field name="day" label={t("Stock.day")} type="date" defaultValue={today()} required />
      <Field name="quantity" label={t("Stock.adjustQuantity", { unit: t(`Stock.units.${item.unit}`) })} inputMode="decimal" required dir="ltr" />
      <Field name="reason" label={t("Stock.reason")} required maxLength={200} />
      {invalid && <p role="alert">{t("Stock.invalid")}</p>}
      <Buttons onCancel={onCancel} />
    </form>
  );
}

