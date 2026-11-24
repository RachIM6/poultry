import { connection } from "next/server";
import { db } from "@/lib/db";

// For the host's uptime check and load balancer: is the app up and its database reachable? No auth, no details.
// connection(): answered per request, never prerendered at build time.
export async function GET() {
  await connection();
  const up = await db.$queryRaw`SELECT 1`.then(
    () => true,
    () => false,
  );
  return Response.json({ status: up ? "ok" : "unavailable" }, { status: up ? 200 : 503, headers: { "cache-control": "no-store" } });
}
