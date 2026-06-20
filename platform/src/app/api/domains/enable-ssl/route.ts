import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";

const env = process.env as Record<string, string | undefined>;
const AI_KEY = env["AI_" + "API_KEY"] || "";
const dbUrl = env["DATABASE_URL"] || "";

export async function POST(req: NextRequest) {
  try {
    const { domainId } = await req.json();
    if (!domainId) return NextResponse.json({ error: "domainId required" }, { status: 400 });

    if (!dbUrl) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

    // Fetch domain + verify server ownership via session
    const cookieHeader = req.headers.get("cookie") || "";
    const sessionResp = await fetch(`http://localhost:3000/api/auth/session`, {
      headers: { cookie: cookieHeader },
    });
    const session = await sessionResp.json();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    const result = await client.query(
      `SELECT d.id, d.name, d.target_port, d.ssl_status, s.ip, s.id AS server_id
       FROM domains d
       JOIN servers s ON d.server_id = s.id
       WHERE d.id = $1 AND s.user_id = $2`,
      [domainId, session.user.id]
    );
    await client.end();

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "domain not found" }, { status: 404 });
    }

    const domain = result.rows[0];
    const name = domain.name;
    const port = domain.target_port || 80;
    const serverIp = domain.ip;

    // Step 1: DNS check (verify the domain resolves to this server)
    const dnsCheck = await checkDns(name, serverIp);
    if (!dnsCheck.ok) {
      return NextResponse.json({
        error: "DNS check failed",
        detail: dnsCheck.error,
        expected_ip: serverIp,
        got: dnsCheck.got,
      }, { status: 400 });
    }

    // Step 2: Dispatch SSL generation to the server
    const sslScript = `set -e

# Install certbot if needed
if ! command -v certbot &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# Generate cert with webroot challenge (no nginx downtime)
mkdir -p /var/www/certbot
chmod 755 /var/www/certbot

# Get certificate
certbot certonly --webroot -w /var/www/certbot -d ${name} \\
  --non-interactive --agree-tos --register-unsafely-without-email \\
  --no-eff-email || {
  echo "SSL_FAILED"
  exit 1
}

# Update nginx config to use SSL + redirect HTTP to HTTPS
cat > /etc/nginx/sites-enabled/${name}.conf << NGINXCONF
server {
    listen 80;
    server_name ${name};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${name};

    ssl_certificate /etc/letsencrypt/live/${name}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${name}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINXCONF

nginx -t && systemctl reload nginx

# Auto-renewal
(crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | crontab -

echo "SSL_ACTIVE"
`;

    const tunnelUrl = env["TUNNEL_URL"] || "http://tunnel-server:8080";
    const dispatchResp = await fetch(`${tunnelUrl}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: "unknown",
        command_id: `ssl-${domainId}`,
        script: sslScript,
        timeout: 90,
      }),
    });
    const dispatchData = await dispatchResp.json();

    if (!dispatchData.success) {
      return NextResponse.json({
        error: "SSL generation failed",
        detail: dispatchData.error || dispatchData.output,
      }, { status: 502 });
    }

    // Update DB
    const client2 = new Client({ connectionString: dbUrl });
    await client2.connect();
    await client2.query(
      `UPDATE domains SET ssl_status = 'active' WHERE id = $1`,
      [domainId]
    );
    await client2.end();

    return NextResponse.json({
      success: true,
      url: `https://${name}`,
      message: "SSL activé !",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function checkDns(name: string, expectedIp: string): Promise<{ ok: boolean; error?: string; got?: string | null }> {
  try {
    const dns = await import("dns");
    return await new Promise((resolve) => {
      dns.resolve4(name, (err: NodeJS.ErrnoException | null, addresses: string[]) => {
        if (err) {
          resolve({ ok: false, error: err.message, got: null });
          return;
        }
        if (addresses.length === 0) {
          resolve({ ok: false, error: "no DNS records", got: null });
          return;
        }
        if (addresses.includes(expectedIp)) {
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error: "Domain does not point to this server",
            got: addresses.join(", "),
          });
        }
      });
    });
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
