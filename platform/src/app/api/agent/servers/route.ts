import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq } from "drizzle-orm";

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
