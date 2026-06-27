import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { installations, servers } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { authUser, error, ok, validateBody } from "@/lib/api-helpers";
import { installRegisterSchema, installListSchema } from "@/lib/api-schemas";

// ─── POST /api/agent/install/register ───
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const validation = await validateBody(req, installRegisterSchema);
    if (!validation.valid) return validation.response;
    const { serverId, name, port, domain, image, containerName, notes } = validation.data;

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

    return ok({ id: inst.id, message: `${name} registered` });
  } catch (err: any) {
    return error(err.message, 500);
  }
}

// ─── GET /api/agent/install/list?serverId=xxx ───
export async function GET(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const serverId = req.nextUrl.searchParams.get("serverId");
    if (!serverId) return error("serverId required");

    // Validate UUID format
    const parseResult = installListSchema.safeParse({ serverId });
    if (!parseResult.success) return error("Invalid serverId format", 422);

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
