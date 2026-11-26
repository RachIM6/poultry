"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { missingRequiredVaccines } from "@/modules/health/shared";
import {
  ProtocolItem,
  REFERENCE_MUTATIONS as M,
  VACCINATION_METHODS,
  type Product,
  type ProtocolDto,
} from "@/modules/reference-data/schema";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { useInline } from "@/components/focus";
import { dataTable, dataTableWrap, empty, formActions, sectionHead, sectionTitle } from "@/components/layout";
import { Sheet } from "@/components/sheet";
import { card, field, ghost, primary, secondarySm } from "@/components/ui";

// SPEC R2 on the static /protocol shell: the template comes from the cached reference data, the organisation's copies
// from its own database; both work offline (ADR-003, R4). tasks/plan-ui-cleanup.md: the farm's own programmes first, each
// a table with « Ajouter un vaccin » in a sheet; then the reference templates as one compact list, what they all share
// (not checked by a vet, no vaccine yet) said once above it.

type Save = (mutation: { type: string; payload: unknown }, record: { entity: string; id: string; data: unknown }) => Promise<void>;

export function ProtocolScreen() {
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
  return <Protocols key={scopeKey(scope)} {...scope} />;
}

function Protocols(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const copies = useLiveQuery(() => db.records.where("entity").equals("protocol").toArray(), [userId, organizationId]);
  const [message, setMessage] = useState<"Farms.saved" | "Farms.saveFailed">();

  if (reference === undefined || copies === undefined) return null;
  if (reference === null) return <p>{t("Protocol.noReference")}</p>;

  const { protocolTemplates, products } = reference.data;
  const vaccines = products.filter((p) => p.kind === "vaccine");
  const nameOf = (p: { nameFr: string; nameAr: string }) => (locale === "ar" ? p.nameAr : p.nameFr);
  const manage = can(scope, "protocols.manage");
  const save: Save = async (mutation, record) => {
    try {
      await writeLocal(db, mutation, record);
      setMessage("Farms.saved");
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };

  // Said once when every template shares it; else on the rows it concerns (OQ4: shown until a vet signs one off)
  const allUnreviewed = protocolTemplates.every((p) => !p.reviewedByVet);
  const allEmpty = protocolTemplates.every((p) => p.items.length === 0);
  const notes = [allUnreviewed && t("Protocol.notReviewedAll"), allEmpty && t("Protocol.emptyTemplates")].filter(Boolean).join(" ");
  return (
    <>
      {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
      <section className="flex flex-col gap-3" aria-labelledby="yours">
        <h2 id="yours" className={sectionTitle}>{t("Protocol.yours")}</h2>
        {copies.length === 0 ? (
          <p className={empty}>{t("Protocol.none")}</p>
        ) : (
          copies.map((record) => (
            <Editor key={record.id} protocol={record.data as ProtocolDto} vaccines={vaccines} nameOf={nameOf} manage={manage} save={save} />
          ))
        )}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="templates">
        <h2 id="templates" className={sectionTitle}>{t("Protocol.templates")}</h2>
        {notes && <p className="max-w-prose text-sm text-ink-2">{notes}</p>}
        <ul className={`${card} gap-0 py-1`} aria-labelledby="templates">
          {protocolTemplates.map((template) => (
            <li key={template.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-b-0">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{nameOf(template)}</span>
                {template.items.length > 0 && <Items items={template.items} vaccines={vaccines} nameOf={nameOf} />}
              </span>
              <span className="flex flex-wrap items-center gap-3">
                {!allEmpty && template.items.length === 0 && <span className="text-sm text-ink-2">{t("Protocol.noItems")}</span>}
                {!allUnreviewed && !template.reviewedByVet && <span className="rounded-full bg-chick-soft px-2.5 py-0.5 text-xs font-medium text-chick-fg">{t("Protocol.notReviewed")}</span>}
                {manage && (
                  <button
                    type="button"
                    aria-label={t("Protocol.copyOf", { name: nameOf(template) })}
                    className={secondarySm}
                    onClick={() => {
                      const id = uuidv7();
                      const data: ProtocolDto = { id, templateId: template.id, name: nameOf(template), items: template.items };
                      void save({ type: M.copyProtocol, payload: { id, templateId: template.id, name: data.name } }, { entity: "protocol", id, data });
                    }}
                  >
                    {t("Protocol.copy")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

type NameOf = (p: { nameFr: string; nameAr: string }) => string;

function Items({ items, vaccines, nameOf }: { items: ProtocolItem[]; vaccines: Product[]; nameOf: NameOf }) {
  const t = useTranslations("Protocol");
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink-2">
      {items.map((item, i) => {
        const vaccine = vaccines.find((v) => v.id === item.productId);
        return <li key={`${item.dayOfAge}-${item.productId}-${i}`}>{t("item", { day: String(item.dayOfAge), vaccine: vaccine ? nameOf(vaccine) : item.productId, method: t(`methods.${item.method}`) })}</li>;
      })}
    </ul>
  );
}

const byDay = (items: ProtocolItem[]) => [...items].sort((x, y) => x.dayOfAge - y.dayOfAge);

function Editor({ protocol, vaccines, nameOf, manage, save }: { protocol: ProtocolDto; vaccines: Product[]; nameOf: NameOf; manage: boolean; save: Save }) {
  const t = useTranslations("Protocol");
  const { open: adding, opener, close } = useInline<"add">();
  const ids = { day: useId(), vaccine: useId(), method: useId() };
  const update = (items: ProtocolItem[]) =>
    save({ type: M.updateProtocol, payload: { id: protocol.id, changes: { items } } }, { entity: "protocol", id: protocol.id, data: { ...protocol, items } });

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const item = ProtocolItem.safeParse({ dayOfAge: Number(form.get("day")), productId: form.get("vaccine"), method: form.get("method") });
    if (!item.success) return;
    await update(byDay([...protocol.items, item.data]));
    close();
  };
  const line = (item: ProtocolItem) => {
    const vaccine = vaccines.find((v) => v.id === item.productId);
    return { vaccine: vaccine ? nameOf(vaccine) : item.productId, method: t(`methods.${item.method}`) };
  };

  return (
    <div className="flex flex-col gap-2">
      <div className={sectionHead}>
        <h3 className="font-semibold">{protocol.name}</h3>
        {manage && (
          <button type="button" aria-haspopup="dialog" aria-label={t("addItemTo", { name: protocol.name })} {...opener("add")} className={secondarySm}>
            {t("addItem")}
          </button>
        )}
      </div>
      {/* OQ4: a warning, never a block (arrêté 3308-17 art. 13) */}
      {missingRequiredVaccines(protocol.items).map((r) => (
        <p key={r.disease} className="rounded-xl bg-chick-soft p-2 text-sm text-chick-fg">{t(`required.${r.disease}`, { source: r.source })}</p>
      ))}
      {protocol.items.length === 0 ? (
        <p className={empty}>{t("noItems")}</p>
      ) : (
        <div className={dataTableWrap}>
          <table className={dataTable} aria-label={protocol.name}>
            <thead>
              <tr>
                <th>{t("day")}</th>
                <th>{t("vaccine")}</th>
                <th>{t("method")}</th>
                {manage && <th><span className="sr-only">{t("colActions")}</span></th>}
              </tr>
            </thead>
            <tbody>
              {protocol.items.map((item, i) => (
                <tr key={`${item.dayOfAge}-${item.productId}-${i}`}>
                  <td className="tabular-nums">{item.dayOfAge}</td>
                  <td>{line(item).vaccine}</td>
                  <td>{line(item).method}</td>
                  {manage && (
                    <td>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => void update(protocol.items.filter((_, j) => j !== i))}
                          aria-label={t("removeOf", { item: t("item", { day: String(item.dayOfAge), ...line(item) }) })}
                          className={`${ghost} min-w-11`}
                        >
                          {t("remove")}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Sheet open={manage && adding === "add"} onClose={close} title={t("addItemTo", { name: protocol.name })}>
        <form onSubmit={add} className="flex flex-col gap-3">
          <label htmlFor={ids.day}>{t("day")}</label>
          <input id={ids.day} name="day" required inputMode="numeric" pattern="\d+" dir="ltr" className={field} />
          <label htmlFor={ids.vaccine}>{t("vaccine")}</label>
          <select id={ids.vaccine} name="vaccine" required className={field}>
            {vaccines.map((v) => <option key={v.id} value={v.id}>{nameOf(v)}</option>)}
          </select>
          <label htmlFor={ids.method}>{t("method")}</label>
          <select id={ids.method} name="method" className={field}>
            {VACCINATION_METHODS.map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}
          </select>
          <div className={formActions}>
            <button type="submit" className={primary}>{t("add")}</button>
            <button type="button" onClick={close} className={`${ghost} min-w-11`}>{t("cancel")}</button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
