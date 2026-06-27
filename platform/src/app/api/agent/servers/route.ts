import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { authUser, error, ok } from "@/lib/api-helpers";

// ─── GET /api/agent/servers ───
// Returns all servers accessible to this token.
// The agent can call this to discover server IDs automatically.
export async function GET(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const list = await db
      .select({
        id: servers.id,
        name: servers.name,
        ip: servers.ip,
        os: servers.os,
        ram: servers.ram,
        status: servers.status,
        systemInfo: servers.systemInfo,
        createdAt: servers.createdAt,
      })
      .from(servers)
      .where(eq(servers.userId, user.id))
      .orderBy(servers.createdAt);

    return ok({ servers: list, total: list.length });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
