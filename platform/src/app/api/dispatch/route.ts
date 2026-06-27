import { NextRequest } from "next/server";
import { executeRaw, executeOnServer } from "@/lib/ssh";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { authUser, error, ok, validateBody } from "@/lib/api-helpers";
import { dispatchSchema } from "@/lib/api-schemas";
import { decryptKey } from "@/lib/crypto";

/**
 * POST /api/dispatch
 * Executes a command on a server via SSH.
 * Requires Bearer token auth.
 * Body: { serverId?, script, timeout? }
 */
export async function POST(req: NextRequest) {
  try {
    // Require Bearer token auth
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const validation = await validateBody(req, dispatchSchema);
    if (!validation.valid) return validation.response;
    const { serverId, script, timeout } = validation.data;

    // Find server: by ID (must belong to user) or first of the user
    let targetServer: any;

    if (serverId) {
      const [srv] = await db
        .select()
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)))
        .limit(1);
      targetServer = srv;
    } else {
      // Fallback: first server of the authenticated user that's connected
      const [srv] = await db
        .select()
        .from(servers)
        .where(and(eq(servers.userId, user.id), eq(servers.status, "connected")))
        .limit(1);
      targetServer = srv;
    }

    if (!targetServer || !targetServer.sshPrivateKey || !targetServer.ip) {
      return error("No connected server with SSH key available", 404);
    }
    const decryptedPrivateKey = decryptKey(targetServer.sshPrivateKey);

    const result = await executeRaw(
      targetServer.ip,
      decryptedPrivateKey,
      script,
      timeout,
    );

    return ok({
      serverId: targetServer.id,
      serverName: targetServer.name,
      success: result.success,
      output: result.output?.slice(0, 50000),
      error: result.error,
    });
  } catch (err: any) {
    return error(err.message || "dispatch error", 500);
  }
}
