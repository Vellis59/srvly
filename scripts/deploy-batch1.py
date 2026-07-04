#!/usr/bin/python3
"""Deploy batch1 recipes to Hetzner prod via SSH."""
import subprocess, json, sys

HOST = "95.217.160.22"
WORK = "/opt/srvly"

def ssh(cmd, timeout=120):
    full = f"ssh root@{HOST} 'bash -s' << 'SRVLY_PYEOF'\nset -e\n{cmd}\nSRVLY_PYEOF"
    r = subprocess.run(full, shell=True, text=True, capture_output=True, timeout=timeout)
    if r.returncode != 0:
        print(f"FAIL: {cmd[:80]}")
        print(r.stderr)
        sys.exit(1)
    return r.stdout

# 1. git pull
print(">>> git pull")
print(ssh("cd /opt/srvly && git log --oneline -1 && git pull && git log --oneline -1"))

# 2. Ensure recipes dir + install deps
print(">>> mkdir + npm install")
print(ssh("docker exec infra-platform-1 sh -c 'mkdir -p /app/recipes' 2>/dev/null; "
           "docker exec infra-platform-1 npm install pg js-yaml 2>&1 | tail -3"))

# 3. Copy seed script and all v2 recipes
print(">>> docker cp seed script")
print(ssh("docker cp /opt/srvly/scripts/seed-recipes.js infra-platform-1:/app/seed-recipes.js"))
print(">>> docker cp v2 recipes")
print(ssh("docker cp /opt/srvly/recipes/v2/. infra-platform-1:/app/recipes/ 2>&1"))
print(">>> verify files in container")
print(ssh("docker exec infra-platform-1 ls /app/recipes/*.yml 2>&1 | wc -l"))

# 4. Run seed
print(">>> seed recipes")
print(ssh("docker exec infra-platform-1 node /app/seed-recipes.js"))

# 5. Rebuild platform
print(">>> rebuild platform")
print(ssh("cd /opt/srvly/infra && docker compose up -d --build platform 2>&1 | tail -5"))

# 6. Verify DB
print(">>> verify recipes in DB")
out = ssh("docker exec infra-postgres-1 psql -U srvly -d srvly -c "
           "'SELECT id, name, LEFT(icon,40) AS icon FROM recipes ORDER BY id;'")
print(out)

# 7. Count
count = ssh("docker exec infra-postgres-1 psql -U srvly -d srvly -Atc 'SELECT count(*) FROM recipes;'")
print(f"Total recipes in DB: {count.strip()}")

print(">>> DEPLOYMENT COMPLETE")
