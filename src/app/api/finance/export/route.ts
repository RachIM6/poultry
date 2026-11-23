import { exportBooks, exportFec } from "@/modules/finance";
import { getTenantContext, limitSignedIn } from "@/modules/identity";

const STATUS = { FORBIDDEN: 403, INVALID_INPUT: 400, NOT_FOUND: 404 } as const;

// SPEC-finance FN18: GET ?month=YYYY-MM downloads the month's books as a .zip; FC10: with &format=fec, the month's
// FEC (.txt) for the accountant's software. A read: no CSRF check (SameSite=Lax session cookie, and a cross-site page
// can't read the response).
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const retry = await limitSignedIn("financeExport", req.headers, ctx.value.userId);
  if (retry) return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": String(retry) } });
  const params = new URL(req.url).searchParams;
  const month = params.get("month") ?? "";
  const result = params.get("format") === "fec" ? await exportFec(ctx.value, month) : await exportBooks(ctx.value, month);
  if (!result.ok) return Response.json({ ok: false, messageKey: `errors.${result.error}` }, { status: STATUS[result.error] });
  const [data, type] = "zip" in result.value ? [result.value.zip, "application/zip"] : [result.value.data, "text/plain; charset=utf-8"];
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${result.value.file}"`, "Cache-Control": "no-store" },
  });
}
