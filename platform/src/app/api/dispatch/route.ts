import { NextRequest, NextResponse } from "next/server";
import { executeRaw } from "@/lib/ssh";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";

/**
 * POST /api/dispatch
 * Executes a command on a server via SSH.
 * Body must contain: { server_id, script, timeout? }
 */
export async function POST(req: NextRequest) {
  // Auth check (optional for now — falls back to first server matching the IP)
  try {
    const body = await req.json();

    const serverId = body.server_id || body.serverId;
    const script = body.script || body.command;
    const timeout = (body.timeout || 60) as number;

    if (!script) {
      return NextResponse.json(
        { success: false, error: "'script' parameter is required" },
        { status: 400 }
      );
    }

    // Find server by ID or by session user's first connected server
    let targetServer: any;

    if (serverId && serverId !== "unknown") {
      const [srv] = await db
        .select()
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);
      targetServer = srv;
    }

    if (!targetServer) {
      // Fallback: use the first server with an SSH key
      const [srv] = await db
        .select()
        .from(servers)
        .where(eq(servers.status, "connected"))
        .limit(1);
      targetServer = srv;
    }

    if (!targetServer || !targetServer.sshPrivateKey || !targetServer.ip) {
      return NextResponse.json(
        { success: false, error: "No connected server with SSH key available" },
        { status: 404 }
      );
    }

    const result = await executeRaw(
      targetServer.ip,
      targetServer.sshPrivateKey,
      script,
      timeout
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "dispatch error" },
      { status: 500 }
    );
  }
}
