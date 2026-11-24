import { describe, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

test("creates and reads an organisation in the reset test database", async () => {
  expect(await db.organization.count()).toBe(0);

  const { id } = await db.organization.create({ data: { name: "Ferme Test" } });

  expect(await db.organization.findUnique({ where: { id } })).toMatchObject({ name: "Ferme Test" });
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7 fallback default
});

describe("errors carry no query values (law 09-08)", () => {
  const phone = "+212600000099";
  const leaks = (e: unknown) => {
    const err = e as Error & { meta?: unknown };
    return [err.message, err.stack, JSON.stringify(err.meta)].filter((s) => s?.includes(phone) || s?.includes("Fatima"));
  };
  const caught = (p: Promise<unknown>) => p.then(() => expect.unreachable(), (e: unknown) => e);

  test("a unique violation keeps its code and constraint, not the phone", async () => {
    await db.user.create({ data: { phoneNumber: phone, name: "Fatima", email: "a@phone.invalid" } });
    const e = await caught(db.$transaction((tx) => tx.user.create({ data: { phoneNumber: phone, name: "Fatima", email: "b@phone.invalid" } })));

    expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(e).toMatchObject({ code: "P2002", message: expect.stringContaining("User_phoneNumber_key") });
    expect(leaks(e)).toEqual([]);
  });

  test("a validation error names the operation, not the arguments", async () => {
    const e = await caught(db.user.create({ data: { phoneNumber: phone, bogus: 1 } as never }));

    expect(e).toBeInstanceOf(Prisma.PrismaClientValidationError);
    expect((e as Error).message).toContain("user.create()");
    expect(leaks(e)).toEqual([]);
  });

  test("a raw query error drops Postgres's message when it quotes a value", async () => {
    const e = await caught(db.$queryRaw`SELECT ${phone}::int`);

    expect(e).toMatchObject({ code: "P2010", message: expect.stringContaining("Postgres 22003") });
    expect(leaks(e)).toEqual([]);
  });
});
