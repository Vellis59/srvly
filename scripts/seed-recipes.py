#!/usr/bin/env python3
"""
Seed srvly platform database with recipes from the recipes/ directory.

Usage:
  python3 scripts/seed-recipes.py [--db DATABASE_URL]
  
When run without --db, reads DATABASE_URL from environment.
"""

import sys, os, yaml, glob
from pathlib import Path

try:
    import postgres
    import psycopg
except ImportError:
    print("Installing psycopg...")
    os.system("pip install psycopg[binary] -q")
    try:
        import psycopg
    except ImportError:
        print("ERROR: could not install psycopg")
        sys.exit(1)

import json


def main():
    db_url = None
    for i, a in enumerate(sys.argv[1:]):
        if a.startswith("--db="):
            db_url = a.split("=", 1)[1]
    db_url = db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set. Use --db=...")
        sys.exit(1)

    recipes_dir = Path("recipes")
    if not recipes_dir.exists():
        recipes_dir = Path("../recipes")
    if not recipes_dir.exists():
        print("ERROR: recipes/ directory not found")
        sys.exit(1)

    conn = psycopg.connect(db_url)
    cur = conn.cursor()

    # Create table if not exists
    cur.execute("""
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            tags TEXT[],
            version TEXT,
            icon TEXT,
            os_support TEXT[],
            dependencies TEXT[],
            params JSONB,
            recipe JSONB,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)

    recipe_files = sorted(glob.glob(str(recipes_dir / "*.yml")))
    imported = 0
    skipped = 0

    for filepath in recipe_files:
        recipe_id = Path(filepath).stem
        with open(filepath) as f:
            data = yaml.safe_load(f)
        
        if not data or "metadata" not in data:
            skipped += 1
            continue

        meta = data["metadata"]
        try:
            cur.execute(
                """INSERT INTO recipes (id, name, description, category, tags, version, 
                   os_support, dependencies, params, recipe)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET
                   name = EXCLUDED.name,
                   description = EXCLUDED.description,
                   category = EXCLUDED.category,
                   tags = EXCLUDED.tags,
                   version = EXCLUDED.version,
                   params = EXCLUDED.params,
                   recipe = EXCLUDED.recipe""",
                (
                    recipe_id,
                    meta.get("name", recipe_id),
                    meta.get("description", ""),
                    meta.get("category", "self-hosted"),
                    meta.get("tags", []),
                    meta.get("version", "latest"),
                    meta.get("os_support", []),
                    meta.get("dependencies", []),
                    json.dumps(data.get("params", {})),
                    json.dumps(data),
                )
            )
            imported += 1
        except Exception as e:
            skipped += 1

        if imported % 100 == 0:
            conn.commit()
            print(f"  {imported} recipes imported...")

    conn.commit()
    cur.close()
    conn.close()
    print(f"\nDone! {imported} recipes seeded (skipped {skipped})")


if __name__ == "__main__":
    main()
