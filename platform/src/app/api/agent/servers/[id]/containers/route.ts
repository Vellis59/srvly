import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { authUser, error, ok } from "@/lib/api-helpers";

// ─── GET /api/agent/servers/[id]/containers ───
// Returns structured JSON list of running Docker containers.

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const serverId = params.id;
    if (!serverId) return error("serverId required");

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    // Get all containers with structured JSON output
    const script = [
      `echo ">>>CONTAINERS_START"`,
      `docker ps -a --format '{{json .}}' 2>/dev/null || echo '[]'`,
      `echo ">>>CONTAINERS_END"`,
      ``,
      `echo ">>>DISK_START"`,
      `df -h / | tail -1 | awk '{print "{\\"total\\":\\""$2"\\",\\"used\\":\\""$3"\\",\\"avail\\":\\""$4"\\",\\"pct\\":\\""$5"\\"}"}' 2>/dev/null || echo '{}'`,
      `echo ">>>DISK_END"`,
      ``,
      `echo ">>>MEM_START"`,
      `free -m | awk '/Mem:/{print "{\\"total\\":\\""$2"\\",\\"used\\":\\""$3"\\",\\"free\\":\\""$4"\\"}"}' 2>/dev/null || echo '{}'`,
      `echo ">>>MEM_END"`,
    ].join("\n");

    const result = await executeOnServer(serverId, script, 15);
    const output = result.output || "";

    // Parse structured sections
    const containers: any[] = [];
    const containersMatch = output.match(
      />>>CONTAINERS_START\n([\s\S]*?)>>>CONTAINERS_END/,
    );
    if (containersMatch) {
      const raw = containersMatch[1].trim();
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "[]") continue;
        try {
          const c = JSON.parse(trimmed);
          containers.push({
            id: c.ID?.slice(0, 12) || "",
            name: c.Names?.replace(/^\//, "") || "",
            image: c.Image || "",
            status: c.Status || "",
            state: c.State || "",
            created: c.CreatedAt || "",
            ports: c.Ports || "",
            // Remap docker names to shorter keys
            hostPorts: (c.Ports || "")
              .split(", ")
              .filter(Boolean)
              .map((p: string) => p.trim()),
          });
        } catch {
          // Skip unparseable lines
        }
      }
    }

    // Parse disk info
    let disk = null;
    const diskMatch = output.match(
      />>>DISK_START\n([\s\S]*?)>>>DISK_END/,
    );
    if (diskMatch) {
      try {
        disk = JSON.parse(diskMatch[1].trim());
      } catch {}
    }

    // Parse memory info
    let memory = null;
    const memMatch = output.match(
      />>>MEM_START\n([\s\S]*?)>>>MEM_END/,
    );
    if (memMatch) {
      try {
        memory = JSON.parse(memMatch[1].trim());
      } catch {}
    }

    return ok({
      serverId,
      serverName: server.name,
      containers,
      totalContainers: containers.length,
      disk,
      memory,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
