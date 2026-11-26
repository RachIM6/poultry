import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Page } from "@/components/page";
import { card, field, table, warn } from "@/components/ui";
import { Num } from "@/components/num";
import { redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { ASSET_ACCOUNTS, ASSET_CATEGORIES, assetRegister, type AssetView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { AssetActionForm, AssetForm, TreasurySelect } from "./form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Assets", "Files", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FC1 (T102), FCX2: the fixed-asset register, online like /books. Per asset: cost, accumulated
// depreciation and net book value, and its schedule by year. The owner writes; the manager and the accountant read.
export default function AssetsPage() {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <AssetsView />
      </Suspense>
    </ClientMessages>
  );
}

// The categories by FC1 group: land, then each 4-digit depreciation account's (2832–2835; the categories post to its leaves).
const groupOf = (c: (typeof ASSET_CATEGORIES)[number]) => ASSET_ACCOUNTS[c].depreciation?.slice(0, 4) ?? "land";
const GROUPS = [...new Set(ASSET_CATEGORIES.map(groupOf))].map((group) => ({ group, categories: ASSET_CATEGORIES.filter((c) => groupOf(c) === group) }));

async function AssetsView() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await assetRegister(ctx.value);
  if (!result.ok) return <Page width="wide" back="/more"><p>{t("Assets.forbidden")}</p></Page>;
  const register = result.value;
  const owner = can(ctx.value, "finance.manage") && register.farms !== undefined;
  const today = farmDayOf(new Date());
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const money = (c: bigint) => <bdi dir="ltr" className="tabular-nums">{formatMoney(c)}</bdi>;

  return (
    <Page width="wide" back="/more" title={t("Assets.title")} subtitle={<span className="block max-w-prose">{t("Assets.hint")}</span>}>
      {register.books !== "ledger" && <p className={warn}>{t("Assets.cashBook")}</p>}
      {owner && (
        <details className={card}>
          <summary className="disclosure font-semibold">{t("Assets.add")}</summary>
          <AssetForm today={today} openingDay={register.fiscalYear.from} groups={GROUPS} farms={register.farms ?? []} treasury={register.treasury ?? []} />
        </details>
      )}
      {register.assets.length === 0 ? (
        <p>{t("Assets.none")}</p>
      ) : (
        register.assets.map((a) => <Asset key={a.id} a={a} />)
      )}
    </Page>
  );

  function Asset({ a }: { a: AssetView }) {
    const yearEnd = day(register.fiscalYear.to);
    return (
      <section aria-label={a.label} className={card}>
        <h2 className="text-xl font-semibold">{a.label}</h2>
        <p className="text-sm text-ink-2">
          {t(`Assets.categories.${a.category}`)} · <bdi dir="ltr">{t("Assets.accountOf", { account: a.account })}</bdi>
          {a.place && <> · {a.place}</>}
          {a.receiptFileId && <> · <a href={`/api/files/${a.receiptFileId}`} className="underline underline-offset-4">{t("Assets.receiptOf")}</a></>}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>{t("Assets.cost")}</dt>
          <dd>{money(a.cost)}</dd>
          {a.disposedOn === null && (
            <>
              <dt>{t("Assets.accumulatedAt", { day: yearEnd })}</dt>
              <dd>{money(a.accumulated)}</dd>
              <dt>{t("Assets.netBookValue", { day: yearEnd })}</dt>
              <dd>{money(a.cost - a.accumulated)}</dd>
            </>
          )}
        </dl>
        <ul className="text-sm">
          <li>
            {t("Assets.inService", { day: day(a.inServiceOn) })} · {a.lifeMonths === null ? t("Assets.notDepreciated") : t("Assets.lifeOf", { months: a.lifeMonths })}
          </li>
          {a.opening ? (
            <li>{t("Assets.inOpening", { day: day(a.opening.on), amount: formatMoney(a.opening.accumulated) })}</li>
          ) : (
            a.paidWith && <li>{t("Assets.paid", { method: t(`Assets.methods.${a.paidWith}`) })}</li>
          )}
          {a.debtAccount && register.books === "ledger" && (
            <li>{a.lastPaymentOn ? t("Assets.debtUntil", { day: day(a.lastPaymentOn), account: a.debtAccount }) : t("Assets.debtOn", { account: a.debtAccount })}</li>
          )}
          {a.owed > 0n && register.books === "ledger" && <li>{t("Assets.owed", { amount: formatMoney(a.owed) })}</li>}
          {a.disposedOn && <li className="font-semibold">{t("Assets.disposed", { day: day(a.disposedOn), amount: formatMoney(a.disposalPrice ?? 0n) })}</li>}
        </ul>
        {a.schedule.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className={table} aria-label={t("Assets.schedule", { label: a.label })}>
              <caption className="p-2 text-start font-semibold">{t("Assets.schedule", { label: a.label })}</caption>
              <thead>
                <tr>
                  <th className="p-2 text-start">{t("Assets.year")}</th>
                  <th className="p-2 text-end">{t("Assets.months")}</th>
                  <th className="p-2 text-end">{t("Assets.charge")}</th>
                  <th className="p-2 text-end">{t("Assets.cumulative")}</th>
                  <th className="p-2 text-end">{t("Assets.nbv")}</th>
                </tr>
              </thead>
              <tbody>
                {a.schedule.map((y) => (
                  <tr key={y.from} className="border-t border-line">
                    <td className="p-2">
                      <bdi dir="ltr">{y.from.slice(0, 4) === y.to.slice(0, 4) ? y.from.slice(0, 4) : `${y.from.slice(0, 4)}–${y.to.slice(0, 4)}`}</bdi>
                      {y.toDisposal && <span className="text-muted"> · {t("Assets.byDisposal")}</span>}
                    </td>
                    <Num>{y.months}</Num>
                    <Num>{formatMoney(y.charge)}</Num>
                    <Num>{formatMoney(y.accumulated)}</Num>
                    <Num>{formatMoney(y.netBookValue)}</Num>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {owner && a.disposedOn === null && <OwnerForms a={a} />}
      </section>
    );
  }

  // The owner's changes to one asset, each folded away (FC1: life and residual, a later payment, the disposal).
  function OwnerForms({ a }: { a: AssetView }) {
    const treasury = register.treasury ?? [];
    const label = (text: string, input: ReactNode) => (
      <label className="flex flex-col gap-1">
        {text}
        {input}
      </label>
    );
    const fold = (summary: string, body: ReactNode) => (
      <details className="rounded-2xl border border-line p-3">
        <summary className="disclosure">{summary}</summary>
        <div className="pt-3">{body}</div>
      </details>
    );
    return (
      <div className="flex flex-col gap-2">
        {a.lifeMonths !== null &&
          fold(
            t("Assets.edit"),
            <AssetActionForm kind="update" submit={t("Assets.editSave")}>
              <input type="hidden" name="assetId" value={a.id} />
              {label(t("Assets.life"), <input type="number" name="lifeMonths" min={1} max={1200} step={1} required defaultValue={a.lifeMonths} dir="ltr" className={field} />)}
              {label(t("Assets.residual"), <input name="residual" inputMode="decimal" defaultValue={formatMoney(a.residual).replace(" DH", "")} dir="ltr" className={field} />)}
            </AssetActionForm>,
          )}
        {a.owed > 0n && register.books === "ledger" &&
          fold(
            t("Assets.pay"),
            <AssetActionForm kind="pay" submit={t("Assets.paySave")}>
              <input type="hidden" name="assetId" value={a.id} />
              <input type="hidden" name="id" value={uuidv7()} />
              {label(t("Assets.payDay"), <input type="date" name="day" defaultValue={today} max={today} required className={field} />)}
              {label(t("Assets.payAmount"), <input name="amount" inputMode="decimal" required dir="ltr" className={field} />)}
              {label(
                t("Assets.paidWith"),
                <select name="paidWith" required defaultValue="" className={field}>
                  <option value="" disabled>—</option>
                  {(["cash", "transfer", "cheque"] as const).map((m) => <option key={m} value={m}>{t(`Assets.methods.${m}`)}</option>)}
                </select>,
              )}
              <TreasurySelect treasury={treasury} label={t("Assets.treasury")} />
            </AssetActionForm>,
          )}
        {fold(
          t("Assets.dispose"),
          <AssetActionForm kind="dispose" submit={t("Assets.disposeSave")}>
            <input type="hidden" name="assetId" value={a.id} />
            {label(t("Assets.disposeDay"), <input type="date" name="day" defaultValue={today} max={today} required className={field} />)}
            {label(t("Assets.price"), <input name="price" inputMode="decimal" required dir="ltr" className={field} />)}
            {label(
              t("Assets.receivedIn"),
              <select name="receivedIn" required defaultValue="cash" className={field}>
                {(["cash", "bank"] as const).map((m) => <option key={m} value={m}>{t(`Assets.received.${m}`)}</option>)}
              </select>,
            )}
            <TreasurySelect treasury={treasury} label={t("Assets.treasury")} />
          </AssetActionForm>,
        )}
      </div>
    );
  }
}
