#!/usr/bin/env python3
"""Extract descriptions from recipe JSONB content field and update the DB."""
import re, os, sys

DB_URL = os.environ.get("DATABASE_URL", "postgres://srvly:***@localhost:5432/srvly")
import psycopg
conn = psycopg.connect(DB_URL)
cur = conn.cursor()

# Get apps with bad descriptions that have recipe data
cur.execute("""
    SELECT id, recipe->>'content' 
    FROM recipes 
    WHERE recipe IS NOT NULL 
      AND (LENGTH(description) < 50 OR description LIKE '>-%' OR description LIKE '|-%')
""")
rows = cur.fetchall()
print(f"Apps with recipe data: {len(rows)}")

fixed = 0
for rid, content in rows:
    if not content:
        continue
    
    desc = None
    for field in ["description", "tagline"]:
        m = re.search(rf'^{field}:\s*>.?\s*\n\s+(.+?)(?:\n\S|\Z)', content, re.M | re.S)
        if m:
            desc = m.group(1).strip()
            desc = re.sub(r'\*\*', '', desc).replace('\n', ' ').strip()
            if len(desc) > 30:
                break
    
    if desc and len(desc) > 30:
        cur.execute("UPDATE recipes SET description = %s WHERE id = %s", (desc[:300], rid))
        fixed += 1

conn.commit()
print(f"Fixed: {fixed} descriptions")

# Summary
cur.execute("SELECT COUNT(*) FILTER (WHERE LENGTH(description) > 50) FROM recipes")
good = cur.fetchone()[0]
print(f"Total good descriptions now: {good}")
conn.close()
