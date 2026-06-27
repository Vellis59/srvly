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

// ─── POST /api/agent/install/exec ───
// Default: run commands on the HOST (via SSH).
// With container=true: run inside the container via docker exec.
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const body = await req.json();
    const { installationId, command, workdir, container } = body;
    if (!installationId) return error("installationId required");
    if (!command) return error("command required");

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
    const timeout = Math.min(Number(body.timeout || 30), 120);

    // Build command: host mode (default) or container mode
    let execCmd: string;
    if (container) {
      // Run INSIDE the container (requires running container)
      execCmd = `docker exec ${containerName} sh -c ${JSON.stringify(command)} 2>&1`;
      if (workdir) {
        execCmd = `docker exec -w ${JSON.stringify(workdir)} ${containerName} sh -c ${JSON.stringify(command)} 2>&1`;
      }
    } else {
      // Run on the HOST (always works, even if container is down)
      if (workdir) {
        execCmd = `cd ${JSON.stringify(workdir)} && ${command} 2>&1`;
      } else {
        execCmd = `${command} 2>&1`;
      }
    }

    const result = await executeOnServer(server.id, execCmd, timeout);
    const output = (result.output || "").trim();
    const lines = output ? output.split("\n").length : 0;
    const truncated = output.length > 10000;

    return ok({
      mode: container ? "container" : "host",
      container: container ? containerName : null,
      command,
      exitCode: result.success ? 0 : 1,
      output: output.slice(0, 10000),
      lines,
      truncated,
      error: result.error || null,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
