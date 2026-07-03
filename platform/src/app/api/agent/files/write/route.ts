import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { authUser, error, ok, validateBody } from "@/lib/api-helpers";
import { fileWriteSchema } from "@/lib/api-schemas";
import path from "path";

// ─── POST /api/agent/files/write ───
// Write a file on a server using heredoc (safe from shell injection).
// The agent no longer needs to escape shell characters.

export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const validation = await validateBody(req, fileWriteSchema);
    if (!validation.valid) return validation.response;
    const { serverId, content, mode } = validation.data;
    let filePath = validation.data.path;

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    // Safety: prevent path traversal and dangerous paths
    const resolved = path.resolve("/", filePath).replace(/\\/g, "/");
    // Remove leading slash for the path on the server
    const safePath = resolved.replace(/^\/+/, "");

    // Block dangerous paths
    const blockedPrefixes = [
      "etc/shadow", "etc/sudoers", "etc/ssh/",
      "root/.ssh/authorized_keys", ".ssh/authorized_keys",
      "boot/", "dev/", "proc/", "sys/",
    ];
    for (const prefix of blockedPrefixes) {
      if (safePath.startsWith(prefix) || safePath.includes("/" + prefix)) {
        return error(`Path not allowed: /${safePath}`, 403);
      }
    }

    // Ensure directory exists, then write file via heredoc
    const dirPath = safePath.substring(0, safePath.lastIndexOf("/"));
    const script = [
      `set -e`,
      `mkdir -p /${dirPath}`,
      `cat > /${safePath} << 'SRVLY_EOF'`,
      content,
      `SRVLY_EOF`,
    ];

    if (mode) {
      script.push(`chmod ${mode} /${safePath}`);
    }

    script.push(`echo "WRITE_OK"`);

    const result = await executeOnServer(serverId, script.join("\n"), 15);
    const success = (result.output || "").includes("WRITE_OK");

    return ok({
      path: `/${safePath}`,
      size: content.length,
      mode: mode || "unchanged",
      status: success ? "written" : "failed",
      error: success ? null : (result.error || result.output?.slice(-200)),
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
