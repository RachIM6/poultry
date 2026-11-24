import { readdirSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { MAX_JSON_BYTES } from "@/lib/security/body";
import { SCOPE_HEADER } from "@/lib/sync/protocol";
import type { TenantContext } from "@/lib/tenant";
import { requestCode as sendCode, verifyCode as checkCode } from "@/modules/identity";
import { tenant } from "@/test/tenant";
import * as logout from "./auth/logout/route";
import * as requestCode from "./auth/request-code/route";
import * as verifyCode from "./auth/verify-code/route";
import * as captcha from "./captcha/challenge/route";
import * as file from "./files/[id]/route";
import * as files from "./files/route";
import * as batchResults from "./finance/batch-results/route";
import * as financeExport from "./finance/export/route";
import * as locale from "./locale/route";
import * as quietHours from "./notifications/quiet-hours/route";
import * as testPush from "./notifications/test/route";
import * as onboarding from "./onboarding/route";
import * as dispatch from "./push/dispatch/route";
import * as subscribe from "./push/subscribe/route";
import * as reference from "./reference/route";
import * as syncPull from "./sync/pull/route";
import * as syncPush from "./sync/push/route";

// Pushes and postings run after the response with after(): nothing to run here.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => {} }));

// Security matrix of every route handler (poultry-auth §2, §4): a cross-site write is refused before any work, a
// caller without a session gets 401 where one is needed, a body past its cap gets 413 before it is buffered, and
// another organisation's ids are never found. A new route file fails the guard until it has its row here.

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Row = {
  route: Record<string, unknown>;
  session?: true; // every method needs one
  body?: number; // reads a JSON body capped at this many bytes
  cron?: true; // the scheduler's secret, not a browser: refused with 404 instead of 403
};

const ROUTES: Record<string, Row> = {
  "auth/logout": { route: logout }, // no session is fine: already logged out
  "auth/request-code": { route: requestCode, body: MAX_JSON_BYTES },
  "auth/verify-code": { route: verifyCode, body: MAX_JSON_BYTES },
  "captcha/challenge": { route: captcha },
  files: { route: files, session: true },
  "files/[id]": { route: file, session: true },
  "finance/batch-results": { route: batchResults, session: true },
  "finance/export": { route: financeExport, session: true },
  locale: { route: locale, session: true, body: MAX_JSON_BYTES },
  "notifications/quiet-hours": { route: quietHours, session: true, body: MAX_JSON_BYTES },
  "notifications/test": { route: testPush, session: true },
  onboarding: { route: onboarding, session: true, body: MAX_JSON_BYTES },
  "push/dispatch": { route: dispatch, cron: true },
  "push/subscribe": { route: subscribe, session: true, body: MAX_JSON_BYTES },
  reference: { route: reference, session: true },
  "sync/pull": { route: syncPull, session: true },
  "sync/push": { route: syncPush, session: true, body: 2_000_000 },
};

const WRITES = ["POST", "PUT", "PATCH", "DELETE"];
const methodsOf = (row: Row) => Object.keys(row.route).filter((k) => ["GET", ...WRITES].includes(k));
const handler = (row: Row, method: string) => row.route[method] as Handler;
const rows = Object.entries(ROUTES);

const origin = process.env.APP_ORIGIN!;
const noId = "0190a000-0000-7000-8000-000000000099";
const params = { params: Promise.resolve({ id: noId }) };
const sameSite = { origin, "x-requested-with": "poultry", "content-type": "application/json" };
const call = (row: Row, method: string, path: string, headers: Record<string, string>, body?: BodyInit) =>
  handler(row, method)(new Request(`${origin}/api/${path}`, { method, headers, body: method === "GET" ? undefined : (body ?? "{}") }), params);

/** A session cookie for this number (an onboarded owner when `ctx` is given), with its sync scope. */
async function login(phone: string, ctx?: TenantContext) {
  await sendCode(phone, {});
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `phone-number-otp-+212${phone.slice(1)}` }, orderBy: { createdAt: "desc" } })).value.split(":")[0];
  const res = await checkCode(phone, code, "fr", {});
  if (!res.ok) throw new Error(res.error);
  const cookie = res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { cookie, ...(ctx && { [SCOPE_HEADER]: `${ctx.userId}:${ctx.organizationId}` }) };
}

/** Rows any request leaves behind: rate-limit hits, auth events, audit events, sessions. */
const traces = () => Promise.all([db.rateLimitHit.count(), db.authEvent.count(), db.auditEvent.count(), db.session.count(), db.storedFile.count()]);

describe("route handlers' security matrix", () => {
  let a: TenantContext, b: TenantContext;
  let aAuth: Record<string, string>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenant("+212680000001"), tenant("+212680000002")]);
    aAuth = await login("0680000001", a);
  });

  it("has a row for every route file under src/app/api", () => {
    const found = readdirSync("src/app/api", { recursive: true, encoding: "utf8" })
      .filter((f) => /(^|[\\/])route\.ts$/.test(f))
      .map((f) => f.replace(/\\/g, "/").replace(/\/?route\.ts$/, ""))
      .sort();
    expect(found).toEqual(Object.keys(ROUTES).sort());
    for (const [path, row] of rows) expect(methodsOf(row), path).not.toEqual([]);
  });

  it.each(rows.flatMap(([path, row]) => methodsOf(row).filter((m) => WRITES.includes(m)).map((m) => [path, m] as const)))(
    "%s %s: a cross-site write is refused before any work",
    async (path, method) => {
      const row = ROUTES[path];
      const before = await traces();
      for (const headers of <Record<string, string>[]>[
        { origin: "https://evil.example", "x-requested-with": "poultry" }, // another site
        { origin }, // a cross-site form can't set the custom header
        { ...aAuth, origin: "https://evil.example", "x-requested-with": "poultry" }, // even with the victim's cookie
      ]) {
        expect((await call(row, method, path, headers)).status).toBe(row.cron ? 404 : 403);
      }
      expect(await traces()).toEqual(before);
    },
  );

  it.each(rows.filter(([, row]) => row.session).flatMap(([path, row]) => methodsOf(row).map((m) => [path, m] as const)))(
    "%s %s: no session, 401",
    async (path, method) => {
      const res = await call(ROUTES[path], method, path, method === "GET" ? {} : sameSite);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, messageKey: "errors.UNAUTHENTICATED" });
    },
  );

  it.each(rows.filter(([, row]) => row.body).map(([path]) => path))("%s: a body past its cap is refused with 413, unread", async (path) => {
    const row = ROUTES[path];
    const before = await db.authEvent.count();
    const big = JSON.stringify({ phone: "0680000001", pad: "x".repeat(row.body!) });
    const res = await call(row, "POST", path, { ...sameSite, ...aAuth }, big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, messageKey: "errors.TOO_LARGE" });
    expect(await db.authEvent.count()).toBe(before); // the login routes stopped before the limits and the audit
    // Just under the cap is read as usual (refused as invalid by the route, not as too large).
    const small = JSON.stringify({ pad: "x".repeat(row.body! - 64) });
    expect((await call(row, "POST", path, { ...sameSite, ...aAuth }, small)).status).not.toBe(413);
  });

  it("files: another organisation's record or file is never found, and the refused upload keeps no bytes", async () => {
    const docOfB = uuidv7();
    await db.document.create({ data: { id: docOfB, organizationId: b.organizationId, title: "Bail", category: "lease", createdBy: b.userId } });
    const pdf = new TextEncoder().encode("%PDF-1.7\n…");
    const upload = (query: string) => call(ROUTES.files, "POST", `files?${query}`, { ...sameSite, ...aAuth, "content-type": "application/pdf" }, pdf);

    const before = await db.storedFile.count();
    const refused = await upload(`purpose=document&document=${docOfB}`);
    expect(refused.status).toBe(404);
    expect(await db.storedFile.count()).toBe(before);
    expect((await db.document.findUniqueOrThrow({ where: { id: docOfB } })).fileId).toBeNull();

    const docOfA = uuidv7();
    await db.document.create({ data: { id: docOfA, organizationId: a.organizationId, title: "Assurance", category: "insurance", createdBy: a.userId } });
    const first = await upload(`purpose=document&document=${docOfA}`);
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    expect((await upload(`purpose=document&document=${docOfA}`)).status).toBe(409); // already has its file
    expect(await db.storedFile.count()).toBe(before + 1);

    const bAuth = await login("0680000002", b);
    const read = (auth: Record<string, string>) => handler(ROUTES["files/[id]"], "GET")(new Request(`${origin}/api/files/${id}`, { headers: auth }), { params: Promise.resolve({ id }) });
    expect((await read(aAuth)).status).toBe(200);
    expect((await read(bAuth)).status).toBe(404);
  });

  it("sync/push: another organisation's record is not found, per mutation", async () => {
    const farmOfB = uuidv7();
    await db.farm.create({ data: { id: farmOfB, organizationId: b.organizationId, name: "Ferme B", region: "R", province: "P", commune: "C" } });
    const mutation = { id: uuidv7(), type: "farm-registry.updateFarm", payload: { id: farmOfB, changes: { name: "Volée" } }, createdAt: "2026-11-24T08:00:00Z" };
    const res = await call(ROUTES["sync/push"], "POST", "sync/push", { ...sameSite, ...aAuth }, JSON.stringify({ mutations: [mutation] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ id: mutation.id, status: "rejected", messageKey: "errors.NOT_FOUND" }] });
    expect((await db.farm.findUniqueOrThrow({ where: { id: farmOfB } })).name).toBe("Ferme B");
  });

  it("onboarding: 201 the first time, 409 ALREADY_ONBOARDED after, 400 on bad input", async () => {
    const auth = await login("0680000003"); // signed in, no organisation yet
    const onboard = (body: unknown) => call(ROUTES.onboarding, "POST", "onboarding", { ...sameSite, ...auth }, JSON.stringify(body));
    for (const bad of [null, {}, { name: " ", form: "company", locale: "fr" }, { name: "Ferme", form: "sarl", locale: "fr" }, { name: "Ferme", form: "company", locale: "en" }]) {
      const res = await onboard(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ ok: false, messageKey: "errors.INVALID_INPUT" });
    }
    expect((await onboard({ name: "Ferme Atlas", form: "individual", locale: "fr" })).status).toBe(201);
    const again = await onboard({ name: "Ferme Atlas 2", form: "individual", locale: "fr" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, messageKey: "errors.ALREADY_ONBOARDED" });
    const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212680000003" } });
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(1);
  });
});
