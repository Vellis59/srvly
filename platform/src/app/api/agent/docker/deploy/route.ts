import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { installations, servers, domains } from "@/server/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { authUser, error, ok, validateBody } from "@/lib/api-helpers";
import { dockerDeploySchema } from "@/lib/api-schemas";

// ─── POST /api/agent/docker/deploy ────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const user = await authUser(req);
    if (!user) return error("Invalid token", 401);

    const validation = await validateBody(req, dockerDeploySchema);
    if (!validation.valid) return validation.response;
    const { serverId, name, image, port, containerPort, domain, network, env, volumes, healthcheckPath, healthcheckExpected, recipeId } = validation.data;

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, user.id)));
    if (!server) return error("Server not found", 404);

    const appPort = port || 3000;
    const appContainerPort = containerPort || appPort;
    const checkPath = healthcheckPath || "/";
    const expectedCodes = healthcheckExpected?.length ? healthcheckExpected : undefined;
    const containerName = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const imageName = image || name.toLowerCase();
    
    // Strict input validations to prevent RCE
    if (!/^[a-zA-Z0-9_/.:-]+$/.test(imageName)) {
      return error("Invalid image name format", 400);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(containerName)) {
      return error("Invalid container name format", 400);
    }
    if (network && !/^[a-zA-Z0-9_.-]+$/.test(network)) {
      return error("Invalid Docker network name", 400);
    }
    if (!/^\/[a-zA-Z0-9_./?=&%-]*$/.test(checkPath)) {
      return error("Invalid healthcheck path", 400);
    }

    const appDir = "/opt/srvly/" + containerName;
    const envFilePath = `/tmp/srvly-${containerName}.env`;

    // Build env lines safely
    let envLines = "";
    if (env && typeof env === "object") {
      for (const [k, v] of Object.entries(env)) {
        if (!/^[a-zA-Z0-9_-]+$/.test(k)) {
          return error(`Invalid environment variable key: ${k}`, 400);
        }
        envLines += `${k}=${String(v)}\n`;
      }
    }

    // Build install script
    const s = [
      "set -e",
      `mkdir -p "${appDir}"`,
    ];

    // Safely write environment variables to env file using Heredoc literal 'ENV_EOF'
    if (envLines) {
      s.push(`cat > "${envFilePath}" << 'ENV_EOF'`);
      s.push(envLines.trim());
      s.push("ENV_EOF");
    }

    s.push(
      `echo ">>> PULL"`,
      `docker pull ${imageName} 2>&1`,
      "",
      `echo ">>> CLEAN"`,
      `docker rm -f ${containerName} 2>/dev/null || true`,
      "",
      `echo ">>> RUN"`
    );

    if (network) {
      s.push(`docker network create ${network} 2>/dev/null || true`);
    }

    let runCmd = `docker run -d --name ${containerName} --restart unless-stopped -p ${appPort}:${appContainerPort}`;
    if (network) {
      runCmd += ` --network ${network}`;
    }
    if (envLines) {
      runCmd += ` --env-file "${envFilePath}"`;
    }
    if (volumes && Array.isArray(volumes)) {
      for (const vol of volumes) {
        const parts = vol.split(":");
        const hostPath = parts[0].startsWith("/") ? parts[0] : `${appDir}/${parts[0]}`;
        const containerPath = parts[1];
        
        // Strict path character validation to prevent command injection
        if (!/^[a-zA-Z0-9_/.-]+$/.test(hostPath) || !/^[a-zA-Z0-9_/.-]+$/.test(containerPath)) {
          return error(`Invalid volume path format: ${vol}`, 400);
        }
        
        s.push(`mkdir -p "${hostPath}"`);
        runCmd += ` -v "${hostPath}:${containerPath}"`;
      }
    }
    runCmd += ` ${imageName} 2>&1`;
    s.push(runCmd);
    
    // Clean up temporary env file
    if (envLines) {
      s.push(`rm -f "${envFilePath}"`);
    }

    s.push("", `echo ">>> WAIT"`, "sleep 3", "", `echo ">>> CHECK"`);
    s.push("READY=0");
    s.push("for i in 1 2 3 4 5 6 7 8 9 10; do");
    s.push(`  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${appPort}${checkPath} 2>/dev/null || true)`);
    s.push('  [ -z "$CODE" ] && CODE=000');
    s.push('  echo "  Attempt $i: HTTP $CODE"');
    if (expectedCodes) {
      s.push(`  case " ${expectedCodes.join(" ")} " in *" $CODE "*) READY=1; echo "READY"; break ;; esac`);
    } else {
      s.push('  case "$CODE" in 2*|3*) READY=1; echo "READY"; break ;; esac');
    }
    s.push("  sleep 3");
    s.push("done");
    s.push('if [ "$READY" != "1" ]; then');
    s.push('  echo "ERROR: App did not become ready after 10 healthcheck attempts"');
    s.push("fi");

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
      s.push(`  echo ">>> HTTPS CHECK"`);
      s.push('  DOMAIN_READY=0');
      s.push('  for i in 1 2 3 4 5 6 7 8 9 10; do');
      s.push(`    DOMAIN_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 https://${domain}${checkPath} 2>/dev/null || true)`);
      s.push('    [ -z "$DOMAIN_CODE" ] && DOMAIN_CODE=000');
      s.push('    echo "  HTTPS attempt $i: HTTP $DOMAIN_CODE"');
      if (expectedCodes) {
        s.push(`    case " ${expectedCodes.join(" ")} " in *" $DOMAIN_CODE "*) DOMAIN_READY=1; echo "DOMAIN_READY"; break ;; esac`);
      } else {
        s.push('    case "$DOMAIN_CODE" in 2*|3*) DOMAIN_READY=1; echo "DOMAIN_READY"; break ;; esac');
      }
      s.push('    sleep 5');
      s.push('  done');
      s.push('  if [ "$DOMAIN_READY" != "1" ]; then echo "ERROR: HTTPS domain did not become ready"; fi');

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
    const output = result.output || "";
    const appReady = /(^|\n)READY(\n|$)/.test(output);
    const domainReady = /(^|\n)DOMAIN_READY(\n|$)/.test(output);
    const success = result.success && appReady && (!domain || domainReady);

    const params = { name, port: appPort, containerPort: appContainerPort, domain, image: imageName, containerName, network, healthcheckPath: checkPath, healthcheckExpected: expectedCodes };

    // Dedup: check if an installation with the same name, containerName, or recipeId already exists on this server (case-insensitive)
    const [existing] = await db
      .select()
      .from(installations)
      .where(
        and(
          eq(installations.serverId, serverId),
          or(
            recipeId && recipeId !== "app" ? eq(installations.recipeId, recipeId) : sql`false`,
            sql`lower(params->>'containerName') = ${containerName.toLowerCase()} OR lower(params->>'name') = ${name.toLowerCase()}`
          )
        ),
      )
      .limit(1);

    let inst;
    if (existing) {
      // Update existing installation (don't create duplicates on retry)
      [inst] = await db
        .update(installations)
        .set({
          recipeId: recipeId || existing.recipeId || "app",
          status: success ? "success" : "failed",
          params,
          result: { output, error: result.error },
          logs: output,
          updatedAt: new Date(),
        })
        .where(eq(installations.id, existing.id))
        .returning();
    } else {
      // Create new installation
      [inst] = await db
        .insert(installations)
        .values({
          serverId,
          recipeId: recipeId || "app",
          status: success ? "success" : "failed",
          params,
          result: { output, error: result.error },
          logs: output,
        })
        .returning();
    }

    // Dedup domains too: update existing or insert new
    if (domain) {
      const [existingDomain] = await db
        .select()
        .from(domains)
        .where(
          and(
            eq(domains.serverId, serverId),
            eq(domains.name, domain),
          ),
        )
        .limit(1);

      if (!existingDomain) {
        await db.insert(domains).values({
          serverId, name: domain, targetPort: appPort, targetApp: name, sslStatus: "pending",
        }).catch(() => {});
      }
    }

    return ok({
      id: inst.id, containerName, port: appPort, containerPort: appContainerPort, domain,
      status: success ? "success" : "failed",
      output: output.slice(0, 3000),
      error: result.error,
      message: success
        ? `${name} installed on port ${appPort}${domain ? ` with ${domain}` : ""}`
        : "Installation failed",
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
