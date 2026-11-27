"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg, formatMoney } from "@/lib/format";
import { formatDayShort } from "@/lib/format-day";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes, typedCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import type { FarmDto } from "@/modules/farm-registry/schema";
import {
  CreateStockItem,
  ITEM_KINDS,
  INVENTORY_MUTATIONS as M,
  SUPPLIER_PAYMENT_METHODS,
  UNITS,
  checkDebit,
  checkSupplierPayment,
  issuedOf,
  parseQuantity,
  purchaseAmount,
  stockOnHand,
  supplierBalances,
  supplierDues,
  valuate,
  type ItemKind,
  type Unit,
  type MovementDto,
  type PurchaseDto,
  type StockItemDto,
  type SupplierDto,
  type SupplierPaymentDto,
  type IssuedDebitDto,
} from "@/modules/inventory/schema";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { groupRecords } from "@/offline/group";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { useFieldError, useInline } from "@/components/focus";
import { cell, empty, formActions, rowTable, sectionHead, sectionTitle } from "@/components/layout";
import { cardRow, tightHead } from "@/components/layout-tight";
import { Pager } from "@/components/pager";
import { pageOf, pickTab, TABLE_PAGE } from "@/components/paging";
import { Sheet } from "@/components/sheet";
import { Tabs } from "@/components/tabs";
import { danger, field, ghost, link, primary, primarySm, secondarySm } from "@/components/ui";

// SPEC S1–S3 on the static /stock shell: everything from and to the phone's database (ADR-003). Workers get no money
// from the server at all (I5), so the money parts only render for those allowed to manage stock.
// tasks/plan-ui-cleanup.md: « Enregistrer un achat », « Corriger le stock » and « Ajouter un article » are the page
// header's actions, their forms in a sheet; for those who manage stock, the items, the purchases (newest first, paged,
// by item) and the suppliers (« Payer » in a sheet, §2.9) are query tabs (`?tab=`, `?page=`). The phone keeps its cards.

const card = "flex flex-col gap-1 rounded-2xl border border-line bg-card p-3";
const DEFAULT_UNIT: Record<ItemKind, Unit> = { feed: "kg", vaccine: "dose", medicine: "ml", litter: "kg", gas: "unit", other: "unit" };
const TABS = ["items", "purchases", "suppliers"] as const;

/** Into the page header's actions (the shell's `<span id="actions">`): these openers need the screen's data and state. */
function HeaderActions({ children }: { children: ReactNode }) {
  const slot = document.getElementById("actions");
  return slot && createPortal(children, slot);
}

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
    () => db.records.where("entity").anyOf("farm", "stockItem", "movement", "purchase", "supplier", "supplierPayment", "issuedDebit").toArray(),
    [userId, organizationId],
  );
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [farmId, setFarmId] = useState<string>();
  const { open, opener, close } = useInline<"item" | "purchase" | "adjust">();
  const [message, setMessage] = useState<string>();
  const search = useSearchParams();
  const { of } = useMemo(() => groupRecords(records ?? []), [records]); // once per read
  if (!records || reference === undefined) return null;

  const farms = [...of<FarmDto>("farm")].sort((x, y) => x.name.localeCompare(y.name));
  if (farms.length === 0) {
    return (
      <p>
        {t("Stock.noFarm")} <Link href="/farms" className="underline underline-offset-4">{t("Farms.title")}</Link>
      </p>
    );
  }
  const farm = farms.find((f) => f.id === farmId) ?? farms[0];
  const items = of<StockItemDto>("stockItem").filter((i) => i.farmId === farm.id).sort((x, y) => x.name.localeCompare(y.name));
  const movements = of<MovementDto>("movement");
  const onHand = stockOnHand(movements);
  // S5: what the stock is worth at weighted average cost. Purchases carry amounts only for those who manage stock.
  const paid = new Map(of<PurchaseDto>("purchase").map((p) => [p.id, BigInt(p.amountCentimes ?? 0)]));
  const movementsOf = new Map<string, MovementDto[]>();
  for (const m of movements) {
    const own = movementsOf.get(m.stockItemId);
    if (own) own.push(m);
    else movementsOf.set(m.stockItemId, [m]);
  }
  const worth = new Map<string, bigint>();
  const valueOf = (itemId: string) => {
    let value = worth.get(itemId);
    if (value === undefined) {
      const own = movementsOf.get(itemId) ?? [];
      value = valuate(own.map((m) => ({ id: m.id, day: m.day, quantity: m.quantity, purchaseAmountCentimes: m.purchaseId ? (paid.get(m.purchaseId) ?? 0n) : undefined }))).valueCentimes;
      worth.set(itemId, value);
    }
    return value;
  };
  const suppliers = [...of<SupplierDto>("supplier")].sort((x, y) => x.name.localeCompare(y.name));
  const manage = can(scope, "stock.manage");

  const write: Write = async (mutation, recs) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
      close();
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };

  const list = (
    <section className="flex flex-col gap-3" aria-labelledby="items">
      <div className={sectionHead}>
        <h2 id="items" className={sectionTitle}>{t("Stock.items")}</h2>
        {manage && items.length > 0 && <span className="text-sm text-ink-2">{t("Stock.total", { amount: formatMoney(items.reduce((sum, i) => sum + valueOf(i.id), 0n)) })}</span>}
      </div>
      {items.length === 0 ? <p>{t("Stock.noItems")}</p> : (
        <ul className={`${rowTable} ${manage ? "lg:grid-cols-[minmax(0,1fr)_repeat(4,auto)]" : "lg:grid-cols-[minmax(0,1fr)_repeat(3,auto)]"}`} aria-label={t("Stock.items")}>
          <li aria-hidden="true" className={tightHead}>
            <span>{t("Stock.item")}</span>
            <span className="text-end">{t("Stock.colOnHand")}</span>
            {manage && <span className="text-end">{t("Stock.colValue")}</span>}
            <span className="text-end">{t("Stock.editThreshold")}</span>
            <span>{t("Stock.colState")}</span>
          </li>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              quantity={onHand.get(item.id) ?? 0}
              value={manage ? valueOf(item.id) : undefined}
              write={manage ? write : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );

  const tab = pickTab(TABS, search.get("tab"));
  const purchases = of<PurchaseDto>("purchase");
  const sheetTitle = { item: t("Stock.addItem"), purchase: t("Stock.purchase"), adjust: t("Stock.adjust") };
  const opens = (k: "item" | "purchase" | "adjust") => ({ type: "button" as const, "aria-haspopup": "dialog" as const, ...opener(k) });
  return (
    <>
      {manage && (
        <HeaderActions>
          {items.length > 0 && <button {...opens("adjust")} className={secondarySm}>{t("Stock.adjust")}</button>}
          <button {...opens("item")} className={secondarySm}>{t("Stock.addItem")}</button>
          {items.length > 0 && <button {...opens("purchase")} className={primarySm}>{t("Stock.purchase")}</button>}
        </HeaderActions>
      )}
      <Sheet open={manage && open !== undefined} onClose={close} title={open && sheetTitle[open]}>
        {open === "item" ? (
          <ItemForm farmId={farm.id} products={reference?.data.products ?? []} write={write} onCancel={close} />
        ) : open === "purchase" ? (
          <PurchaseForm items={items} suppliers={suppliers} write={write} onCancel={close} />
        ) : open === "adjust" ? (
          <AdjustForm items={items} write={write} onCancel={close} />
        ) : null}
      </Sheet>
      {farms.length > 1 && (
        <div className="lg:max-w-sm">
          <Select label={t("Stock.farm")} value={farm.id} onChange={setFarmId}>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
        </div>
      )}
      {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
      {manage && (
        <Tabs
          label={t("Stock.title")}
          current={tab}
          tabs={TABS.map((key) => ({ key, label: t(`Stock.tabs.${key}`), href: { pathname: "/stock", query: { tab: key } } }))}
        />
      )}
      {!manage || tab === "items" ? (
        list
      ) : tab === "purchases" ? (
        <Purchases items={items} purchases={purchases} movements={movements} onHand={onHand} write={write} page={search.get("page")} />
      ) : (
        <Suppliers suppliers={suppliers} purchases={purchases} payments={of<SupplierPaymentDto>("supplierPayment")} debits={of<IssuedDebitDto>("issuedDebit")} write={write} />
      )}
    </>
  );
}

function useQuantityText() {
  const t = useTranslations("Stock");
  return (quantity: number, unit: Unit) => (unit === "kg" ? formatKg(quantity) : `${formatCount(quantity)} ${t(`units.${unit}`)}`);
}

/** `value` and `write` only for those who manage stock: workers get no money (I5). */
function ItemRow({ item, quantity, value, write }: { item: StockItemDto; quantity: number; value?: bigint; write?: Write }) {
  const t = useTranslations("Stock");
  const locale = useLocale();
  const show = useQuantityText();
  const { open: editing, opener, close } = useInline<"threshold">();
  const low = item.lowStockThreshold !== null && quantity < item.lowStockThreshold; // S6, on the phone too

  const saveThreshold = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = read(e.currentTarget)("threshold");
    const lowStockThreshold = text ? parseQuantity(text, item.unit) : null;
    if (text && lowStockThreshold === null) return;
    await write!(
      { type: M.setThreshold, payload: { stockItemId: item.id, lowStockThreshold } },
      [{ entity: "stockItem", id: item.id, data: { ...item, lowStockThreshold } }],
    );
    close();
  };

  // The cells come in the table's order. On the phone, `order` keeps the card as it was: the name and its badge on the
  // first line, then the quantities, the lot. A label the table's header already says is for screen readers only from
  // lg (`<l>` in the message). The threshold itself opens its edit (`<e>`): no button on every row.
  const label = (chunks: ReactNode) => <span className="lg:sr-only">{chunks}</span>;
  const threshold = item.lowStockThreshold;
  const edit = (name: string, chunks: ReactNode) => (
    <button type="button" {...opener("threshold")} aria-label={name} className={link}>
      {chunks}
    </button>
  );
  // From lg the figures sit at their column's end (B4).
  const figure = "order-1 basis-full lg:order-none lg:text-end lg:whitespace-nowrap";
  return (
    <li className={`flex flex-wrap items-start gap-x-3 gap-y-1 rounded-2xl border border-line bg-card p-3 ${cardRow}`}>
      <span className={cell}>
        <span className="min-w-0 flex-1 font-semibold lg:flex-none">{item.name}</span>
        {item.lot && item.expiresOn && (
          <span className="order-2 basis-full text-sm text-muted">{t("lotUntil", { lot: item.lot, date: formatDay(item.expiresOn as FarmDay, locale) })}</span>
        )}
      </span>
      <span className={`${figure} text-xl font-semibold lg:text-base`}>{t.rich("onHand", { quantity: show(quantity, item.unit), l: label })}</span>
      {value !== undefined && <span className={`${figure} text-sm text-ink-2`}>{t.rich("value", { amount: formatMoney(value), l: label })}</span>}
      {threshold === null && !write ? (
        <span className="hidden lg:block" />
      ) : (
        <span className={`${figure} text-sm text-muted`}>
          {threshold === null
            ? t.rich("thresholdSet", { l: label, e: (chunks) => edit(t("thresholdSetOf", { item: item.name }), chunks) })
            : write
              ? t.rich("thresholdEdit", { quantity: show(threshold, item.unit), l: label, e: (chunks) => edit(t("thresholdEditOf", { item: item.name, quantity: show(threshold, item.unit) }), chunks) })
              : t.rich("alertBelow", { quantity: show(threshold, item.unit), l: label })}
        </span>
      )}
      {/* Colour only for what needs action (B6): a chip for a low stock, nothing for the others. */}
      {low ? <span className="shrink-0 rounded-full bg-brick-soft px-2.5 py-0.5 text-xs font-medium text-brick-fg lg:justify-self-start">{t("low")}</span> : <span className="hidden lg:block" />}
      {write && editing && (
        <form onSubmit={saveThreshold} className="order-3 mt-2 flex basis-full flex-col gap-2 lg:order-none lg:col-span-full lg:max-w-md">
          <Field
            name="threshold"
            label={`${t("editThreshold")} (${t(`units.${item.unit}`)})`}
            defaultValue={threshold === null ? "" : item.unit === "kg" ? String(threshold / 1000) : String(threshold)}
            inputMode="decimal"
            dir="ltr"
            autoFocus
          />
          <p className="text-sm text-muted">{t("thresholdHint")}</p>
          <Buttons onCancel={close} />
        </form>
      )}
    </li>
  );
}

/**
 * SPEC-finance §9 "Cancelled records": the farm's recent purchases, each cancelled after a confirmation (then typed
 * again) while all the stock it brought is still there; the server also refuses one a payment covers.
 */
function Purchases({ items, purchases, movements, onHand, write, page: asked }: { items: StockItemDto[]; purchases: PurchaseDto[]; movements: MovementDto[]; onHand: Map<string, number>; write: Write; page: string | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const show = useQuantityText();
  const [error, setError] = useState<string>();
  const [only, setOnly] = useState(""); // one item's purchases; "" for all
  const itemOf = new Map(items.map((i) => [i.id, i]));
  const all = purchases.filter((p) => itemOf.has(p.stockItemId) && (!only || p.stockItemId === only)).sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id));
  const page = pageOf(asked ?? undefined, all.length, TABLE_PAGE);
  const recent = all.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE);
  const labelOf = (p: PurchaseDto) => {
    const item = itemOf.get(p.stockItemId)!;
    return t("Stock.purchaseLine", { date: formatDay(p.day as FarmDay, locale), item: item.name, quantity: show(p.quantity, item.unit), amount: formatMoney(BigInt(p.amountCentimes ?? 0)) });
  };
  const cancel = async (p: PurchaseDto) => {
    if ((onHand.get(p.stockItemId) ?? 0) < p.quantity) return setError("errors.STOCK_ALREADY_USED"); // as the server
    setError(undefined);
    if (!confirm(t("Stock.voidConfirm", { purchase: labelOf(p) }))) return;
    const own = movements.filter((m) => m.purchaseId === p.id);
    await write({ type: M.cancelPurchase, payload: { purchaseId: p.id } }, [{ entity: "purchase", id: p.id, data: null }, ...own.map((m) => ({ entity: "movement", id: m.id, data: null }))]);
  };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="purchases">
      <div className={sectionHead}>
        <h2 id="purchases" className={sectionTitle}>{t("Stock.purchases")}</h2>
        {items.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            {t("Stock.item")}
            <select
              value={only}
              onChange={(e) => {
                setOnly(e.target.value);
                window.history.replaceState(null, "", "?tab=purchases"); // back to the first page, without a navigation
              }}
              className={`${field} lg:max-w-xs`}
            >
              <option value="">{t("Stock.allItems")}</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      {recent.length === 0 ? <p className={empty}>{t("Stock.noPurchases")}</p> : (
      <ul className={`${rowTable} lg:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]`} aria-labelledby="purchases">
        <li aria-hidden="true" className={tightHead}>
          <span>{t("Stock.day")}</span>
          <span>{t("Stock.item")}</span>
          <span className="text-end">{t("Stock.colQuantity")}</span>
          <span className="text-end">{t("Stock.colAmount")}</span>
        </li>
        {recent.map((p) => {
          const item = itemOf.get(p.stockItemId)!;
          return (
            <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-card p-3 ${cardRow}`}>
              {/* The phone's line, read whole by screen readers; its parts in columns from lg. */}
              <span className="lg:sr-only">{labelOf(p)}</span>
              <span aria-hidden="true" className="hidden whitespace-nowrap lg:block">{formatDayShort(p.day, locale, today())}</span>
              <span aria-hidden="true" className="hidden lg:block">{item.name}</span>
              <span aria-hidden="true" className="hidden whitespace-nowrap text-end lg:block">{show(p.quantity, item.unit)}</span>
              <span aria-hidden="true" className="hidden whitespace-nowrap text-end lg:block"><bdi dir="ltr">{formatMoney(BigInt(p.amountCentimes ?? 0))}</bdi></span>
              <button type="button" onClick={() => cancel(p)} aria-label={t("Stock.voidOf", { purchase: labelOf(p) })} className={`${link} text-sm lg:justify-self-end`}>{t("Stock.void")}</button>
            </li>
          );
        })}
      </ul>
      )}
      <Pager page={page} size={TABLE_PAGE} total={all.length} href={(n) => ({ pathname: "/stock", query: { tab: "purchases", page: n } })} />
    </section>
  );
}

// §2.9: one row per supplier, the soonest due first: its dues, its cheques and bills not yet debited, what is still owed,
// and « Payer », whose form opens in a sheet with what is owed filled in.
function Suppliers({ suppliers, purchases, payments, debits, write }: { suppliers: SupplierDto[]; purchases: PurchaseDto[]; payments: SupplierPaymentDto[]; debits: IssuedDebitDto[]; write: Write }) {
  const t = useTranslations("Stock");
  const locale = useLocale();
  const { open: paying, opener, close } = useInline<string>();
  const [error, setError] = useState<string>();
  const tAll = useTranslations();
  if (suppliers.length === 0) return <p className={empty}>{t("noSuppliers")}</p>;
  // FN11, issued side: cheques and bills given to suppliers that the bank hasn't debited yet
  const issued = issuedOf(
    purchases.map((p) => ({ id: p.id, supplierId: p.supplierId, day: p.day, paidCentimes: BigInt(p.paidCentimes ?? 0), paidMethod: p.paidMethod })),
    payments.map((p) => ({ ...p, amountCentimes: BigInt(p.amountCentimes) })),
    debits,
  )
    .filter((i) => !i.debitedOn)
    .sort((x, y) => x.dueOn.localeCompare(y.dueOn));
  const debit = async (instrumentId: string) => {
    const day = today();
    const checked = checkDebit(issued.find((i) => i.id === instrumentId), day);
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    const d: IssuedDebitDto = { id: uuidv7(), instrumentId, day };
    await write({ type: M.debitIssued, payload: d }, [{ entity: "issuedDebit", id: d.id, data: d }]);
  };
  // FN12, supplier side: what is still due to each, by due date
  const duesOf = (id: string) =>
    supplierDues(
      purchases.filter((p) => p.supplierId === id).map((p) => ({ day: p.day, dueOn: p.dueOn ?? null, amountCentimes: BigInt(p.amountCentimes ?? 0), paidCentimes: BigInt(p.paidCentimes ?? 0) })),
      payments.filter((p) => p.supplierId === id).reduce((a, p) => a + BigInt(p.amountCentimes), 0n),
    );
  const balances = supplierBalances(
    purchases.map((p) => ({ supplierId: p.supplierId, amountCentimes: BigInt(p.amountCentimes ?? 0), paidCentimes: BigInt(p.paidCentimes ?? 0) })),
    payments.map((p) => ({ supplierId: p.supplierId, amountCentimes: BigInt(p.amountCentimes) })),
  );
  const soonest = (id: string) => duesOf(id).reduce((min, d) => (d.dueOn < min ? d.dueOn : min), "~"); // "~": after every date
  const rows = suppliers.map((s) => ({ s, dues: duesOf(s.id), owed: balances.get(s.id) ?? 0n, first: soonest(s.id) })).sort((x, y) => x.first.localeCompare(y.first) || x.s.name.localeCompare(y.s.name));
  const supplier = suppliers.find((s) => s.id === paying);
  const label = (chunks: ReactNode) => <span className="lg:sr-only">{chunks}</span>;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="suppliers">
      <h2 id="suppliers" className={sectionTitle}>{t("suppliers")}</h2>
      {error && <p role="alert" className={danger}>{tAll(error)}</p>}
      <ul className={`${rowTable} lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto_auto]`} aria-labelledby="suppliers">
        <li aria-hidden="true" className={tightHead}>
          <span>{t("supplier")}</span>
          <span>{t("colDues")}</span>
          <span className="text-end">{t("colOwed")}</span>
        </li>
        {rows.map(({ s, dues, owed }) => (
          <li key={s.id} className={`${card} ${cardRow}`}>
            <span className="font-semibold">{s.name}</span>
            <div className={cell}>
              {dues.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm" aria-label={t("dues", { supplier: s.name })}>
                  {dues.map((d) => (
                    <li key={d.dueOn} className={d.dueOn < today() ? "font-semibold text-brick-fg" : "text-ink-2"}>
                      {t(d.dueOn < today() ? "dueLateLine" : "dueLine", { amount: formatMoney(d.amountCentimes), date: formatDay(d.dueOn as FarmDay, locale) })}
                    </li>
                  ))}
                </ul>
              )}
              {issued.some((i) => i.supplierId === s.id) && (
                <ul className="flex flex-col gap-2 text-sm" aria-label={t("issued", { supplier: s.name })}>
                  {issued
                    .filter((i) => i.supplierId === s.id)
                    .map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className={i.dueOn < today() ? "font-semibold text-brick-fg" : "text-ink-2"}>
                          {t("issuedLine", { kind: t(`payMethods.${i.kind}`), number: i.number ?? "—", amount: formatMoney(i.amountCentimes), date: formatDay(i.dueOn as FarmDay, locale) })}
                        </span>
                        <button type="button" onClick={() => debit(i.id)} className={secondarySm}>{t("debited")}</button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <span className="font-semibold lg:whitespace-nowrap lg:text-end">{t.rich("owed", { amount: formatMoney(owed), l: label })}</span>
            {owed > 0n ? (
              <button type="button" aria-haspopup="dialog" {...opener(s.id)} aria-label={t("pay", { supplier: s.name })} className={`${secondarySm} lg:justify-self-end`}>
                {t("payOpen")}
              </button>
            ) : (
              <span className="hidden lg:block" />
            )}
          </li>
        ))}
      </ul>
      <Sheet open={!!supplier} onClose={close} title={supplier && t("pay", { supplier: supplier.name })}>
        {supplier && <SupplierPaymentForm supplier={supplier} balance={balances.get(supplier.id) ?? 0n} write={write} onDone={close} />}
      </Sheet>
    </section>
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

function Select({ label, children, value, defaultValue, onChange, name, autoFocus }: { label: string; children: ReactNode; value?: string; defaultValue?: string; onChange?: (v: string) => void; name?: string; autoFocus?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} value={value} defaultValue={defaultValue} onChange={onChange && ((e) => onChange(e.target.value))} autoFocus={autoFocus} className={field}>
        {children}
      </select>
    </div>
  );
}

function Buttons({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("Stock");
  return (
    <div className={formActions}>
      <button type="submit" className={primary}>{t("save")}</button>
      <button type="button" onClick={onCancel} className={`${ghost} min-w-11`}>{t("cancel")}</button>
    </div>
  );
}

const read = (form: HTMLFormElement) => {
  const data = new FormData(form);
  return (k: string) => String(data.get(k) ?? "").trim();
};
const today = () => farmDayOf(new Date());

/** S2, SPEC-finance FN6: paying a supplier later, up to what is owed, as the server checks it. */
function SupplierPaymentForm({ supplier, balance, write, onDone }: { supplier: SupplierDto; balance: bigint; write: Write; onDone: () => void }) {
  const t = useTranslations();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const [method, setMethod] = useState<SupplierPaymentDto["method"]>("cash");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const get = read(e.currentTarget);
    const amount = parseCentimes(get("amount"));
    if (amount === null) return setError("errors.INVALID_INPUT", e.currentTarget, "amount");
    const checked = checkSupplierPayment(amount, balance);
    if (!checked.ok) return setError(`errors.${checked.error}`, e.currentTarget, "amount");
    const method = get("method") as SupplierPaymentDto["method"];
    const day = get("day") || today();
    // FN11: an issued cheque's or bill's number and agreed date (a cheque is payable on sight: its date is a reminder)
    const instrument = method === "cheque" || method === "bill" ? { number: get("number") || null, dueOn: get("dueOn") || day } : null;
    const payment: SupplierPaymentDto = { id: uuidv7(), supplierId: supplier.id, day, amountCentimes: String(amount), method, instrument };
    if (await write({ type: M.recordSupplierPayment, payload: payment }, [{ entity: "supplierPayment", id: payment.id, data: payment }])) onDone();
  };
  return (
    <form onSubmit={submit} aria-label={t("Stock.pay", { supplier: supplier.name })} className="flex flex-col gap-3">
      <Field name="amount" label={t("Stock.payAmount")} defaultValue={typedCentimes(balance)} inputMode="decimal" required dir="ltr" autoFocus {...bad("amount")} />
      <Select name="method" label={t("Stock.payMethod")} value={method} onChange={(v) => setMethod(v as SupplierPaymentDto["method"])}>
        {SUPPLIER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`Stock.payMethods.${m}`)}</option>)}
      </Select>
      <Field name="day" label={t("Stock.day")} type="date" defaultValue={today()} max={today()} required />
      {(method === "cheque" || method === "bill") && (
        <>
          <Field name="number" label={t("Stock.instrumentNumber")} maxLength={40} dir="ltr" />
          <Field name="dueOn" label={t("Stock.instrumentDueOn")} type="date" defaultValue={today()} />
        </>
      )}
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <Buttons onCancel={onDone} />
    </form>
  );
}

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
      lowStockThreshold: get("threshold") ? parseQuantity(get("threshold"), get("unit") as Unit) : null,
    });
    setInvalid(!item.success);
    if (item.success) await write({ type: M.createStockItem, payload: item.data }, [{ entity: "stockItem", id: item.data.id, data: item.data }]);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Select label={t("kind")} value={kind} onChange={(v) => setKind(v as ItemKind)} autoFocus>
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
      <Field name="threshold" label={t("threshold", { unit: t(`units.${DEFAULT_UNIT[kind]}`) })} inputMode="decimal" dir="ltr" />
      {tracked && (
        <>
          <Field name="lot" label={t("lot")} required maxLength={60} dir="ltr" />
          <Field name="expiresOn" label={t("expiresOn")} type="date" required />
        </>
      )}
      {invalid && <p role="alert" className={danger}>{t("invalid")}</p>}
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
    const vat = parseCentimes(get("vat") || "0"); // SPEC-finance FN9: part of the total
    const newName = get("newSupplier");
    if (parsed.quantity === null || parsed.price === null || paid === null || vat === null || amount === null || paid > amount || vat > amount || (supplierId === "new" && !newName)) {
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
      vatCentimes: String(vat),
      paidMethod: get("paidMethod") as NonNullable<PurchaseDto["paidMethod"]>,
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Select label={t("Stock.supplier")} value={supplierId} onChange={setSupplierId} autoFocus>
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
      <Select name="paidMethod" label={t("Stock.payMethod")} defaultValue="cash">
        {SUPPLIER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`Stock.payMethods.${m}`)}</option>)}
      </Select>
      <Field name="vat" label={t("Stock.vat")} inputMode="decimal" dir="ltr" />
      <Field name="dueOn" label={t("Stock.dueOn")} type="date" />
      {invalid && <p role="alert" className={danger}>{t("Stock.invalid")}</p>}
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Select label={t("Stock.item")} value={itemId} onChange={setItemId} autoFocus>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>
      <Field name="day" label={t("Stock.day")} type="date" defaultValue={today()} required />
      <Field name="quantity" label={t("Stock.adjustQuantity", { unit: t(`Stock.units.${item.unit}`) })} inputMode="decimal" required dir="ltr" />
      <Field name="reason" label={t("Stock.reason")} required maxLength={200} />
      {invalid && <p role="alert" className={danger}>{t("Stock.invalid")}</p>}
      <Buttons onCancel={onCancel} />
    </form>
  );
}

