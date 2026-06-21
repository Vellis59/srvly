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
// One-shot Docker deploy: pull + run + nginx + register in one SSH call
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Token invalide", 401);

    const body = await req.json();
    const { serverId, name, image, port, domain, env, volumes } = body;
    if (!serverId || !name) return error("serverId et name requis");

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Serveur introuvable", 404);

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
      "docker run -d --name " + containerName,
      "  --restart unless-stopped",
      "  -p " + appPort + ":" + appPort,
    ];

    // Add env vars
    if (env && typeof env === "object") {
      for (const [k, v] of Object.entries(env)) {
        scriptLines.push("  -e " + k + "='" + String(v) + "'");
      }
    }

    // Add volumes
    if (volumes && Array.isArray(volumes)) {
      for (const vol of volumes) {
        const parts = vol.split(":");
        const hostPath = appDir + "/" + parts[0];
        scriptLines.push("  -v " + hostPath + ":" + parts[1]);
      }
    }

    scriptLines.push("  " + imageName + " 2>&1");
    scriptLines.push("");
    scriptLines.push('echo ">>> WAIT"');
    scriptLines.push("sleep 3");
    scriptLines.push("");
    scriptLines.push('echo ">>> CHECK"');
    scriptLines.push(
      "for i in 1 2 3 4 5; do",
    );
    scriptLines.push(
      '  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:' +
        appPort +
        " 2>/dev/null || echo '000')",
    );
    scriptLines.push('  echo "  Attempt $i: HTTP $CODE"');
    scriptLines.push('  [ "$CODE" != "000" ] && echo "READY" && break');
    scriptLines.push("  sleep 3");
    scriptLines.push("done");

    // Domain + nginx
    if (domain) {
      scriptLines.push("");
      scriptLines.push('echo ">>> NGINX"');
      scriptLines.push('cat > /etc/nginx/sites-enabled/' + domain + '.conf << NGINX');
      scriptLines.push("server {");
      scriptLines.push("    listen 80;");
      scriptLines.push("    server_name " + domain + ";");
      scriptLines.push("    location / {");
      scriptLines.push("        proxy_pass http://127.0.0.1:" + appPort + ";");
      scriptLines.push('        proxy_set_header Host $host;');
      scriptLines.push('        proxy_set_header X-Real-IP $remote_addr;');
      scriptLines.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
      scriptLines.push('        proxy_set_header X-Forwarded-Proto $scheme;');
      scriptLines.push("    }");
      scriptLines.push("}");
      scriptLines.push("NGINX");
      scriptLines.push("nginx -t && systemctl reload nginx");
      scriptLines.push('echo "NGINX_OK"');
    }

    const script = scriptLines.join("\n");

    // Execute via SSH (single call, timeout 180s for docker pull)
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
        ? name + " installee sur le port " + appPort + (domain ? " avec " + domain : "")
        : "Echec de l installation",
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
