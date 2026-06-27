import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { installations, servers, domains } from "@/server/db/schema";
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

// ─── POST /api/agent/docker/deploy ────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const body = await req.json();
    const { serverId, name, image, port, domain, env, volumes } = body;
    if (!serverId || !name) return error("serverId and name required");

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    const appPort = port || 3000;
    const containerName = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const imageName = image || name.toLowerCase();
    const appDir = "/opt/srvly/" + containerName;

    // Build install script
    const s = [
      "set -e",
      `echo ">>> PULL"`,
      `docker pull ${imageName} 2>&1`,
      "",
      `echo ">>> CLEAN"`,
      `docker rm -f ${containerName} 2>/dev/null || true`,
      `mkdir -p ${appDir}`,
      "",
      `echo ">>> RUN"`,
    ];

    let runCmd = `docker run -d --name ${containerName} --restart unless-stopped -p ${appPort}:${appPort}`;
    if (env && typeof env === "object") {
      for (const [k, v] of Object.entries(env)) {
        runCmd += ` -e ${k}='${String(v)}'`;
      }
    }
    if (volumes && Array.isArray(volumes)) {
      for (const vol of volumes) {
        const parts = vol.split(":");
        const hostPath = parts[0].startsWith("/") ? parts[0] : `${appDir}/${parts[0]}`;
        runCmd += ` -v ${hostPath}:${parts[1]}`;
      }
    }
    runCmd += ` ${imageName} 2>&1`;
    s.push(runCmd);
    s.push("", `echo ">>> WAIT"`, "sleep 3", "", `echo ">>> CHECK"`);
    s.push("for i in 1 2 3 4 5; do");
    s.push(`  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${appPort} 2>/dev/null || echo '000')`);
    s.push('  echo "  Attempt $i: HTTP $CODE"');
    s.push('  [ "$CODE" != "000" ] && echo "READY" && break');
    s.push("  sleep 3");
    s.push("done");

    // ── Reverse proxy (Caddy or nginx) with dedup ──
    if (domain) {
      s.push("", `echo ">>> REVERSE PROXY"`);
      s.push('echo "Detecting..."');

      // Caddy branch
      s.push('if command -v caddy &>/dev/null; then');
      s.push('  echo "Using Caddy"');
      s.push('  CFG=/opt/srvly/infra/Caddyfile');
      s.push('  [ ! -f "$CFG" ] && CFG=/etc/caddy/Caddyfile');
      s.push(`  if grep -q "^${domain} {" "$CFG" 2>/dev/null; then`);
      s.push(`    echo "[SKIP] ${domain} already in Caddyfile"`);
      s.push('  else');
      s.push(`    echo "[ADD] ${domain} → :${appPort}"`);
      s.push(`    printf '\\n${domain} {\\n    reverse_proxy 127.0.0.1:${appPort}\\n}\\n' >> "$CFG"`);
      s.push('  fi');
      s.push('  # Reload');
      s.push('  if docker ps -q --filter name=caddy 2>/dev/null | grep -q .; then');
      s.push('    docker compose -f /opt/srvly/infra/docker-compose.yml restart caddy 2>&1 || docker exec $(docker ps -q --filter name=caddy) caddy reload --config /etc/caddy/Caddyfile 2>&1');
      s.push('  else');
      s.push('    caddy reload --config "$CFG" 2>&1 || systemctl reload caddy 2>&1 || true');
      s.push('  fi');
      s.push('  echo "CADDY_OK"');

      // nginx branch
      s.push('elif command -v nginx &>/dev/null; then');
      s.push('  echo "Using nginx"');
      s.push(`  if [ -f /etc/nginx/sites-enabled/${domain}.conf ]; then`);
      s.push(`    echo "[SKIP] ${domain} nginx config already exists"`);
      s.push('  else');
      s.push(`    cat > /etc/nginx/sites-enabled/${domain}.conf << 'NGINX'`);
      s.push("server {");
      s.push("    listen 80;");
      s.push(`    server_name ${domain};`);
      s.push("    location / {");
      s.push(`        proxy_pass http://127.0.0.1:${appPort};`);
      s.push('        proxy_set_header Host $host;');
      s.push('        proxy_set_header X-Real-IP $remote_addr;');
      s.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
      s.push('        proxy_set_header X-Forwarded-Proto $scheme;');
      s.push("    }");
      s.push("}");
      s.push("NGINX");
      s.push("    nginx -t && systemctl reload nginx");
      s.push('  fi');
      s.push('  echo "NGINX_OK"');

      // No proxy
      s.push('else');
      s.push(`  echo "WARNING: No reverse proxy found. Domain ${domain} unreachable."`);
      s.push('  echo "Install Caddy (recommended) or nginx."');
      s.push('fi');
    }

    const script = s.join("\n");
    const result = await executeOnServer(serverId, script, 180);
    const success = result.success && (result.output || "").includes("READY");

    const [inst] = await db
      .insert(installations)
      .values({
        serverId,
        recipeId: "app",
        status: success ? "success" : "failed",
        params: { name, port: appPort, domain, image: imageName, containerName },
        result: { output: result.output, error: result.error },
        logs: result.output || "",
      })
      .returning();

    if (domain) {
      await db.insert(domains).values({
        serverId, name: domain, targetPort: appPort, targetApp: name, sslStatus: "pending",
      }).catch(() => {});
    }

    return ok({
      id: inst.id, containerName, port: appPort, domain,
      status: success ? "success" : "failed",
      output: result.output?.slice(0, 3000),
      error: result.error,
      message: success
        ? `${name} installed on port ${appPort}${domain ? ` with ${domain}` : ""}`
        : "Installation failed",
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
