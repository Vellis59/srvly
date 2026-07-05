import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { installations, servers } from "@/server/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { authUser, error, ok, validateBody } from "@/lib/api-helpers";
import { installRegisterSchema, installListSchema } from "@/lib/api-schemas";

// ─── POST /api/agent/install/register ───
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const validation = await validateBody(req, installRegisterSchema);
    if (!validation.valid) return validation.response;
    const { serverId, name, port, domain, image, containerName, notes, recipeId } = validation.data;

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    const targetContainerName = containerName || name.toLowerCase().replace(/[^a-z0-9]/g, "-");

    // Dedup: check if an installation with the same name, containerName, or recipeId already exists on this server (case-insensitive)
    const [existing] = await db
      .select()
      .from(installations)
      .where(
        and(
          eq(installations.serverId, serverId),
          or(
            recipeId && recipeId !== "app" ? eq(installations.recipeId, recipeId) : sql`false`,
            sql`lower(params->>'containerName') = ${targetContainerName.toLowerCase()} OR lower(params->>'name') = ${name.toLowerCase()}`
          )
        ),
      )
      .limit(1);

    let inst;
    if (existing) {
      [inst] = await db
        .update(installations)
        .set({
          recipeId: recipeId || existing.recipeId || "app",
          status: "success",
          params: { name, port, domain, image, containerName, notes },
          result: {},
          logs: "",
          updatedAt: new Date(),
        })
        .where(eq(installations.id, existing.id))
        .returning();
    } else {
      [inst] = await db
        .insert(installations)
        .values({
          serverId,
          recipeId: recipeId || "app",
          status: "success",
          params: { name, port, domain, image, containerName, notes },
          result: {},
          logs: "",
        })
        .returning();
    }

    return ok({ id: inst.id, message: `${name} registered` });
  } catch (err: any) {
    return error(err.message, 500);
  }
}

// ─── GET /api/agent/install?serverId=xxx ───
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
