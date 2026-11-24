"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, useTransition, type FormEvent } from "react";
import { addStatementAction, importAction, matchAction, type ImportState } from "./actions";
import { danger, field, primary, secondary, table } from "@/components/ui";
import { Num } from "@/components/num";
import { Link } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { CSV_DATE_FORMATS } from "@/modules/finance/shared";

const SEPARATORS = [
  { value: ";", key: "separatorSemicolon" },
  { value: ",", key: "separatorComma" },
  { value: "tab", key: "separatorTab" },
] as const;

/**
 * T117: a statement file, MT940 or a CSV export with the owner's column mapping. "Aperçu" shows what the server read,
 * nothing saved; "Importer" saves it. Submitted by hand, so the chosen file stays in the form between the two.
 */
export function ImportForm({ treasuryId, today, maxBytes }: { treasuryId: string; today: string; maxBytes: number }) {
  const t = useTranslations("Bank");
  const tAll = useTranslations();
  const locale = useLocale();
  const [format, setFormat] = useState<"mt940" | "csv">("mt940");
  const [signed, setSigned] = useState(false);
  const [state, setState] = useState<ImportState>({});
  const [pending, startTransition] = useTransition();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    const file = data.get("file");
    if (file instanceof File && file.size > maxBytes) return setState({ messageKey: "errors.IMPORT_TOO_LARGE" }); // not sent at all
    startTransition(async () => setState(await importAction({}, data)));
  };
  const number = (name: string, label: string, value: number) => (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">{label}</span>
      <input type="number" name={name} min={name === "skipLines" ? 0 : 1} max={100} defaultValue={value} required dir="ltr" className={field} />
    </label>
  );
  const preview = state.preview;
  const badFile = state.messageKey === "errors.IMPORT_TOO_LARGE" || state.messageKey === "errors.IMPORT_FILE_TYPE";
  return (
    <form onSubmit={submit} onChange={() => preview && setState({})} className="flex flex-col gap-3">
      <input type="hidden" name="treasuryId" value={treasuryId} />
      <input type="hidden" name="locale" value={locale} />
      <p className="text-sm text-ink-2">{t("importHint")}</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t("format")}</legend>
        {(["mt940", "csv"] as const).map((f) => (
          <label key={f} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} />
            {t(f === "mt940" ? "formatMt940" : "formatCsv")}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("file")}</span>
        <input type="file" name="file" required accept={format === "mt940" ? ".sta,.mt940,.940,.fin,.txt" : ".csv,.txt,text/csv"} aria-invalid={badFile || undefined} aria-describedby={badFile ? "import-error" : undefined} className={`${field} aria-invalid:border-alert`} />
      </label>
      {format === "csv" && (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">{t("mapping")}</legend>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("separator")}</span>
            <select name="separator" className={field}>
              {SEPARATORS.map((x) => (
                <option key={x.value} value={x.value}>{t(x.key)}</option>
              ))}
            </select>
          </label>
          {number("skipLines", t("skipLines"), 1)}
          {number("dateColumn", t("dateColumn"), 1)}
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("dateFormat")}</span>
            <select name="dateFormat" dir="ltr" className={field}>
              {CSV_DATE_FORMATS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {number("labelColumn", t("labelColumn"), 2)}
          <fieldset className="flex flex-col gap-1">
            <legend className="font-semibold">{t("amountKind")}</legend>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="amountKind" value="split" checked={!signed} onChange={() => setSigned(false)} />
              {t("amountSplit")}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="amountKind" value="signed" checked={signed} onChange={() => setSigned(true)} />
              {t("amountSigned")}
            </label>
          </fieldset>
          {signed ? (
            number("amountColumn", t("amountColumn"), 3)
          ) : (
            <>
              {number("debitColumn", t("debitColumn"), 3)}
              {number("creditColumn", t("creditColumn"), 4)}
            </>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="decimalComma" defaultChecked />
            {t("decimalComma")}
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("endDay")}</span>
            <input type="date" name="endDay" required max={today} className={field} />
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor="import-closing" className="font-semibold">{t("closing")}</label>
            <input id="import-closing" name="closing" required dir="ltr" autoComplete="off" className={field} aria-describedby="import-closing-hint" />
            <span id="import-closing-hint" className="text-sm text-ink-2">{t("closingHint")}</span>
          </div>
        </fieldset>
      )}
      {state.messageKey && <p id="import-error" role="alert" className={danger}>{tAll(state.messageKey, state.values)}</p>}
      {preview && (
        <section role="status" className="flex flex-col gap-3">
          <h3 className="font-semibold">{t("previewTitle")}</h3>
          {preview.statements.map((s) => (
            <div key={s.endDay} className="flex flex-col gap-1">
              <p className="font-semibold">{t("previewStatement", { day: formatDay(s.endDay as FarmDay, locale), count: s.lineCount })}</p>
              <p>
                {s.openingCentimes === null
                  ? t("previewClosing", { closing: formatMoney(BigInt(s.closingCentimes)) })
                  : t("previewBalances", { opening: formatMoney(BigInt(s.openingCentimes)), closing: formatMoney(BigInt(s.closingCentimes)) })}
              </p>
              {s.added === 0 && <p className="text-ink-2">{t("previewAlready")}</p>}
              <table className={table}>
                <tbody>
                  {s.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="p-2">
                        <span className="block">{l.label}</span>
                        <span className="block text-ink-2">{formatDay(l.day as FarmDay, locale)}</span>
                      </td>
                      <Num className="whitespace-nowrap">{formatMoney(BigInt(l.amountCentimes))}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.lineCount > s.lines.length && <p className="text-sm text-ink-2">{t("previewMore", { count: s.lineCount - s.lines.length })}</p>}
            </div>
          ))}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="preview" disabled={pending} className={secondary}>{t("preview")}</button>
        <button type="submit" name="intent" value="import" disabled={pending || !preview} className={primary}>{t("confirmImport")}</button>
      </div>
    </form>
  );
}

type Imported = { id: string; day: string; label: string; amount: string; lineId: string | null; ticked: boolean; book: { pathname: string; query: Record<string, string> } | null };

/**
 * T117: the imported statement's lines, each with its book line: ticked, to tick here (T111's tick), or missing, with
 * the form that books it (FC9).
 */
export function ImportedTable({ statementId, lines, canWrite }: { statementId: string; lines: Imported[]; canWrite: boolean }) {
  const t = useTranslations("Bank");
  const tAll = useTranslations();
  const [state, action, pending] = useActionState(matchAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="statementId" value={statementId} />
      {state.messageKey && <p role="alert" className={danger}>{tAll(state.messageKey)}</p>}
      <table className={table}>
        <thead>
          <tr>
            <th className="p-2 text-start">{tAll("Treasury.label")}</th>
            <th className="p-2 text-end">{t("amount")}</th>
            <th className="p-2 text-start">{t("state")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="p-2">
                <span className="block">{l.label}</span>
                <span className="block text-ink-2">{l.day}</span>
              </td>
              <Num className="whitespace-nowrap">{l.amount}</Num>
              <td className="p-2">
                {l.ticked ? (
                  <span>
                    <span aria-hidden="true">✓ </span>
                    {t("importedTicked")}
                  </span>
                ) : l.lineId && canWrite ? (
                  <button type="submit" name="tick" value={l.lineId} disabled={pending} className={secondary}>{t("tick")}</button>
                ) : (
                  <span className="flex flex-col gap-1">
                    <span className="text-ink-2">{t(l.lineId ? "importedToTick" : "importedMissing")}</span>
                    {l.book && (
                      <Link href={l.book} className="underline underline-offset-4">{t(l.book.pathname === "/expenses" ? "bookFees" : "bookManual")}</Link>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </form>
  );
}

/** SPEC-finance FC9: a statement as printed, its end day and closing balance. */
export function StatementForm({ treasuryId, today }: { treasuryId: string; today: string }) {
  const t = useTranslations("Bank");
  const tAll = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState(addStatementAction, {});
  const badClosing = state.messageKey === "errors.INVALID_INPUT"; // the server reads only the closing balance itself
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="treasuryId" value={treasuryId} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("endDay")}</span>
        <input type="date" name="endDay" required max={today} className={field} />
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="closing" className="font-semibold">{t("closing")}</label>
        <input id="closing" name="closing" required dir="ltr" autoComplete="off" className={`${field} aria-invalid:border-alert`} aria-invalid={badClosing || undefined} aria-describedby={badClosing ? "closing-hint closing-error" : "closing-hint"} />
        <span id="closing-hint" className="text-sm text-ink-2">{t("closingHint")}</span>
      </div>
      {state.messageKey && <p id="closing-error" role="alert" className={danger}>{tAll(state.messageKey)}</p>}
      <button type="submit" disabled={pending} className={primary}>{t("save")}</button>
    </form>
  );
}

type Line = { id: string; day: string; journal: string; label: string; amount: string; ticked: boolean; tickedOn: string | null };

/** The statement's lines: ticked on it, or not yet at the bank. Read-only for the accountant (no buttons). */
export function MatchTable({ statementId, lines, canWrite }: { statementId: string; lines: Line[]; canWrite: boolean }) {
  const t = useTranslations("Bank");
  const tAll = useTranslations();
  const [state, action, pending] = useActionState(matchAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="statementId" value={statementId} />
      {state.messageKey && <p role="alert" className={danger}>{tAll(state.messageKey)}</p>}
      <table className={table}>
        <thead>
          <tr>
            <th className="p-2 text-start">{tAll("Treasury.label")}</th>
            <th className="p-2 text-end">{t("amount")}</th>
            <th className="p-2 text-start">{t("state")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="p-2">
                <span className="block">{l.label}</span>
                <span className="block text-ink-2">{l.day} · {l.journal}</span>
              </td>
              <Num className="whitespace-nowrap">{l.amount}</Num>
              <td className="p-2">
                {l.tickedOn ? (
                  <span className="text-ink-2">{t("tickedOn", { day: l.tickedOn })}</span>
                ) : (
                  <span className="flex items-center gap-2">
                    {l.ticked && <span><span aria-hidden="true">✓</span><span className="sr-only">{t("ticked")}</span></span>}
                    {canWrite && (
                      <button type="submit" name={l.ticked ? "untick" : "tick"} value={l.id} disabled={pending} className={secondary}>
                        {t(l.ticked ? "untick" : "tick")}
                      </button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </form>
  );
}
