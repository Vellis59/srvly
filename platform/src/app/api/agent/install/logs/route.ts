import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { installations, servers } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { authUser, error, ok, validateBody } from "@/lib/api-helpers";
import { installLogsSchema } from "@/lib/api-schemas";

// ─── POST /api/agent/install/logs ───
// Fetch Docker container logs for debugging.
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const validation = await validateBody(req, installLogsSchema);
    if (!validation.valid) return validation.response;
    const { installationId, tail } = validation.data;

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

    // 1. Container status
    const statusScript = `docker inspect ${containerName} --format '{{.State.Status}} {{.State.Running}}' 2>&1 || echo "NOT_FOUND"`;
    const statusResult = await executeOnServer(server.id, statusScript, 10);

    // 2. Container logs
    const logsScript = `docker logs --tail ${tail} ${containerName} 2>&1 || echo "NO_LOGS"`;
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
