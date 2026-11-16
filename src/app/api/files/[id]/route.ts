import { z } from "zod";
import { readFile } from "@/modules/documents";
import { getTenantContext } from "@/modules/identity";

// SPEC-m2-compliance DC2, D4: a stored file, for the caller's organisation and role only. Always a download
// (attachment + nosniff), never rendered in the app's origin. A read: no CSRF check, like the books export.
export async function GET(req: Request, { params }: RouteContext<"/api/files/[id]">) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const notFound = () => Response.json({ ok: false, messageKey: "errors.NOT_FOUND" }, { status: 404 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return notFound();
  const file = await readFile(ctx.value, id.data);
  if (!file.ok) return notFound();
  const extension = file.value.contentType.split("/")[1];
  return new Response(new Uint8Array(file.value.bytes), {
    headers: {
      "Content-Type": file.value.contentType,
      "Content-Disposition": `attachment; filename="${id.data}.${extension}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
