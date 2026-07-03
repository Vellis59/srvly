#!/usr/bin/env node
// Seed recipes into PostgreSQL from YAML files (v2 format)
// Reads from recipes/ directory (container) or recipes/v2/ (local)
// Uses js-yaml for proper parsing

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// Determine recipes directory
const possibleDirs = [
  path.join(__dirname, "recipes"),
  path.join(__dirname, "..", "recipes", "v2"),
];
let recipesDir = null;
for (const d of possibleDirs) {
  if (fs.existsSync(d)) {
    recipesDir = d;
    break;
  }
}
if (!recipesDir) {
  console.error("recipes/ not found at", possibleDirs.join(" or "));
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();

  // Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      tags TEXT[],
      version TEXT,
      icon TEXT,
      subcategory TEXT,
      os_support TEXT[],
      dependencies TEXT[],
      params JSONB,
      recipe JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const files = fs.readdirSync(recipesDir).filter(f => f.endsWith(".yml"));
  let imported = 0, errors = 0;

  for (const file of files) {
    const recipeId = path.basename(file, ".yml");
    const filePath = path.join(recipesDir, file);
    const rawContent = fs.readFileSync(filePath, "utf-8");

    let doc;
    try {
      doc = require("js-yaml").load(rawContent);
    } catch (e) {
      console.error(`  ❌ ${file}: YAML parse error - ${e.message}`);
      errors++;
      continue;
    }

    if (!doc || typeof doc !== "object") {
      console.error(`  ❌ ${file}: Empty document`);
      errors++;
      continue;
    }

    const meta = doc.metadata || {};
    const name = meta.name || recipeId;
    const description = (meta.description || "").trim();
    const category = meta.category || "self-hosted";
    const tags = meta.tags || [];
    const version = meta.version || "latest";
    const icon = meta.icon || "";
    const subcategory = meta.subcategory || "";

    // OS support, dependencies from metadata
    const osSupport = meta.os_support || [];
    const dependencies = meta.dependencies || [];

    // Params section
    const params = doc.params || {};

    // Full recipe data as JSON
    const recipeData = { content: rawContent };

    try {
      await client.query(
        `INSERT INTO recipes (id, name, description, category, tags, version, icon, subcategory, os_support, dependencies, params, recipe)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           category = EXCLUDED.category, tags = EXCLUDED.tags,
           version = EXCLUDED.version, icon = EXCLUDED.icon,
           subcategory = EXCLUDED.subcategory,
           params = EXCLUDED.params, recipe = EXCLUDED.recipe`,
        [recipeId, name, description, category, tags, version, icon, subcategory, osSupport, dependencies,
         JSON.stringify(params), JSON.stringify(recipeData)]
      );
      imported++;
    } catch (err) {
      console.error(`  ❌ ${file}: ${err.message}`);
      errors++;
    }

    if (imported % 50 === 0 && imported > 0) {
      console.log(`  ${imported} imported...`);
    }
  }

  await client.end();
  console.log(`\nDone! ${imported} recipes seeded (${errors} errors)`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
