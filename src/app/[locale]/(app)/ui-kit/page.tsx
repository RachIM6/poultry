import { notFound } from "next/navigation";
import { Suspense } from "react";
import { dataTable, dataTableWrap, empty, num } from "@/components/layout";
import { Page } from "@/components/page";
import { Pager } from "@/components/pager";
import { pageOf, pickTab, TABLE_PAGE } from "@/components/paging";
import { SheetButton } from "@/components/sheet";
import { Tabs } from "@/components/tabs";
import { ClientMessages } from "@/i18n/client-messages";
import { KitForm } from "./kit-form";

// The shared components of tasks/plan-ui-cleanup.md batch 0 on one page, for e2e/ui-kit.spec.ts only: the e2e build
// (STRICT_MESSAGES, playwright.config.ts) serves it, any other build answers 404. Made-up rows, no data, no session.
const TABS = ["one", "two", "three"] as const;
const ROWS = Array.from({ length: 132 }, (_, i) => ({ n: i + 1, amount: `${(i + 1) * 125},00 DH` }));

export default function UiKit({ searchParams }: PageProps<"/[locale]/ui-kit">) {
  if (process.env.STRICT_MESSAGES !== "1") notFound();
  return (
    <Suspense fallback={<Page width="wide" />}>
      <Kit searchParams={searchParams} />
    </Suspense>
  );
}

async function Kit({ searchParams }: Pick<PageProps<"/[locale]/ui-kit">, "searchParams">) {
  const search = await searchParams;
  const tab = pickTab(TABS, search.tab);
  const page = pageOf(search.page, ROWS.length, TABLE_PAGE);
  return (
    <Page
      width="wide"
      title="Composants partagés"
      actions={
        <ClientMessages paths={["Ui"]}>
          <SheetButton label="Ajouter une ligne" title="Nouvelle ligne"><KitForm /></SheetButton>
        </ClientMessages>
      }
      nav={<Tabs label="Onglets" current={tab} tabs={TABS.map((key, i) => ({ key, label: `Onglet ${i + 1}`, count: i === 0 ? ROWS.length : undefined, href: { pathname: "/ui-kit", query: { tab: key } } }))} />}
    >
      {tab === "one" ? (
        <section aria-label={`Onglet 1`} className="flex flex-col gap-3">
          <div className={dataTableWrap}>
            <table className={dataTable}>
              <thead><tr><th>Ligne</th><th className={num}>Montant</th></tr></thead>
              <tbody>{ROWS.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE).map((r) => <tr key={r.n}><td>Ligne {r.n}</td><td className={num}><bdi>{r.amount}</bdi></td></tr>)}</tbody>
            </table>
          </div>
          <Pager page={page} size={TABLE_PAGE} total={ROWS.length} href={(n) => ({ pathname: "/ui-kit", query: { tab, page: n } })} />
        </section>
      ) : (
        <section aria-label={`Onglet ${TABS.indexOf(tab) + 1}`} className={empty}><p>Rien ici pour l’instant.</p></section>
      )}
    </Page>
  );
}
