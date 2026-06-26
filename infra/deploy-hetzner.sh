#!/bin/bash
set -e

echo "=== [1/8] UFW Firewall ==="
ufw --force reset 2>/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable 2>/dev/null
echo "OK"

echo "=== [2/8] SSH Hardening ==="
sed -i 's/.*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/.*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
echo "OK"

echo "=== [3/8] Fail2Ban ==="
apt-get update -qq
apt-get install -y -qq fail2ban 2>/dev/null || true
cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
bantime = 3600
findtime = 600
[sshd]
enabled = true
maxretry = 3
F2B
systemctl restart fail2ban 2>/dev/null || true
echo "OK"

echo "=== [4/8] Docker ==="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | bash
fi
echo "OK"

echo "=== [5/8] Clone srvly ==="
if [ -d /opt/srvly ]; then
  cd /opt/srvly && git pull
else
  git clone https://github.com/Vellis59/srvly.git /opt/srvly
  cd /opt/srvly
fi
echo "OK"

echo "=== [6/8] Generate .env ==="
python3 << 'PYENV'
import os, secrets, string
a = string.ascii_letters + string.digits
pg = "".join(secrets.choice(a) for _ in range(24))
au = "".join(secrets.choice(a) for _ in range(32))
p = "/opt/srvly/.env"
if not os.path.exists(p):
    with open(p, "w") as f:
        f.write("DATABASE_URL=postgres://srvly:PASSWORD_PLACEHOLDER@postgres:5432/srvly\n")
        f.write("POSTGRES_PASSWORD=" + pg + "\n")
        f.write("AUTH_SECRET=" + au + "\n")
        f.write("NEXT_PUBLIC_BASE_URL=https://srvly.vellis.cc\n")
        f.write("NEXT_PUBLIC_APP_URL=https://srvly.vellis.cc\n")
        f.write("NEXTAUTH_URL=https://srvly.vellis.cc\n")
        f.write("SSH_KEY_PATH=/app/ssh_keys\n")
        f.write("AUTH_TRUST_HOST=true\n")
        f.write("AUTH_GITHUB_ID=\n")
        f.write("AUTH_GITHUB_SECRET=\n")
    print(".env created")
else:
    print(".env exists")
PYENV
echo "OK"

echo "=== [7/8] Caddy config ==="
mkdir -p /opt/srvly/infra
cat > /opt/srvly/infra/Caddyfile << 'CADDY'
srvly.vellis.cc {
    reverse_proxy platform:3000
}
CADDY

cat > /opt/srvly/infra/docker-compose.yml << 'DOCKER'
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: srvly
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: srvly
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U srvly"]
      interval: 5s
      timeout: 5s
      retries: 5
  platform:
    build:
      context: ../platform
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    env_file:
      - ../.env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      postgres:
        condition: service_healthy
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - platform
volumes:
  pgdata:
  caddy_data:
  caddy_config:
DOCKER
echo "OK"

echo "=== [8/8] Deploy ==="
cd /opt/srvly && docker compose -f infra/docker-compose.yml up -d --build 2>&1
echo ""
echo "=================================="
echo "  DONE! https://srvly.vellis.cc  "
echo "=================================="
