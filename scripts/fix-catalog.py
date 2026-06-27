#!/usr/bin/env python3
"""Fix srvly catalog: icons from Google favicons, descriptions from web scraping."""
import sys, os, json, re, urllib.request, time, yaml, glob
from urllib.parse import urlparse

DB_URL = os.environ.get("DATABASE_URL", "postgres://srvly:***@localhost:5432/srvly")
DRY = "--dry-run" in sys.argv

import psycopg
conn = psycopg.connect(DB_URL)
cur = conn.cursor()

def domain_from_url(url):
    if not url: return None
    url = re.sub(r'^githubUrl:\s*', '', url).strip()
    url = re.sub(r'^https?://', '', url).strip()
    domain = url.split('/')[0].split(':')[0].lower()
    return domain if '.' in domain else None

# ─── 1. Collect icon URLs for YAML apps ───
recipes_dir = "/opt/srvly/recipes"
if not os.path.exists(recipes_dir):
    recipes_dir = "../recipes"
    if not os.path.exists(recipes_dir):
        recipes_dir = "/opt/srvly/landing/../recipes"

yaml_icons = {}
if os.path.exists(recipes_dir):
    for f in glob.glob(os.path.join(recipes_dir, "*.yml")):
        rid = os.path.basename(f).replace(".yml", "")
        with open(f) as fh:
            try:
                d = yaml.safe_load(fh)
            except:
                continue
        for link in (d.get("links") or []):
            label = (link.get("label") or "").lower()
            url = link.get("url", "")
            if "website" in label or "homepage" in label:
                domain = domain_from_url(url)
                if domain:
                    yaml_icons[rid] = f"https://www.google.com/s2/favicons?domain={domain}&sz=64"
                    break

print(f"YAML apps with website URL: {len(yaml_icons)}")

# ─── 2. Process icons ───
# a) YAML apps: use favicon from their website URL
count_icons = 0
for rid, icon_url in yaml_icons.items():
    if not DRY:
        cur.execute("UPDATE recipes SET icon = %s WHERE id = %s AND (icon IS NULL OR icon = '')", (icon_url, rid))
        if cur.rowcount > 0:
            count_icons += 1
    else:
        count_icons += 1
if not DRY:
    conn.commit()
print(f"✅ Icons added for YAML apps: {count_icons}")

# b) Non-YAML apps: extract domain from existing icon field (which contains URL) and replace with favicon URL
if not DRY:
    cur.execute("SELECT id, icon FROM recipes WHERE icon IS NOT NULL AND icon != '' AND icon NOT LIKE 'https://www.google.com/s2/favicons%'")
    for rid, icon in cur.fetchall():
        domain = domain_from_url(icon)
        if domain:
            cur.execute("UPDATE recipes SET icon = %s WHERE id = %s", 
                       (f"https://www.google.com/s2/favicons?domain={domain}&sz=64", rid))
    conn.commit()
    print(f"✅ Icons normalized for all apps with URLs")

# ─── 3. Process descriptions for 871 apps ───
cur.execute("SELECT id, icon FROM recipes WHERE LENGTH(description) < 50 OR description LIKE '>-%' OR description LIKE '%-%'")
bad = cur.fetchall()
print(f"\nApps needing descriptions: {len(bad)}")

desc_added = 0
for rid, icon in bad:
    url = re.sub(r'^githubUrl:\s*', '', (icon or "")).strip()
    if not url: continue
    if not url.startswith("http"): url = "https://" + url
    
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            html = resp.read().decode("utf-8", errors="replace")[:5000]
    except:
        continue
    
    desc = None
    m = re.search(r'<meta\s+name="description"\s+content="([^"]+)"', html, re.I)
    if m: desc = m.group(1)[:300]
    if not desc:
        m = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', html, re.I)
        if m: desc = m.group(1)[:300]
    if not desc:
        m = re.search(r'<p[^>][^>]{0,200}>([^<]{50,300})</p>', html)
        if m: desc = m.group(1)[:200]
    if not desc:
        m = re.search(r'<h2[^>]*>([^<]+)</h2>', html)
        if m: desc = f"A self-hosted {rid.replace('-', ' ')} application."
    
    if desc and len(desc) > 30 and not DRY:
        cur.execute("UPDATE recipes SET description = %s WHERE id = %s", (desc.strip(), rid))
        desc_added += 1
    time.sleep(0.2)

if not DRY:
    conn.commit()
print(f"✅ Descriptions added/fixed: {desc_added}")

# ─── Summary ───
cur.execute("SELECT COUNT(*), COUNT(*) FILTER (WHERE LENGTH(description) > 50), COUNT(*) FILTER (WHERE icon != '') FROM recipes")
t, gd, gi = cur.fetchone()
print(f"\n{'='*50}")
print(f"Total: {t} | Good descriptions: {gd} | With icons: {gi}")
conn.close()
