import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { formatDayShort } from "@/lib/format-day";
import { formatMonth } from "@/lib/format-month";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { typedCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import { associateAccount, cashForecast, catchUpBooks, creditExpensesToPay, placementsToPay, treasuryOverview } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { card, field, secondarySm } from "@/components/ui";
import { dataTable, dataTableWrap, empty, num, sectionHead, sectionTitle, split } from "@/components/layout";
import { Page, PeriodNav } from "@/components/page";
import { Pager } from "@/components/pager";
import { pageOf, TABLE_PAGE } from "@/components/paging";
import { SheetButton } from "@/components/sheet";
import { payCreditExpenseAction, payPlacementAction, recordAssociateAction, setDefaultTreasuryAction } from "./actions";
import { TreasuryForm, TreasuryNotices } from "./pay-form";
import { TreasuryTabs } from "./treasury-tabs";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Nav", "Offline", "Sync.refused", "Treasury.associateSaved", "Treasury.paid", "Ui", "errors"];

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

// SPEC-finance FN10: an online page for the owner and the manager (the web side of SPEC's split): each bank account's
// and cash box's balance, and a month's movements on 5141 / 5161 (?month=, this month by default). Server-rendered from
// the ledger, never cached. tasks/plan-ui-cleanup.md: the balances and the forecast side by side, one « À payer » table
// whose « Payer » opens the pay form in a sheet, « Apport ou retrait » in a sheet, the movements paged (?page=).
export default function TreasuryPage({ searchParams }: { searchParams: Search }) {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <Treasury searchParams={searchParams} />
      </Suspense>
    </ClientMessages>
  );
}

// The schedule's weeks: the year goes without saying ("20 nov."). Here, not in lib/format: /batches ships that file.
const dayMonth = (day: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** "2026-11" moved by `by` months. */
const shift = (month: string, by: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);

/** A cell shown from lg only: on the phone its content is in the row's first cell. */
const wide = "hidden lg:table-cell";

async function Treasury({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const today = farmDayOf(new Date());
  const canPay = can(ctx.value, "finance.record"); // the accountant reads the lists to pay, without the forms (SPEC-m5 PA5)
  const asked = typeof search.month === "string" ? search.month : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  await catchUpBooks(ctx.value); // SPEC-finance §9: once, so every read below sees the same, caught-up books
  const [overview, forecast, toPay, expensesToPay, owners] = await Promise.all([
    treasuryOverview(ctx.value, month),
    cashForecast(ctx.value),
    placementsToPay(ctx.value),
    creditExpensesToPay(ctx.value),
    associateAccount(ctx.value), // the owner only
  ]);
  if (!overview.ok || !forecast.ok) {
    return (
      <Page width="wide" back="/more" title={t("Treasury.title")}>
        <p>{t("Treasury.forbidden")}</p>
      </Page>
    );
  }
  const { accounts, unassignedCentimes, movements } = overview.value;
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? t(id === null ? "Treasury.untagged" : "Treasury.unknown");
  const total = accounts.reduce((s, a) => s + a.balanceCentimes, unassignedCentimes); // the forecast's start
  // §9 "Default cash box and bank account": shown, and changed, only where there is a choice (two of a kind or more)
  const choice = (kind: string) => accounts.filter((a) => a.kind === kind).length > 1;
  const label = (text: string, input: ReactNode) => (
    <label className="flex flex-col gap-1">
      {text}
      {input}
    </label>
  );
  // §2.9: the placements' chicks or hens and the credit expenses still owed, in one list, the oldest due first. A
  // placement is due on its placement day (the hatchery's terms aren't recorded), a credit expense on its own day.
  const dues = [
    ...(toPay.ok ? toPay.value : []).map((p) => ({
      key: p.batchId,
      due: p.placedOn as string,
      type: "placement" as const,
      what: p.hatchery,
      detail: p.place, // no account number here (B5): it stays on /books and /settings/chart
      name: p.hatchery,
      owed: p.owed,
      action: payPlacementAction,
      hidden: <input type="hidden" name="batchId" value={p.batchId} />,
    })),
    ...(expensesToPay.ok ? expensesToPay.value : []).map((e) => ({
      key: e.expenseId,
      due: e.day as string,
      type: "expense" as const,
      what: t(`Expenses.categories.${e.category}`),
      detail: e.note,
      name: `${t(`Expenses.categories.${e.category}`)} · ${formatDay(e.day, lang)}`,
      owed: e.owed,
      action: payCreditExpenseAction,
      hidden: <input type="hidden" name="expenseId" value={e.expenseId} />,
    })),
  ].sort((x, y) => x.due.localeCompare(y.due));
  // A debt's pay form (placement, credit expense): day, amount (what is still owed, to change for a part), how, from
  // which cash box or bank account. Moved into the sheet as it was.
  const payForm = (d: (typeof dues)[number]) => (
    <TreasuryForm action={d.action} submit={t("Assets.paySave")}>
      {d.hidden}
      <input type="hidden" name="id" value={uuidv7()} />
      {label(t("Assets.payDay"), <input type="date" name="day" defaultValue={today} max={today} required className={field} />)}
      {label(t("Assets.payAmount"), <input name="amount" inputMode="decimal" required dir="ltr" defaultValue={typedCentimes(d.owed)} className={field} />)}
      {label(
        t("Assets.paidWith"),
        <select name="paidWith" required defaultValue="" className={field}>
          <option value="" disabled>—</option>
          {(["cash", "transfer", "cheque"] as const).map((m) => <option key={m} value={m}>{t(`Assets.methods.${m}`)}</option>)}
        </select>,
      )}
      {label(
        t("Assets.treasury"),
        <select name="treasuryId" defaultValue="" className={field}>
          <option value="">—</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>,
      )}
    </TreasuryForm>
  );
  // SPEC-finance FN6, FQ11 (§9 "Associate contributions"): money an associate or the exploitant brings in or takes out (owner)
  const associate = owners.ok && (
    <SheetButton label={t("Treasury.associateOpen")} title={t(owners.value.individual ? "Treasury.exploitant" : "Treasury.associate")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">{t(owners.value.individual ? "Treasury.exploitantHintPlain" : "Treasury.associateHintPlain")}</p>
        {accounts.length === 0 ? (
          <p>{t("Treasury.associateNoAccount")}</p>
        ) : (
          <TreasuryForm action={recordAssociateAction} submit={t("Treasury.associateSave")}>
            <input type="hidden" name="id" value={uuidv7()} />
            {label(
              t("Treasury.direction"),
              <select name="direction" required defaultValue="contribution" className={field}>
                {(["contribution", "withdrawal"] as const).map((d) => <option key={d} value={d}>{t(`Treasury.directions.${d}`)}</option>)}
              </select>,
            )}
            {label(t("Treasury.day"), <input type="date" name="day" defaultValue={today} max={today} required className={field} />)}
            {label(t("Treasury.amount"), <input name="amount" inputMode="decimal" required dir="ltr" className={field} />)}
            {label(
              t("Treasury.into"),
              <select name="treasuryId" required defaultValue="" className={field}>
                <option value="" disabled>—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{t(`Expenses.kinds.${a.kind}`)} · {a.name}</option>)}
              </select>,
            )}
            {!owners.value.individual && label(t("Treasury.associateName"), <input name="associate" maxLength={80} className={field} />)}
          </TreasuryForm>
        )}
      </div>
    </SheetButton>
  );
  const page = pageOf(search.page, movements.length, TABLE_PAGE);
  // shortcut: in-memory page slice of the month's movements, move to skip/take in treasuryOverview past ~1 000 lines a month
  const shown = movements.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE);
  const money = (c: bigint) => <bdi dir="ltr">{formatMoney(c)}</bdi>;
  const receipt = (m: (typeof movements)[number]) =>
    m.receipt ? (
      <a href={`/api/files/${m.receipt}`} aria-label={t("Treasury.receiptViewOf", { line: `${formatDay(m.day as FarmDay, lang)} · ${m.label}` })} className="underline underline-offset-4">{t("Treasury.receiptView")}</a>
    ) : m.receipt === null ? (
      <span className="text-brick-fg">{t("Treasury.receiptMissing")}</span>
    ) : null;

  return (
    <Page width="wide" back="/more" title={t("Treasury.title")} actions={associate} nav={<TreasuryTabs current="overview" />}>
      <TreasuryNotices>
        <div className={split}>
          <div className="flex flex-col gap-2">
            <ul className={`${card} gap-0 py-1`} aria-label={t("Treasury.balances")}>
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2">
                  <span>
                    {t(`Expenses.kinds.${a.kind}`)} · {a.name}
                    {a.isDefault && choice(a.kind) && <span className="ms-2 text-sm text-ink-2">({t("Treasury.default")})</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    {canPay && !a.isDefault && choice(a.kind) && (
                      <TreasuryForm action={setDefaultTreasuryAction} submit={t("Treasury.makeDefault")} submitLabel={t("Treasury.makeDefaultOf", { name: a.name })} look={secondarySm}>
                        <input type="hidden" name="treasuryId" value={a.id} />
                      </TreasuryForm>
                    )}
                    <span dir="ltr" className="font-semibold tabular-nums">{formatMoney(a.balanceCentimes)}</span>
                  </span>
                </li>
              ))}
              {unassignedCentimes !== 0n && (
                <li className="flex justify-between gap-4 border-b border-line py-2">
                  <span>{t("Treasury.unassigned")}</span>
                  <span dir="ltr" className="font-semibold tabular-nums">{formatMoney(unassignedCentimes)}</span>
                </li>
              )}
              <li className="flex justify-between gap-4 py-2 font-semibold">
                <span>{t("Treasury.total")}</span>
                <span dir="ltr" className="tabular-nums">{formatMoney(total)}</span>
              </li>
            </ul>
            {(choice("cash") || choice("bank")) && <p className="text-sm text-ink-2">{t("Treasury.defaultHint")}</p>}
          </div>
          {/* F-Effects: the next weeks' cash, from today's cash and bank and what falls due */}
          <section className="flex flex-col gap-2" aria-labelledby="schedule">
            <div className={sectionHead}>
              <h2 id="schedule" className={sectionTitle}>{t("Treasury.schedule")}</h2>
              <span className="text-sm text-ink-2">{t("Treasury.scheduleStart", { amount: formatMoney(forecast.value.startCentimes) })}</span>
            </div>
            <div className={dataTableWrap}>
              <table className={dataTable} aria-label={t("Treasury.schedule")}>
                <thead>
                  <tr>
                    <th>{t("Treasury.weekOf")}</th>
                    <th className={`${num} ${wide}`}>{t("Treasury.inflow")}</th>
                    <th className={`${num} ${wide}`}>{t("Treasury.outflow")}</th>
                    <th className={num}>{t("Treasury.cashAfter")}</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.value.weeks.map((w) => (
                    <tr key={w.from}>
                      <td className="whitespace-nowrap">{dayMonth(w.from, lang)}</td>
                      <td className={`${num} ${wide}`}>{w.inCentimes === 0n ? "" : money(w.inCentimes)}</td>
                      <td className={`${num} ${wide}`}>{w.outCentimes === 0n ? "" : money(w.outCentimes)}</td>
                      {/* Colour only for what needs action: the balance that goes below zero, not its whole week */}
                      <td className={num}>
                        <span className={w.afterCentimes < 0n ? "font-semibold text-brick-fg" : ""}>{money(w.afterCentimes)}</span>
                        {/* the phone: what comes in and goes out under the balance */}
                        {(w.inCentimes !== 0n || w.outCentimes !== 0n) && (
                          <span className="block text-xs text-ink-2 lg:hidden">
                            {w.inCentimes !== 0n && <span className="block">{t("Treasury.inflow")} {money(w.inCentimes)}</span>}
                            {w.outCentimes !== 0n && <span className="block">{t("Treasury.outflow")} {money(w.outCentimes)}</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-ink-2">{t("Treasury.scheduleNote")}</p>
          </section>
        </div>

        {/* SPEC-finance §9 "Placement debts" and "Credit expenses": what is still owed, paid here (owner, manager; the accountant reads) */}
        {dues.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="to-pay">
            <div className={sectionHead}>
              <h2 id="to-pay" className={sectionTitle}>{t("Treasury.toPay")}</h2>
              <span className="text-sm text-ink-2">{t("Treasury.toPayHint")}</span>
            </div>
            <div className={dataTableWrap}>
              <table className={dataTable} aria-labelledby="to-pay">
                <thead>
                  <tr>
                    <th className={wide}>{t("Treasury.colDue")}</th>
                    <th className={wide}>{t("Treasury.colType")}</th>
                    <th>{t("Treasury.colWhat")}</th>
                    <th className={num}>{t("Treasury.colOwed")}</th>
                    {canPay && <th><span className="sr-only">{t("Treasury.pay")}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {dues.map((d) => (
                    <tr key={d.key}>
                      <td className={`whitespace-nowrap ${wide}`}>{formatDay(d.due as FarmDay, lang)}</td>
                      <td className={`whitespace-nowrap ${wide}`}>{t(`Treasury.types.${d.type}`)}</td>
                      <td>
                        <span className="font-medium">{d.what}</span>
                        {d.detail && <span className="block text-ink-2 lg:inline"><span className="hidden lg:inline"> · </span>{d.detail}</span>}
                        <span className="block text-ink-2 lg:hidden">{t(`Treasury.types.${d.type}`)} · {formatDay(d.due as FarmDay, lang)}</span>
                      </td>
                      <td className={`${num} font-semibold`}>{money(d.owed)}</td>
                      {canPay && (
                        <td>
                          {/* a flex row, not text-end: the sheet's dialog sits in this cell and would inherit it */}
                          <div className="flex justify-end">
                            <SheetButton label={<>{t("Treasury.pay")}<span className="sr-only"> : {d.name}</span></>} title={t("Treasury.payOf", { name: d.name })}>
                              {payForm(d)}
                            </SheetButton>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2" aria-labelledby="movements">
          <div className={sectionHead}>
            <h2 id="movements" className={sectionTitle}>{t("Treasury.movements")}</h2>
          </div>
          <PeriodNav
            label={t("Treasury.month")}
            period={formatMonth(month, lang)}
            prev={{ href: { pathname: "/treasury", query: { month: shift(month, -1) } }, label: t("Treasury.previousMonth") }}
            next={{ href: { pathname: "/treasury", query: { month: shift(month, 1) } }, label: t("Treasury.nextMonth") }}
          />
          {movements.length === 0 ? (
            <p className={empty}>{t("Treasury.none")}</p>
          ) : (
            <>
              <div className={dataTableWrap}>
                <table className={dataTable} aria-labelledby="movements">
                  <thead>
                    <tr>
                      <th className={wide}>{t("Treasury.day")}</th>
                      <th className={wide}>{t("Treasury.journal")}</th>
                      <th>{t("Treasury.label")}</th>
                      <th className={wide}>{t("Treasury.account")}</th>
                      <th className={wide}>{t("Treasury.counterAccount")}</th>
                      <th className={wide}>{t("Treasury.batch")}</th>
                      <th className={`${num} ${wide}`}>{t("Treasury.in")}</th>
                      <th className={`${num} ${wide}`}>{t("Treasury.out")}</th>
                      <th className={`${num} lg:hidden`}>{t("Bank.amount")}</th>
                      <th className={wide}>{t("Treasury.receipt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m, i) => {
                      const counter = m.counterAccounts.map((c) => c.label || c.number).join(", "); // FN10, as the cash book shows them (FN16)
                      return (
                        <tr key={i}>
                          <td className={`whitespace-nowrap ${wide}`}>{formatDayShort(m.day, lang, today)}</td>
                          <td className={wide}>
                            <abbr title={t(`Treasury.journals.${m.journal}`)} className="rounded-md bg-shell px-1.5 py-0.5 text-xs font-medium no-underline">{m.journal}</abbr>
                          </td>
                          <td>
                            {/* wide screens: one line per movement, the whole text in its title */}
                            <span title={m.label} className="lg:block lg:max-w-60 lg:truncate">{m.label}</span>
                            {/* the phone: the columns it leaves out, under the label */}
                            <span className="block text-xs text-ink-2 lg:hidden">
                              {[formatDayShort(m.day, lang, today), m.journal, nameOf(m.treasuryId), counter].filter(Boolean).join(" · ")}
                            </span>
                            {m.receipt !== undefined && <span className="block text-xs lg:hidden">{t("Treasury.receipt")} : {receipt(m)}</span>}
                          </td>
                          <td className={`whitespace-nowrap ${wide}`}>{nameOf(m.treasuryId)}</td>
                          <td className={wide}>
                            <span title={counter} className="block max-w-48 truncate">{counter}</span>
                          </td>
                          <td className={wide}>
                            {m.batch && <span title={`${m.batch.house} · ${formatDayShort(m.batch.placedOn, lang, today)}`} className="block max-w-48 truncate">{`${m.batch.house} · ${formatDayShort(m.batch.placedOn, lang, today)}`}</span>}
                          </td>
                          <td className={`${num} ${wide}`}>{m.debitCentimes > 0n && money(m.debitCentimes)}</td>
                          <td className={`${num} ${wide}`}>{m.creditCentimes > 0n && money(m.creditCentimes)}</td>
                          <td className={`${num} lg:hidden`}>
                            <bdi dir="ltr">{m.debitCentimes > 0n ? `+${formatMoney(m.debitCentimes)}` : `−${formatMoney(m.creditCentimes)}`}</bdi>
                          </td>
                          {/* FN10: an expense's receipt; other movements have none to attach */}
                          <td className={wide}>{receipt(m)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} size={TABLE_PAGE} total={movements.length} href={(n) => ({ pathname: "/treasury", query: { month, page: n } })} />
              {/* The journals' codes, said once in words: BQ banque, CA caisse… (the cells also carry it as a title) */}
              <p className="text-sm text-ink-2">
                {t("Treasury.journalLegend", { journals: [...new Set(movements.map((m) => m.journal))].sort().map((j) => `${j} ${t(`Treasury.journals.${j}`)}`).join(" · ") })}
              </p>
            </>
          )}
        </section>
      </TreasuryNotices>
    </Page>
  );
}
