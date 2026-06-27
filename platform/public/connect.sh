#!/bin/bash
# srvly — Server bootstrap & connect script
# Usage: curl -sL https://YOUR_DOMAIN/connect.sh | bash -s -- "<SSH_PUBLIC_KEY>"
#
# This script:
#   1. Installs the srvly SSH key (persistent via cron guard)
#   2. Optionally installs Docker, Nginx, UFW, Fail2Ban
#   3. Reports back to srvly

set -e

SRVLY_KEY="$1"
GUARD_PATH="/etc/cron.hourly/srvly-key-guard"

if [ -z "$SRVLY_KEY" ]; then
  echo "Missing SSH public key."
  echo "Usage: curl -sL https://YOUR_DOMAIN/connect.sh | bash -s -- \"<SSH_KEY>\""
  exit 1
fi

echo "--- srvly connect ---"

# 1. Install SSH key
mkdir -p /root/.ssh
chmod 700 /root/.ssh
if ! grep -qF "$SRVLY_KEY" /root/.ssh/authorized_keys 2>/dev/null; then
  echo "$SRVLY_KEY" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  echo "SSH key installed"
fi

# 2. Cron guard — re-adds key if removed
mkdir -p /etc/cron.hourly
cat > "$GUARD_PATH" << GUARD
#!/bin/sh
# srvly key guard — reinstalls key if removed
if [ -f /root/.ssh/authorized_keys ] && ! grep -qF "$SRVLY_KEY" /root/.ssh/authorized_keys 2>/dev/null; then
  echo "$SRVLY_KEY" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
fi
GUARD
chmod +x "$GUARD_PATH"
echo "Key guard installed (hourly)"

# 3. Docker
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker 2>/dev/null || true
  echo "Docker installed"
fi

# 4. Security
apt-get update -qq 2>/dev/null
if ! command -v ufw &>/dev/null; then
  apt-get install -y -qq ufw 2>/dev/null
  ufw --force reset 2>/dev/null
  ufw default deny incoming 2>/dev/null
  ufw default allow outgoing 2>/dev/null
  ufw allow ssh 2>/dev/null
  ufw allow 80/tcp 2>/dev/null
  ufw allow 443/tcp 2>/dev/null
  ufw --force enable 2>/dev/null || true
  echo "UFW installed"
fi
if ! command -v fail2ban-client &>/dev/null; then
  apt-get install -y -qq fail2ban 2>/dev/null || true
  systemctl enable fail2ban 2>/dev/null || true
  echo "Fail2Ban installed"
fi

echo "--- Done ---"
echo "Server connected. Return to srvly and click Test connection."
