#!/bin/bash
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔒 srvly — Full Server Hardening + Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DOMAIN="srvly.vellis.cc"
GIT_REPO="https://github.com/Vellis59/srvly.git"
INSTALL_DIR="/opt/srvly"

# ── 1. Firewall ──
echo "[1/8] 🔥 UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  ✅ UFW active"

# ── 2. SSH Hardening ──
echo "[2/8] 🔒 SSH hardening..."
sed -i 's/#PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl restart sshd
echo "  ✅ SSH hardened"

# ── 3. Fail2Ban ──
echo "[3/8] 🚫 Fail2Ban..."
apt-get install -y -qq fail2ban 2>/dev/null
cat > /etc/fail2ban/jail.local << 'F2BEOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
[sshd]
enabled = true
maxretry = 3
F2BEOF
systemctl enable fail2ban 2>/dev/null
systemctl restart fail2ban
echo "  ✅ Fail2Ban active"

# ── 4. Automatic updates ──
echo "[4/8] 📦 Auto-updates..."
apt-get install -y -qq unattended-upgrades 2>/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades 2>/dev/null || true
echo "  ✅ Auto-updates enabled"

# ── 5. Docker ──
echo "[5/8] 🐳 Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | bash
fi
echo "  ✅ Docker ready"

# ── 6. Clone srvly ──
echo "[6/8] 📥 Cloning srvly..."
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR" && git pull
else
  git clone "$GIT_REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Generate .env with random passwords
if [ ! -f .env ]; then
  PGPASS=$(openssl rand -base64 24 | tr -dc a-zA-Z0-9)
  AUTHSECRET=$(openssl rand -base64 32 | tr -dc a-zA-Z0-9)
  cat > .env << EOF
DATABASE_URL=postgres://srvly:${PGPASS}@postgres:5432/srvly
POSTGRES_PASSWORD=${PGPASS}
AUTH_SECRET=${AUTHSECRET}
NEXT_PUBLIC_BASE_URL=https://${DOMAIN}
NEXT_PUBLIC_APP_URL=https://${DOMAIN}
NEXTAUTH_URL=https://${DOMAIN}
SSH_KEY_PATH=/app/ssh_keys
EOF
  echo "  ✅ .env generated"
else
  echo "  ✅ .env exists"
fi

# ── 7. Caddy reverse proxy ──
echo "[7/8] 🌐 Caddy HTTPS..."
mkdir -p infra
cat > infra/Caddyfile << CADDYEOF
${DOMAIN} {
    reverse_proxy platform:3000
}
CADDYEOF

cat > infra/docker-compose.yml << 'DOCKEREOF'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: srvly
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
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
DOCKEREOF

echo "  ✅ Caddy configured"

# ── 8. Build & start ──
echo "[8/8] 🚀 Starting..."
docker compose -f infra/docker-compose.yml up -d --build 2>&1 | tail -3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ srvly deployed!"
echo "  🌐 https://${DOMAIN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
