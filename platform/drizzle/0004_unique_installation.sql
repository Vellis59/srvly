-- Migration: Deduplicate installations and add partial unique index
-- For catalog apps (recipe_id != 'app'): only one installation per server+recipe
-- For manual registrations (recipe_id = 'app'): code-level dedup by params->>name

-- Step 1: Remove duplicates for catalog apps, keeping only the newest row per (server_id, recipe_id)
DELETE FROM installations
WHERE recipe_id != 'app'
AND id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY server_id, recipe_id
      ORDER BY created_at DESC
    ) AS rn
    FROM installations
    WHERE recipe_id != 'app'
  ) AS ranked
  WHERE ranked.rn > 1
);

-- Step 2: Remove duplicates for manual registrations with same name, keeping newest
DELETE FROM installations
WHERE recipe_id = 'app'
AND id IN (
  SELECT id FROM (
    SELECT id, params->>'name' as pname, ROW_NUMBER() OVER (
      PARTITION BY server_id, params->>'name'
      ORDER BY created_at DESC
    ) AS rn
    FROM installations
    WHERE recipe_id = 'app' AND params->>'name' IS NOT NULL
  ) AS ranked
  WHERE ranked.rn > 1
);

-- Step 3: Add partial unique index for catalog apps (excludes generic 'app' type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_installations_unique_recipe
ON installations(server_id, recipe_id)
WHERE recipe_id != 'app';
