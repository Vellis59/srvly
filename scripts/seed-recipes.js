#!/usr/bin/env node
// Seed recipes into PostgreSQL from YAML files
// Run inside the platform container: node seed.js

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// Parse YAML manually (no deps needed)
function parseYaml(text) {
  const lines = text.split("\n");
  const result = {};
  let current = result;
  const stack = [];
  let key = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const content = line.trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    current = stack.length > 0 ? stack[stack.length - 1].obj : result;

    if (content.endsWith(":")) {
      key = content.slice(0, -1);
      const newObj = {};
      current[key] = newObj;
      stack.push({ obj: newObj, indent });
    } else if (content.startsWith("- ")) {
      if (!Array.isArray(current)) current = [];
      current.push(content.slice(2));
    } else if (content.includes(": ")) {
      const [k, ...v] = content.split(": ");
      current[k] = v.join(": ").replace(/^"(.*)"$/, "$1");
    }
  }
  return result;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();

  // Create table
  await client.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      tags TEXT[],
      version TEXT,
      os_support TEXT[],
      dependencies TEXT[],
      params JSONB,
      recipe JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const recipesDir = path.join(__dirname, "recipes");
  if (!fs.existsSync(recipesDir)) {
    console.error("recipes/ not found at", recipesDir);
    process.exit(1);
  }

  const files = fs.readdirSync(recipesDir).filter(f => f.endsWith(".yml"));
  let imported = 0;
  let errors = 0;

  for (const file of files) {
    const recipeId = path.basename(file, ".yml");
    const content = fs.readFileSync(path.join(recipesDir, file), "utf-8");
    
    // Simple YAML extraction
    const meta = {};
    const lines = content.split("\n");
    let inMeta = false;
    let metaContent = "";
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "metadata:") {
        inMeta = true;
        continue;
      }
      if (inMeta) {
        if (lines[i].startsWith("params:") || lines[i].startsWith("links:") || lines[i].startsWith("install:") || lines[i].startsWith("verify:") || lines[i].startsWith("output:") || lines[i].startsWith("services:")) {
          break;
        }
        metaContent += lines[i] + "\n";
      }
    }

    // Extract key fields with regex
    const name = (content.match(/name:\s*(.+)/)?.[1] || recipeId).replace(/^"(.*)"$/, "$1");
    const desc = content.match(/description:\s*(.+?)\n(?:  )/s)?.[1]?.trim() || "";
    const category = content.match(/category:\s*(.+)/)?.[1] || "self-hosted";
    const version = content.match(/version:\s*(.+)/)?.[1] || "latest";
    
    // Tags
    const tagMatch = content.match(/tags:\n((?:\s+- .+\n?)*)/);
    const tags = tagMatch ? [...tagMatch[1].matchAll(/- (.+)/g)].map(m => m[1].trim()) : [];
    
    // Dependencies
    const depMatch = content.match(/dependencies:\n((?:\s+- .+\n?)*)/);
    const deps = depMatch ? [...depMatch[1].matchAll(/- (.+)/g)].map(m => m[1].trim()) : [];
    
    // OS support
    const osMatch = content.match(/os_support:\n((?:\s+- .+\n?)*)/);
    const osSupport = osMatch ? [...osMatch[1].matchAll(/- (.+)/g)].map(m => m[1].trim()) : [];

    // Params section
    const paramsMatch = content.match(/params:\n((?:\s+.*\n?)*?)\n\S/);
    let params = {};
    if (paramsMatch) {
      try {
        params = JSON.parse(JSON.stringify(parseYaml(paramsMatch[1])));
      } catch {}
    }

    try {
      await client.query(
        `INSERT INTO recipes (id, name, description, category, tags, version, os_support, dependencies, params, recipe)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           category = EXCLUDED.category, tags = EXCLUDED.tags,
           params = EXCLUDED.params, recipe = EXCLUDED.recipe`,
        [recipeId, name, desc.replace(/^"(.*)"$/, "$1"), category, tags, version, osSupport, deps,
         JSON.stringify(params), JSON.stringify({content})]
      );
      imported++;
    } catch (err) {
      errors++;
    }

    if (imported % 100 === 0) {
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
