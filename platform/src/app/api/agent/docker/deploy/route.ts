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
// One-shot Docker deploy: pull + run + reverse proxy + register via SSH
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

    // Build one-shot install script
    const scriptLines = [
      "set -e",
      'echo ">>> PULL"',
      "docker pull " + imageName + " 2>&1",
      "",
      'echo ">>> CLEAN"',
      "docker rm -f " + containerName + " 2>/dev/null || true",
      "mkdir -p " + appDir,
      "",
      'echo ">>> RUN"',
    ];

    // Build docker run command
    let runCmd = "docker run -d --name " + containerName;
    runCmd += " --restart unless-stopped";
    runCmd += " -p " + appPort + ":" + appPort;

    if (env && typeof env === "object") {
      for (const [k, v] of Object.entries(env)) {
        runCmd += " -e " + k + "='" + String(v) + "'";
      }
    }

    if (volumes && Array.isArray(volumes)) {
      for (const vol of volumes) {
        const parts = vol.split(":");
        const hostPath = appDir + "/" + parts[0];
        runCmd += " -v " + hostPath + ":" + parts[1];
      }
    }

    runCmd += " " + imageName + " 2>&1";
    scriptLines.push(runCmd);
    scriptLines.push("");
    scriptLines.push('echo ">>> WAIT"');
    scriptLines.push("sleep 3");
    scriptLines.push("");
    scriptLines.push('echo ">>> CHECK"');
    scriptLines.push("for i in 1 2 3 4 5; do");
    scriptLines.push(
      '  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:' +
        appPort +
        " 2>/dev/null || echo '000')"
    );
    scriptLines.push('  echo "  Attempt $i: HTTP $CODE"');
    scriptLines.push('  [ "$CODE" != "000" ] && echo "READY" && break');
    scriptLines.push("  sleep 3");
    scriptLines.push("done");

    // Domain + reverse proxy (auto-detect: Caddy or nginx)
    if (domain) {
      scriptLines.push("");
      scriptLines.push('echo ">>> REVERSE PROXY"');
      scriptLines.push('echo "Detecting installed reverse proxy..."');
      scriptLines.push("");
      // Branch on Caddy vs nginx
      scriptLines.push('if command -v caddy &>/dev/null; then');
      scriptLines.push('  echo "Using Caddy"');
      scriptLines.push('  CFG=/opt/srvly/infra/Caddyfile');
      scriptLines.push('  [ ! -f "$CFG" ] && CFG=/etc/caddy/Caddyfile');
      scriptLines.push("  echo 'Adding domain to Caddyfile: " + domain + " → :" + appPort + "'");
      scriptLines.push("  echo '" + domain + " {' >> $CFG");
      scriptLines.push("  echo '    reverse_proxy 127.0.0.1:" + appPort + "' >> $CFG");
      scriptLines.push("  echo '}' >> $CFG");
      scriptLines.push('  # Reload Caddy (Docker or native)');
      scriptLines.push('  if docker ps -q --filter name=caddy 2>/dev/null | grep -q .; then');
      scriptLines.push('    docker compose -f /opt/srvly/infra/docker-compose.yml restart caddy 2>&1 || docker exec $(docker ps -q --filter name=caddy) caddy reload --config /etc/caddy/Caddyfile 2>&1');
      scriptLines.push('  else');
      scriptLines.push('    caddy reload --config "$CFG" 2>&1 || systemctl reload caddy 2>&1 || service caddy reload 2>&1 || true');
      scriptLines.push('  fi');
      scriptLines.push('  echo "CADDY_OK"');
      scriptLines.push('elif command -v nginx &>/dev/null; then');
      scriptLines.push('  echo "Using nginx"');
      scriptLines.push("  cat > /etc/nginx/sites-enabled/" + domain + ".conf << 'NGINX'");
      scriptLines.push("server {");
      scriptLines.push("    listen 80;");
      scriptLines.push("    server_name " + domain + ";");
      scriptLines.push("    location / {");
      scriptLines.push("        proxy_pass http://127.0.0.1:" + appPort + ";");
      scriptLines.push("        proxy_set_header Host $host;");
      scriptLines.push("        proxy_set_header X-Real-IP $remote_addr;");
      scriptLines.push("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
      scriptLines.push("        proxy_set_header X-Forwarded-Proto $scheme;");
      scriptLines.push("    }");
      scriptLines.push("}");
      scriptLines.push("NGINX");
      scriptLines.push("  nginx -t && systemctl reload nginx");
      scriptLines.push('  echo "NGINX_OK"');
      scriptLines.push('else');
      scriptLines.push('  echo "WARNING: No reverse proxy detected. Domain ' + domain + ' will not be reachable."');
      scriptLines.push('  echo "Install Caddy (recommended) or nginx and reconfigure."');
      scriptLines.push('fi');
    }

    const script = scriptLines.join("\n");

    // Execute via SSH (timeout 180s for docker pull)
    const result = await executeOnServer(serverId, script, 180);
    const success = result.success && (result.output || "").includes("READY");

    // Create installation record
    const [inst] = await db
      .insert(installations)
      .values({
        serverId,
        recipeId: "app",
        status: success ? "success" : "failed",
        params: {
          name,
          port: appPort,
          domain,
          image: imageName,
          containerName,
        },
        result: { output: result.output, error: result.error },
        logs: result.output || "",
      })
      .returning();

    // If domain, also create domain record
    if (domain) {
      await db
        .insert(domains)
        .values({
          serverId,
          name: domain,
          targetPort: appPort,
          targetApp: name,
          sslStatus: "pending",
        })
        .catch(() => {});
    }

    return ok({
      id: inst.id,
      containerName,
      port: appPort,
      domain,
      status: success ? "success" : "failed",
      output: result.output?.slice(0, 3000),
      error: result.error,
      message: success
        ? name + " installed on port " + appPort + (domain ? " with " + domain : "")
        : "Installation failed",
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
