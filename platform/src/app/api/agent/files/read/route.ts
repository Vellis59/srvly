import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { authUser, error, ok, validateBody } from "@/lib/api-helpers";
import { fileReadSchema } from "@/lib/api-schemas";
import path from "path";

// ─── POST /api/agent/files/read ───
// Read a file on a server and return its content.
// Uses base64 encoding to safely transport binary or text content.

export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const validation = await validateBody(req, fileReadSchema);
    if (!validation.valid) return validation.response;
    const { serverId } = validation.data;
    let filePath = validation.data.path;

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    // Safety: prevent path traversal using POSIX resolution (handles windows vs linux differences)
    const normalizedPath = filePath.replace(/\\/g, "/");
    const resolved = path.posix.resolve("/", normalizedPath);

    // Escape single quotes inside path to prevent shell injection when wrapped in single quotes
    const escapedPath = resolved.replace(/'/g, "'\\''");

    // Check file exists and get base64 content (quoting all paths)
    const script = [
      `set -e`,
      `if [ ! -f '${escapedPath}' ]; then echo "FILE_NOT_FOUND"; exit 1; fi`,
      `echo ">>>SIZE_START"`,
      `stat -c%s '${escapedPath}' 2>/dev/null || echo "0"`,
      `echo ">>>SIZE_END"`,
      `echo ">>>CONTENT_START"`,
      `base64 '${escapedPath}' 2>/dev/null || openssl base64 -in '${escapedPath}' 2>/dev/null || od -A n -t x1 '${escapedPath}' | tr -d ' \\n'`,
      `echo ">>>CONTENT_END"`,
      `echo "READ_OK"`,
    ].join("\n");

    const result = await executeOnServer(serverId, script, 15);
    const output = result.output || "";

    // Parse size
    let size = 0;
    const sizeMatch = output.match(/>>>SIZE_START\n(\d+)>>>SIZE_END/);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1], 10);
    }

    // Parse content
    let content = "";
    const contentMatch = output.match(
      />>>CONTENT_START\n([\s\S]*?)>>>CONTENT_END/,
    );
    if (contentMatch) {
      content = contentMatch[1].trim();
    }

    const found = output.includes("READ_OK");
    if (!found) {
      return error("File not found or inaccessible", 404);
    }

    return ok({
      path: resolved,
      size,
      contentBase64: content,
      text: content
        ? Buffer.from(content, "base64").toString("utf-8").slice(0, 10000)
        : null,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
