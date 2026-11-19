import { exportBooks } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

const STATUS = { FORBIDDEN: 403, INVALID_INPUT: 400, NOT_FOUND: 404 } as const;

// SPEC-finance FN18: GET ?month=YYYY-MM downloads the month's books as a .zip. A read: no CSRF check (SameSite=Lax
// session cookie, and a cross-site page can't read the response).
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const result = await exportBooks(ctx.value, new URL(req.url).searchParams.get("month") ?? "");
  if (!result.ok) return Response.json({ ok: false, messageKey: `errors.${result.error}` }, { status: STATUS[result.error] });
  return new Response(new Uint8Array(result.value.zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${result.value.file}"`, "Cache-Control": "no-store" },
  });
}
