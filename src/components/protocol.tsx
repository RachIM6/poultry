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
import { field, primary, secondary } from "@/components/ui";

// SPEC R2 on the static /protocol shell: the template comes from the cached reference data, the organisation's copies
// from its own database; both work offline (ADR-003, R4).

const card = "flex flex-col gap-2 rounded-2xl border border-line bg-card p-3";
// Wide screens: the templates two by two, the organisation's own programmes beside them (a copy appears there at once).
const columns = "flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start lg:gap-x-8";

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

  return (
    <>
      {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
      <div className={columns}>
        <section className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
          <h2 className="text-[17px] font-semibold text-ink-2 lg:col-span-full">{t("Protocol.template")}</h2>
          {protocolTemplates.map((template) => (
            <div key={template.id} className={card}>
              <span className="font-semibold">{nameOf(template)}</span>
              {/* OQ4: shown until a vet signs the template off */}
              {!template.reviewedByVet && <p className="rounded-xl bg-chick-soft p-2 text-sm text-chick-fg">{t("Protocol.notReviewed")}</p>}
              {template.items.length === 0 ? (
                <p className="text-sm text-muted">{t("Protocol.emptyTemplate")}</p>
              ) : (
                <Items items={template.items} vaccines={vaccines} nameOf={nameOf} />
              )}
              {manage && (
                <button
                  type="button"
                  className={`${secondary} self-start`}
                  onClick={() => {
                    const id = uuidv7();
                    const data: ProtocolDto = { id, templateId: template.id, name: nameOf(template), items: template.items };
                    void save({ type: M.copyProtocol, payload: { id, templateId: template.id, name: data.name } }, { entity: "protocol", id, data });
                  }}
                >
                  {t("Protocol.copy")}
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold text-ink-2">{t("Protocol.yours")}</h2>
          {copies.length === 0 ? (
            <p>{t("Protocol.none")}</p>
          ) : (
            copies.map((record) => (
              <Editor key={record.id} protocol={record.data as ProtocolDto} vaccines={vaccines} nameOf={nameOf} manage={manage} save={save} />
            ))
          )}
        </section>
      </div>
    </>
  );
}

type NameOf = (p: { nameFr: string; nameAr: string }) => string;

function Items({ items, vaccines, nameOf, onRemove }: { items: ProtocolItem[]; vaccines: Product[]; nameOf: NameOf; onRemove?: (index: number) => void }) {
  const t = useTranslations("Protocol");
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => {
        const vaccine = vaccines.find((v) => v.id === item.productId);
        return (
          <li key={`${item.dayOfAge}-${item.productId}-${i}`} className="flex items-center justify-between gap-2">
            <span>{t("item", { day: String(item.dayOfAge), vaccine: vaccine ? nameOf(vaccine) : item.productId, method: t(`methods.${item.method}`) })}</span>
            {onRemove && <button type="button" onClick={() => onRemove(i)} className={secondary}>{t("remove")}</button>}
          </li>
        );
      })}
    </ul>
  );
}

const byDay = (items: ProtocolItem[]) => [...items].sort((x, y) => x.dayOfAge - y.dayOfAge);

function Editor({ protocol, vaccines, nameOf, manage, save }: { protocol: ProtocolDto; vaccines: Product[]; nameOf: NameOf; manage: boolean; save: Save }) {
  const t = useTranslations("Protocol");
  const [adding, setAdding] = useState(false);
  const ids = { day: useId(), vaccine: useId(), method: useId() };
  const update = (items: ProtocolItem[]) =>
    save({ type: M.updateProtocol, payload: { id: protocol.id, changes: { items } } }, { entity: "protocol", id: protocol.id, data: { ...protocol, items } });

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const item = ProtocolItem.safeParse({ dayOfAge: Number(form.get("day")), productId: form.get("vaccine"), method: form.get("method") });
    if (!item.success) return;
    await update(byDay([...protocol.items, item.data]));
    setAdding(false);
  };

  return (
    <div className={card}>
      <span className="font-semibold">{protocol.name}</span>
      {/* OQ4: a warning, never a block (arrêté 3308-17 art. 13) */}
      {missingRequiredVaccines(protocol.items).map((r) => (
        <p key={r.disease} className="rounded-xl bg-chick-soft p-2 text-sm text-chick-fg">{t(`required.${r.disease}`, { source: r.source })}</p>
      ))}
      {protocol.items.length === 0 ? (
        <p className="text-sm text-muted">{t("noItems")}</p>
      ) : (
        <Items items={protocol.items} vaccines={vaccines} nameOf={nameOf} onRemove={manage ? (i) => void update(protocol.items.filter((_, j) => j !== i)) : undefined} />
      )}
      {manage &&
        (adding ? (
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
            <div className="flex gap-3">
              <button type="submit" className={primary}>{t("add")}</button>
              <button type="button" onClick={() => setAdding(false)} className={secondary}>{t("cancel")}</button>
            </div>
          </form>
        ) : (
          <button type="button" aria-expanded={false} onClick={() => setAdding(true)} className={`${primary} self-start`}>{t("addItem")}</button>
        ))}
    </div>
  );
}
