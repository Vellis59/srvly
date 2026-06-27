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

// ─── POST /api/agent/proxy/configure ───
// Configure Caddy reverse proxy for an existing app.
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const body = await req.json();
    const { installationId, domain, port } = body;
    if (!installationId) return error("installationId required");

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

    const appDomain = domain || (inst.params as any)?.domain;
    const appPort = port || (inst.params as any)?.port || "3000";
    if (!appDomain) return error("No domain configured for this app");

    // Build the Caddy config script
    const script = `
echo ">>> Configuring Caddy for ${appDomain} → :${appPort}"
CFG=/opt/srvly/infra/Caddyfile
[ ! -f "$CFG" ] && CFG=/etc/caddy/Caddyfile
if grep -q "^${appDomain} {" "$CFG" 2>/dev/null; then
  echo "[SKIP] ${appDomain} already in Caddyfile"
else
  echo "[ADD] ${appDomain} → :${appPort}"
  printf '\\n${appDomain} {\\n    reverse_proxy 127.0.0.1:${appPort}\\n}\\n' >> "$CFG"
fi
if docker ps -q --filter name=caddy 2>/dev/null | grep -q .; then
  docker compose -f /opt/srvly/infra/docker-compose.yml restart caddy 2>&1 || docker exec $(docker ps -q --filter name=caddy) caddy reload --config /etc/caddy/Caddyfile 2>&1
else
  caddy reload --config "$CFG" 2>&1 || systemctl reload caddy 2>&1 || true
fi
echo ">>> DONE"
`.trim();

    const result = await executeOnServer(server.id, script, 30);
    const success = result.success && (result.output || "").includes("DONE");

    return ok({
      domain: appDomain,
      port: appPort,
      status: success ? "configured" : "failed",
      output: result.output?.slice(0, 1000),
      error: result.error,
      message: success
        ? `Caddy configured for ${appDomain} → :${appPort}`
        : "Configuration failed",
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
