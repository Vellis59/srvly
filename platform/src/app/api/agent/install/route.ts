import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { installations, servers, domains } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";

/** Helper: verify Bearer token and return userId */
async function authUser(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const { users } = await import("@/server/db/schema");
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.apiToken, token))
    .limit(1);
  return user || null;
}

function error(msg: string, status = 400) {
  return NextResponse.json({ success: false, error: msg }, { status });
}

function ok(data: any) {
  return NextResponse.json({ success: true, ...data });
}

// ─── POST /api/agent/install/register ───
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Token invalide", 401);

    const body = await req.json();
    const { serverId, name, port, domain, image, containerName, notes } = body;
    if (!serverId || !name) return error("serverId et name requis");

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    const [inst] = await db
      .insert(installations)
      .values({
        serverId,
        recipeId: "app",
        status: "success",
        params: { name, port, domain, image, containerName, notes },
        result: {},
        logs: "",
      })
      .returning();

    return ok({ id: inst.id, message: `${name} enregistree` });
  } catch (err: any) {
    return error(err.message, 500);
  }
}

// ─── GET /api/agent/install/list?serverId=xxx ───
export async function GET(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Token invalide", 401);

    const serverId = req.nextUrl.searchParams.get("serverId");
    if (!serverId) return error("serverId requis");

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    const apps = await db
      .select()
      .from(installations)
      .where(eq(installations.serverId, serverId))
      .orderBy(installations.createdAt);

    return ok({ apps });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
