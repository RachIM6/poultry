import { db } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { limitSignedIn } from "@/modules/identity/application/limits";
import { clientOf } from "@/modules/identity/application/login";
import { getSession } from "@/modules/identity/application/session";
import { PhoneNumber } from "@/modules/identity/domain/phone-number";
import { recordAuthEvent } from "@/modules/identity/infrastructure/auth-events";
import { Names } from "@/modules/identity/schema";

/** The user's display name (« Prénom Nom », or the phone or email of an account made before names) and its parts. */
export const profileOf = (userId: string) => db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, firstName: true, lastName: true } });

/** A signed-in user sets their own first and last name (an account made before names had none). Audited as an auth event. */
export async function saveName(headers: Headers, raw: unknown): Promise<Result<void, "UNAUTHENTICATED" | "TOO_MANY_REQUESTS" | "INVALID_NAME">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  if (await limitSignedIn("authenticated", headers, session.userId)) return fail("TOO_MANY_REQUESTS");
  const names = Names.safeParse(raw);
  if (!names.success) return fail("INVALID_NAME");
  await db.user.update({ where: { id: session.userId }, data: names.data });
  const phone = PhoneNumber.create(session.phone ?? "");
  await recordAuthEvent("name_changed", clientOf(headers), { userId: session.userId, phone: phone.ok ? phone.value.masked : undefined });
  return ok(undefined);
}
