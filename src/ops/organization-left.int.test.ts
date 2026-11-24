import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as upload } from "@/app/api/files/route";
import { GET as pull } from "@/app/api/sync/pull/route";
import { POST as push } from "@/app/api/sync/push/route";
import { invite } from "@/app/[locale]/(app)/settings/members/actions";
import { db } from "@/lib/db";
import { SCOPE_HEADER } from "@/lib/sync/protocol";
import type { TenantContext } from "@/lib/tenant";
import { getTenantContext, listMembers, requestCode, verifyCode } from "@/modules/identity";
import { markOrganizationLeft } from "@/ops/organization-data";
import { tenant } from "@/test/tenant";

// A server action reads the request's headers and refreshes the page: here, the headers of the member under test.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => {} }));

// docs/data-requests.md: from `pnpm org:left` until deletion or `--undo`, an organisation is read-only.
const origin = process.env.APP_ORIGIN!;

async function signedIn(phone: string) {
  const ctx = await tenant(`+212${phone.slice(1)}`);
  await requestCode(phone, {});
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `phone-number-otp-+212${phone.slice(1)}` } })).value.split(":")[0];
  const res = await verifyCode(phone, code, "fr", {});
  if (!res.ok) throw new Error(res.error);
  const cookie = res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const farm = uuidv7();
  await db.farm.create({ data: { id: farm, organizationId: ctx.organizationId, name: "Ferme", region: "Souss-Massa", province: "Agadir", commune: "Drarga" } });
  return { ctx, farm, headers: { cookie, [SCOPE_HEADER]: `${ctx.userId}:${ctx.organizationId}` } };
}

type Member = Awaited<ReturnType<typeof signedIn>>;
const rename = async ({ farm, headers }: Member, name: string) => {
  const m = { id: uuidv7(), type: "farm-registry.updateFarm", payload: { id: farm, changes: { name } }, createdAt: new Date().toISOString() };
  const res = await push(new Request(`${origin}/api/sync/push`, { method: "POST", body: JSON.stringify({ mutations: [m] }), headers: { origin, "x-requested-with": "poultry", ...headers } }));
  return ((await res.json()) as { results: { status: string; messageKey?: string }[] }).results[0];
};
const inviteAs = async ({ headers }: Member, phone: string) => {
  request.headers = new Headers(headers);
  const form = new FormData();
  form.set("phone", phone);
  form.set("role", "worker");
  return invite({}, form);
};

describe("a left organisation is read-only (docs/data-requests.md)", () => {
  let a: Member, b: Member;
  beforeAll(async () => {
    [a, b] = [await signedIn("0650000001"), await signedIn("0650000002")];
    await markOrganizationLeft(a.ctx.organizationId, new Date());
  });

  it("refuses sync pushes, server actions and uploads with ORGANIZATION_LEFT", async () => {
    expect(await rename(a, "Après départ")).toMatchObject({ status: "rejected", messageKey: "errors.ORGANIZATION_LEFT" });
    expect(await inviteAs(a, "0650000009")).toEqual({ messageKey: "errors.ORGANIZATION_LEFT" });
    const res = await upload(new Request(`${origin}/api/files?purpose=proof&rodentCheck=${uuidv7()}`, { method: "POST", body: "x", headers: { origin, "x-requested-with": "poultry", ...a.headers } }));
    expect([res.status, await res.json()]).toEqual([403, { ok: false, messageKey: "errors.ORGANIZATION_LEFT" }]);

    expect(await db.farm.findUniqueOrThrow({ where: { id: a.farm } })).toMatchObject({ name: "Ferme" });
    expect(await db.invitation.count({ where: { organizationId: a.ctx.organizationId } })).toBe(0);
  });

  it("keeps sign-in and reads working", async () => {
    const ctx = await getTenantContext(new Headers(a.headers));
    expect(ctx).toMatchObject({ ok: true, value: { organizationId: a.ctx.organizationId, role: "owner", leftAt: expect.any(String) } });
    expect((await listMembers((ctx as { value: TenantContext }).value)).ok).toBe(true); // a read gated by an owner's permission
    const res = await pull(new Request(`${origin}/api/sync/pull?since=0`, { headers: a.headers }));
    expect(res.status).toBe(200);
  });

  it("leaves other organisations writable", async () => {
    expect(await rename(b, "Ferme B")).toMatchObject({ status: "applied" });
    expect(await inviteAs(b, "0650000008")).toEqual({ ok: true });
  });

  it("lifts the lock when the departure is undone", async () => {
    await markOrganizationLeft(a.ctx.organizationId, null);
    const back = await getTenantContext(new Headers(a.headers));
    expect(back.ok && back.value.leftAt).toBeUndefined();
    expect(await rename(a, "De retour")).toMatchObject({ status: "applied" });
    expect(await inviteAs(a, "0650000009")).toEqual({ ok: true });
    expect(await db.farm.findUniqueOrThrow({ where: { id: a.farm } })).toMatchObject({ name: "De retour" });
  });
});
