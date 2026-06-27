import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { installations, servers } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";

async function authUser(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const { users } = await import("@/server/db/schema");
  const [user] = await db.select().from(users).where(eq(users.apiToken, token)).limit(1);
  return user || null;
}

function error(msg: string, status = 400) {
  return NextResponse.json({ success: false, error: msg }, { status });
}
function ok(data: any) {
  return NextResponse.json({ success: true, ...data });
}

// ─── POST /api/agent/install/logs ───
// Fetch Docker container logs for debugging.
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const body = await req.json();
    const { installationId, tail = 50 } = body;
    if (!installationId) return error("installationId required");

    const [inst] = await db
      .select()
      .from(installations)
      .where(eq(installations.id, installationId));
    if (!inst) return error("Installation not found", 404);

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, inst.serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    const containerName = (inst.params as any)?.containerName || installationId;
    const lines = Math.min(Math.max(10, Number(tail)), 500);

    // 1. Container status
    const statusScript = `docker inspect ${containerName} --format '{{.State.Status}} {{.State.Running}}' 2>&1 || echo "NOT_FOUND"`;
    const statusResult = await executeOnServer(server.id, statusScript, 10);

    // 2. Container logs
    const logsScript = `docker logs --tail ${lines} ${containerName} 2>&1 || echo "NO_LOGS"`;
    const logsResult = await executeOnServer(server.id, logsScript, 15);

    return ok({
      container: containerName,
      status: statusResult.output?.trim() || "unknown",
      logs: logsResult.output?.trim() || "",
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
