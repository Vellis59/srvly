#!/usr/bin/env python3
"""Scrape descriptions for apps with bad descriptions.
Uses domain from icon field + meta description scraping.
"""
import sys, os, re, urllib.request, time

DB_URL = os.environ.get("DATABASE_URL", "postgres://srvly:***@localhost:5432/srvly")
import psycopg
conn = psycopg.connect(DB_URL)
cur = conn.cursor()

# Get apps with bad descriptions
cur.execute("SELECT id, icon FROM recipes WHERE LENGTH(description) < 50 OR description LIKE '>-%' OR description LIKE '%-%'")
bad = cur.fetchall()
print(f"Apps needing descriptions: {len(bad)}")

def extract_domain(icon_url):
    """Extract domain from Google favicon URL or any URL."""
    m = re.search(r'domain=([^&]+)', icon_url or '')
    if m:
        d = m.group(1)
        # Clean up common issues
        d = re.sub(r'^https?://', '', d).split('/')[0].strip()
        if d and '.' in d and d != 'github.com':
            return d
    return None

def scrape(url, rid):
    """Try to get meta description from a URL."""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; srvly-bot/1.0; +https://srvly.app)"
        })
        with urllib.request.urlopen(req, timeout=6) as resp:
            html = resp.read().decode("utf-8", errors="replace")[:8000]
    except:
        return None
    
    # Try meta description
    m = re.search(r'<meta\s+name="description"\s+content="([^"]+)"', html, re.I)
    if m: return m.group(1)[:300].strip()
    m = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', html, re.I)
    if m: return m.group(1)[:300].strip()
    m = re.search(r'<meta\s+name="twitter:description"\s+content="([^"]+)"', html, re.I)
    if m: return m.group(1)[:300].strip()
    # Try first substantial paragraph
    m = re.search(r'<p[^>]*>([^<]{60,300})</p>', html)
    if m: return m.group(1)[:200].strip()
    # Try h1 + following text
    m = re.search(r'<h1[^>]*>([^<]+)</h1>\s*<p[^>]*>([^<]{50,300})</p>', html)
    if m: return m.group(2)[:200].strip()
    return None

fixed = 0
errors = 0
for rid, icon in bad:
    domain = extract_domain(icon)
    if not domain:
        errors += 1
        continue
    
    # Try https://domain first, then http://
    desc = None
    for proto in ['https', 'http']:
        url = f"{proto}://{domain}"
        desc = scrape(url, rid)
        if desc: break
        # Try www. prefixed
        if not domain.startswith('www.'):
            url = f"{proto}://www.{domain}"
            desc = scrape(url, rid)
            if desc: break
    
    if desc and len(desc) > 30:
        cur.execute("UPDATE recipes SET description = %s WHERE id = %s", (desc, rid))
        fixed += 1
        print(f"  ✅ {rid}: {desc[:50]}...")
    else:
        errors += 1
        if errors <= 10:
            print(f"  ❌ {rid}: no description @ {domain}")
    
    # Rate limiting - be polite
    time.sleep(0.25)
    
    # Commit every 50
    if fixed % 50 == 0 and fixed > 0:
        conn.commit()
        print(f"  --- Committed {fixed} ---")

conn.commit()
print(f"\n{'='*50}")
print(f"Fixed: {fixed} | Errors: {errors} | Total: {len(bad)}")
conn.close()
