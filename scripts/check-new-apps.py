#!/usr/bin/env python3
"""Check Docker images for remaining Dokploy apps."""
import json, re, os, subprocess

with open(r'C:\Users\Velli\AppData\Local\Temp\dokploy.json', 'r', encoding='utf-8') as f:
    raw = re.sub(r'[\x00-\x1f]', ' ', f.read())
data = json.loads(raw)

existing = set(f.replace('.yml','') for f in os.listdir(r'C:\Users\Velli\Desktop\CODE\hermes\srvly\recipes\v2') if f.endswith('.yml'))
archive = set(f.replace('.yml','') for f in os.listdir(r'C:\Users\Velli\Desktop\CODE\hermes\srvly\recipes\archive') if f.endswith('.yml'))
known = existing | archive

def norm(s):
    return re.sub(r'[-_.\s]', '', s).lower()

kn = {norm(s) for s in known}

new = [a for a in data if a['id'].lower() not in known and norm(a['id'].lower()) not in kn]
print(f"Total remaining: {len(new)}")

# Skip infrastructure/game servers/no-port apps
skip = {'dragonfly-db','emqx','enshrouded','fivem','flatnotes-totp','frappe-hr','frappe-lending',
        'erpnext','garage','garage-with-ui','gitea-mirror','gitea-mysql','gitea-postgres','gitea-sqlite',
        'grafana-loki','grafana-tempo','grafana-mimir','hadoop','n8n',
        'cloudflare-ddns','cloudflared','colanode','couchdb','datalens','discord-tickets',
        'dokploy-prom-monitoring-extension','go-whatsapp-web-multidevice','instantdb','kaneo','kestra',
        'ipfs','java','conduit','conduwuit','booklore','gitingest'}

found = []
for a in new:
    if a['id'].lower() in skip:
        continue
    if len(found) >= 10:
        break
    
    # Try to get docker-compose
    url = f"https://raw.githubusercontent.com/Dokploy/templates/canary/blueprints/{a['id']}/docker-compose.yml"
    r = subprocess.run(['curl', '-sL', url], capture_output=True, text=True, timeout=15)
    
    for line in r.stdout.splitlines():
        if 'image:' in line:
            img = line.split('image:')[1].strip().strip("'").strip('"')
            if img.startswith('&'):
                continue
            # Check if image exists
            r2 = subprocess.run(['docker', 'manifest', 'inspect', img], capture_output=True, timeout=60)
            if r2.returncode == 0:
                found.append((a['id'], img, a['name'], a['links'].get('github','')))
                print(f"✅ {a['id']:25s} -> {img}")
            else:
                print(f"❌ {a['id']:25s} -> {img}")
            break

print(f"\nFound {len(found)} good apps:")
for a_id, img, name, gh in found:
    print(f"  {a_id:25s} {name:30s} {img}")
