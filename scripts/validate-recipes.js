#!/usr/bin/env node
/**
 * Validate all recipes in recipes/v2/ against the JSON Schema.
 * Run: node scripts/validate-recipes.js
 * 
 * Checks:
 * - YAML syntax
 * - JSON Schema compliance
 * - Required fields present
 * - Docker image exists (basic format check)
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Load JSON Schema
const schemaPath = path.join(__dirname, "..", "recipes", "recipe-schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

let ajv;
try {
  const Ajv = require("ajv");
  ajv = new Ajv({ allErrors: true });
  // Allow date-time format without strict validation
  ajv.addFormat("date-time", true);
} catch {
  console.log("⚠️  ajv not installed. Install with: npm install ajv");
  process.exit(0);
}

const validate = ajv.compile(schema);

const recipesDir = path.join(__dirname, "..", "recipes", "v2");
const files = fs.readdirSync(recipesDir).filter((f) => f.endsWith(".yml"));

let passed = 0;
let failed = 0;

console.log(`\nValidating ${files.length} recipes in recipes/v2/...\n`);

for (const file of files.sort()) {
  const filePath = path.join(recipesDir, file);
  const content = fs.readFileSync(filePath, "utf8");
  const name = file.replace(".yml", "");

  // 1. YAML syntax
  let doc;
  try {
    doc = yaml.load(content);
  } catch (err) {
    console.log(`  ❌ ${file} — Invalid YAML: ${err.message}`);
    failed++;
    continue;
  }

  if (!doc || typeof doc !== "object") {
    console.log(`  ❌ ${file} — Empty or invalid document`);
    failed++;
    continue;
  }

  // 2. JSON Schema validation
  const valid = validate(doc);
  if (!valid) {
    const errors = validate.errors
      .map((e) => `${e.instancePath} ${e.message}`)
      .join("; ");
    console.log(`  ❌ ${file} — ${errors}`);
    failed++;
    continue;
  }

  // 3. Extra checks
  const appName = doc.metadata?.name || name;
  const image = doc.install?.docker?.image;
  const needsDB = doc.prerequisites?.databases;

  // Check image format is valid (user/name:tag)
  if (!/^[a-zA-Z0-9_./-]+:[a-zA-Z0-9_.-]+$/.test(image)) {
    console.log(`  ⚠️  ${file} — Image format may be invalid: ${image}`);
  }

  // Check db env vars are properly defined
  if (needsDB?.postgres || needsDB?.mysql) {
    const envs = doc.install?.docker?.env || [];
    const hasDBUrl = envs.some((e) => {
      const v = e.value || "";
      return v.includes("$DB_") || v.includes("DATABASE_URL");
    });
    if (!hasDBUrl) {
      console.log(`  ⚠️  ${file} — Needs a database but no DB_* env vars defined`);
    }
  }

  console.log(`  ✅ ${file} — ${appName}`);
  passed++;
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
