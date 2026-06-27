import { NextRequest } from "next/server";
import { executeOnServer } from "@/lib/ssh";
import { db } from "@/server/db";
import { servers, domains, installations } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/server/auth";
import { error, ok, validateBody } from "@/lib/api-helpers";
import { enableSslSchema } from "@/lib/api-schemas";
import * as dns from "dns";

export async function POST(req: NextRequest) {
  try {
    // Auth via NextAuth session (cookie-based, browser users)
    const session = await auth();
    if (!session?.user?.id) {
      return error("Unauthorized", 401);
    }
    const userId = session.user.id;

    const validation = await validateBody(req, enableSslSchema);
    if (!validation.valid) return validation.response;
    const { domainId } = validation.data;

    // Look up domain + server, ensure ownership
    const rows = await db
      .select({
        id: domains.id, name: domains.name, targetPort: domains.targetPort,
        sslStatus: domains.sslStatus, ip: servers.ip, serverId: servers.id,
      })
      .from(domains)
      .innerJoin(servers, eq(domains.serverId, servers.id))
      .where(and(eq(domains.id, domainId), eq(servers.userId, userId)));

    if (rows.length === 0) return error("Domain not found", 404);

    const domain = rows[0];
    const name = domain.name;
    const port = domain.targetPort || 80;
    const serverIp = domain.ip;

    // Step 1: DNS check
    const dnsCheck = await checkDns(name, serverIp);
    if (!dnsCheck.ok) {
      return error(
        `DNS not configured: add an A record for ${name} pointing to ${serverIp}. Currently: ${dnsCheck.got || "DNS not found"}`,
        400,
      );
    }

    // Step 2: Configure ACME challenge on the server
    const acmeScript = [
      'set -e',
      'mkdir -p /var/www/certbot',
      `cat > /etc/nginx/sites-enabled/${name}.conf << 'NGINXCONF'`,
      'server {',
      '    listen 80;',
      `    server_name ${name};`,
      '    location /.well-known/acme-challenge/ {',
      '        root /var/www/certbot;',
      '    }',
      '    location / {',
      `        proxy_pass http://127.0.0.1:${port};`,
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '    }',
      '}',
      'NGINXCONF',
      'nginx -t && systemctl reload nginx',
      'echo "ACME_READY"',
    ].join("\n");

    const acmeResult = await executeOnServer(domain.serverId, acmeScript, 15);

    // Step 3: Generate SSL certificate
    const sslScript = [
      'set -e',
      'if ! command -v certbot &>/dev/null; then',
      '  apt-get update -qq',
      '  apt-get install -y -qq certbot python3-certbot-nginx',
      'fi',
      'mkdir -p /var/www/certbot',
      'chmod 755 /var/www/certbot',
      `certbot certonly --webroot -w /var/www/certbot -d ${name} \\`,
      '  --non-interactive --agree-tos --register-unsafely-without-email \\',
      '  --no-eff-email || { echo "SSL_FAILED"; exit 1; }',
      `cat > /etc/nginx/sites-enabled/${name}.conf << 'NGINXCONF'`,
      'server {',
      '    listen 80;',
      `    server_name ${name};`,
      '    location /.well-known/acme-challenge/ {',
      '        root /var/www/certbot;',
      '    }',
      '    location / {',
      '        return 301 https://$host$request_uri;',
      '    }',
      '}',
      'server {',
      '    listen 443 ssl http2;',
      `    server_name ${name};`,
      `    ssl_certificate /etc/letsencrypt/live/${name}/fullchain.pem;`,
      `    ssl_certificate_key /etc/letsencrypt/live/${name}/privkey.pem;`,
      '    location / {',
      `        proxy_pass http://127.0.0.1:${port};`,
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto https;',
      '    }',
      '}',
      'NGINXCONF',
      'nginx -t && systemctl reload nginx',
      '(crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --deploy-hook \'systemctl reload nginx\'") | crontab -',
      'echo "SSL_ACTIVE"',
    ].join("\n");

    const sslResult = await executeOnServer(domain.serverId, sslScript, 90);

    if (!sslResult.success || !(sslResult.output || "").includes("SSL_ACTIVE")) {
      return error("SSL generation failed: " + (sslResult.error || sslResult.output?.slice(-500)), 502);
    }

    // Update DB
    await db
      .update(domains)
      .set({ sslStatus: "active" })
      .where(eq(domains.id, domainId));

    return ok({
      url: `https://${name}`,
      message: "SSL activated!",
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}

async function checkDns(name: string, expectedIp: string): Promise<{ ok: boolean; got?: string | null }> {
  try {
    return await new Promise((resolve) => {
      dns.resolve4(name, (err: NodeJS.ErrnoException | null, addresses: string[]) => {
        if (err) {
          resolve({ ok: false, got: null });
          return;
        }
        if (addresses.length === 0) {
          resolve({ ok: false, got: null });
          return;
        }
        resolve({ ok: addresses.includes(expectedIp), got: addresses.join(", ") });
      });
    });
  } catch {
    return { ok: false };
  }
}
