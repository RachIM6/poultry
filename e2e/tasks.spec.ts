import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, ownerWithFarm, query, referenceCached, scopeRemembered } from "./auth";

// T72 (SPEC-m4 WF4, WF5): the day's tasks computed on the phone, and a routine and a one-off task added offline.
test("a routine and a one-off task added offline join today's tasks, survive a reload and sync once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Tâches");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/dashboard");
  await referenceCached(page);

  await page.getByRole("link", { name: "Plus", exact: true }).click();
  await page.getByRole("link", { name: "Tâches du jour" }).click();
  await controlled(page);
  const today = page.getByRole("list", { name: "Tâches d’aujourd’hui" }).getByRole("listitem");
  await expect(today).toHaveText([/Saisie du jour · Bâtiment 1\s*J0/]); // the batch placed today

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Ajouter une tâche régulière" }).click();
  const routine = page.getByRole("form", { name: "Ajouter une tâche régulière" });
  await routine.getByLabel("Tâche").fill("Contrôle des abreuvoirs");
  await routine.getByLabel("Bâtiment", { exact: true }).selectOption({ label: "Bâtiment 1" });
  await routine.getByLabel("Heure (facultatif)").fill("07:30");
  await routine.getByRole("button", { name: "Enregistrer la tâche régulière" }).click();

  // exact: "Ajouter une tâche régulière" contains it, and that form may still be closing
  await page.getByRole("button", { name: "Ajouter une tâche", exact: true }).click(); // the form opens in a sheet
  const oneOff = page.getByRole("form", { name: "Ajouter une tâche", exact: true });
  await oneOff.getByLabel("Tâche").fill("Recevoir le camion d’aliment");
  await oneOff.getByLabel("Heure (facultatif)").fill("09:00");
  await oneOff.getByRole("button", { name: "Ajouter la tâche" }).click();

  const expected = [/Saisie du jour · Bâtiment 1/, /07:30\s*Contrôle des abreuvoirs · Bâtiment 1\s*tous les jours · J0/, /09:00\s*Recevoir le camion d’aliment · Toute la ferme\s*ajoutée par le responsable/];
  await expect(today).toHaveText(expected);
  await expect(page.getByRole("list", { name: "Tâches régulières" }).getByRole("listitem")).toHaveText([/07:30 · Contrôle des abreuvoirs · Bâtiment 1\s*tous les jours · à partir du/]);
  // The start day in words, not 2026-11-23.
  const startOn = new Intl.DateTimeFormat("fr", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${farmDaysAgo(0)}T00:00:00Z`));
  await expect(page.getByRole("list", { name: "Tâches régulières" }).getByRole("listitem")).toContainText(`à partir du ${startOn}`);

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(today).toHaveText(expected);

  await context.unroute("**");
  await context.setOffline(false);
  const server = () =>
    query<{ routines: number; tasks: number }>(
      `SELECT (SELECT count(*)::int FROM "Routine" r WHERE r."organizationId" = m."organizationId") AS routines,
              (SELECT count(*)::int FROM "OneOffTask" o WHERE o."organizationId" = m."organizationId") AS tasks
       FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ routines: 1, tasks: 1 }]);
});
